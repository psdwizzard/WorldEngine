import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as load } from "dotenv";
import { z } from "zod";

const apiLibDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(apiLibDir, "..", "..", "..", "..");

export const LEGACY_DATA_ROOT = path.resolve(process.cwd(), "output");
export const DEFAULT_DATA_ROOT = path.join(repoRoot, "workspace-data");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  JSON_LIMIT_MB: z.coerce.number().int().positive().default(25),
  DATA_ROOT: z.string().default(DEFAULT_DATA_ROOT),
  GEMINI_API_KEY: z.string().min(1).optional(),
  NANO_BANANA_MODEL: z.string().optional(),
  NANO_BANANA_PRO_MODEL: z.string().optional(),
  WORLDENGINE_HOSTED_BY_FORGE: z.coerce.boolean().default(false),
  WORLDENGINE_REQUIRE_AUTH: z.coerce.boolean().default(false),
  WORLDENGINE_PROXY_HMAC_SECRET: z.string().optional(),
  WORLDENGINE_FOUNDER_EMAIL: z.string().email().optional(),
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: z.string().optional(),
  CLOUDFLARE_ACCESS_AUD: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema> & {
  JSON_LIMIT: string;
};

export function loadEnv(): EnvConfig {
  // Load env from repo root for shared defaults
  load({ path: ".env.local", override: false });
  // Load API-specific env placed under apps/api/.env.local
  load({ path: path.join(repoRoot, "apps", "api", ".env.local"), override: false });
  // Load hosted-mode config (Gemini key + Cloudflare Access settings) so the
  // API picks up production env even when started directly via `npm run serve`
  // instead of through run-forge.bat's env-loading loop.
  //
  // Uses override: true intentionally. The file represents the canonical
  // hosted-mode config for this deployment, and must beat any inherited
  // process.env vars from the parent shell (e.g., a foreman session that
  // injects sibling-app CLOUDFLARE_ACCESS_AUD / PORT values). .env.local
  // files above are still override:false so devs keep their local overrides.
  load({ path: path.join(repoRoot, ".env.forge"), override: true });

  if (process.env.VITEST) {
    process.env.NODE_ENV = "test";
  }

  const parsed = envSchema.parse(process.env);

  return {
    ...parsed,
    JSON_LIMIT: `${parsed.JSON_LIMIT_MB}mb`,
  };
}
