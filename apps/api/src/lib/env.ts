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
});

export type EnvConfig = z.infer<typeof envSchema> & {
  JSON_LIMIT: string;
};

export function loadEnv(): EnvConfig {
  load({ path: ".env.local", override: false });

  const parsed = envSchema.parse(process.env);

  return {
    ...parsed,
    JSON_LIMIT: `${parsed.JSON_LIMIT_MB}mb`,
  };
}
