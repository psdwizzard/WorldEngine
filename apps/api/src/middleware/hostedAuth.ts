import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { EnvConfig } from "../lib/env";

export interface HostedUser {
  email: string;
  role: "founder" | "admin" | "member";
  userKey: string;
}

type RequestWithUser = Request & { worldEngineUser?: HostedUser };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function userKeyForEmail(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);
}

export function getHostedUser(req: Request): HostedUser {
  const user = (req as RequestWithUser).worldEngineUser;
  if (!user) {
    return { email: "local-dev@worldengine.local", role: "founder", userKey: "local-dev" };
  }
  return user;
}

function getHeader(req: Request, name: string): string | undefined {
  const value = req.header(name);
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function roleFrom(value: string | undefined, email: string, env: EnvConfig): HostedUser["role"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "founder" || normalized === "admin" || normalized === "member") return normalized;
  if (env.WORLDENGINE_FOUNDER_EMAIL?.trim().toLowerCase() === email.trim().toLowerCase()) return "founder";
  return "member";
}

function verifyForgeSignature(req: Request, env: EnvConfig): HostedUser | null {
  const secret = env.WORLDENGINE_PROXY_HMAC_SECRET?.trim();
  if (!secret) return null;

  const email = getHeader(req, "x-df-user-email");
  const role = getHeader(req, "x-df-user-role") ?? "member";
  const timestamp = getHeader(req, "x-df-proxy-timestamp");
  const signature = getHeader(req, "x-df-proxy-signature");
  if (!email || !timestamp || !signature) return null;

  const ageMs = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) return null;

  const payload = [
    email.trim().toLowerCase(),
    role,
    timestamp,
    req.method.toUpperCase(),
    req.originalUrl || req.url || "/",
  ].join("|");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (!timingSafeEqualHex(expected, signature)) return null;

  return {
    email: email.trim().toLowerCase(),
    role: roleFrom(role, email, env),
    userKey: userKeyForEmail(email),
  };
}

async function verifyCloudflareAccess(req: Request, env: EnvConfig): Promise<HostedUser | null> {
  const jwt = getHeader(req, "cf-access-jwt-assertion");
  if (!jwt || !env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || !env.CLOUDFLARE_ACCESS_AUD) return null;

  const issuer = `https://${env.CLOUDFLARE_ACCESS_TEAM_DOMAIN}`;
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const result = await jwtVerify(jwt, jwks, {
    issuer,
    audience: env.CLOUDFLARE_ACCESS_AUD,
  });
  const email = typeof result.payload.email === "string" ? result.payload.email.trim().toLowerCase() : "";
  if (!email) return null;
  return {
    email,
    role: roleFrom(undefined, email, env),
    userKey: userKeyForEmail(email),
  };
}

export function hostedAuth(env: EnvConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!env.WORLDENGINE_HOSTED_BY_FORGE && !env.WORLDENGINE_REQUIRE_AUTH) {
      (req as RequestWithUser).worldEngineUser = {
        email: "local-dev@worldengine.local",
        role: "founder",
        userKey: "local-dev",
      };
      return next();
    }

    try {
      const signedForgeUser = verifyForgeSignature(req, env);
      const cloudflareUser = signedForgeUser ?? await verifyCloudflareAccess(req, env);
      if (!cloudflareUser) {
        return res.status(401).json({ error: "auth_required" });
      }
      (req as RequestWithUser).worldEngineUser = cloudflareUser;
      return next();
    } catch (error) {
      console.warn("auth:hosted_failed", error);
      return res.status(401).json({ error: "invalid_auth" });
    }
  };
}
