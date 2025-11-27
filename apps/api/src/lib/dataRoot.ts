import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { LEGACY_DATA_ROOT } from "./env";

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the workspace data root exists and, if necessary, migrate
 * from the legacy apps/api/output directory.
 */
export async function prepareDataRoot(targetRoot: string) {
  await mkdir(targetRoot, { recursive: true });
  const normalizedTarget = path.resolve(targetRoot);
  const normalizedLegacy = path.resolve(LEGACY_DATA_ROOT);

  if (normalizedTarget === normalizedLegacy) {
    return;
  }

  const legacyExists = await pathExists(normalizedLegacy);
  if (!legacyExists) {
    return;
  }

  const targetHasProjects = await pathExists(path.join(normalizedTarget, "projects"));
  if (targetHasProjects) {
    return;
  }

  await cp(normalizedLegacy, normalizedTarget, { recursive: true });
  console.log(`data:migrated legacy storage from ${normalizedLegacy} -> ${normalizedTarget}`);
}

