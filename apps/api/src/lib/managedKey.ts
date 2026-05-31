import type { Request } from "express";
import type { EnvConfig } from "./env";

export function requestGeminiKey(req: Request, env: EnvConfig): string | undefined {
  if (env.WORLDENGINE_HOSTED_BY_FORGE || env.WORLDENGINE_REQUIRE_AUTH) {
    return undefined;
  }
  return req.header("x-gemini-key") ?? undefined;
}
