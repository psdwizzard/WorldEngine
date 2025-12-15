import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@worldengine/shared": resolve(rootDir, "../../packages/shared/src"),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
    },
  },
});