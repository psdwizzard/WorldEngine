import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetReference } from "@worldengine/shared";
import { DEFAULT_DATA_ROOT } from "../lib/env";
import { DEFAULT_PROJECT_SLUG } from "../lib/constants";
import { normalizeProjectSlug } from "../lib/projectScope";

interface StoredAsset extends AssetReference {
  filePath: string;
  originalName: string;
  size: number;
  projectSlug: string;
}

const registry = new Map<string, StoredAsset>();

let uploadsRoot = path.join(DEFAULT_DATA_ROOT, "projects");
let manifestPath = path.join(DEFAULT_DATA_ROOT, "projects", "assets.json");
let initialized = false;

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

type AssetManifest = Array<StoredAsset>;

async function persistManifest() {
  await ensureDir(path.dirname(manifestPath));
  const payload: AssetManifest = Array.from(registry.values());
  await writeFile(manifestPath, JSON.stringify(payload, null, 2), "utf8");
}

async function loadManifest() {
  try {
    const contents = await readFile(manifestPath, "utf8");
    const payload = JSON.parse(contents) as AssetManifest;
    registry.clear();

    let hasChanges = false;

    payload.forEach((asset) => {
      let filePath = asset.filePath;

      // Migration: Convert absolute paths to relative
      if (path.isAbsolute(filePath)) {
        // Try to make it relative to the current uploadsRoot
        // We assume the absolute path points to the same location as we expect
        // If the file doesn't exist there, we might have a problem, but for now we just convert the string.
        // However, if the project MOVED, the absolute path might be wrong.
        // But the user said "if I move this project, it doesn't break".
        // So we assume we are currently in a state where we might want to fix it.
        // Actually, if the user ALREADY moved it, the absolute path is invalid.
        // But we can try to recover it if it follows the structure.

        // The structure seems to be .../projects/<slug>/...
        // We can try to find "projects" in the path and take everything after it.
        const parts = filePath.split(path.sep);
        const projectsIndex = parts.lastIndexOf("projects");
        if (projectsIndex !== -1 && projectsIndex < parts.length - 1) {
          filePath = parts.slice(projectsIndex + 1).join(path.sep);
          hasChanges = true;
        } else {
          // Fallback: try standard relative if it happens to match our current root
          const relative = path.relative(uploadsRoot, filePath);
          if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
            filePath = relative;
            hasChanges = true;
          }
        }
      }

      const normalized = {
        ...asset,
        filePath: filePath,
      } as StoredAsset;
      registry.set(normalized.id, normalized);
    });

    if (hasChanges) {
      console.log("Migrated asset paths to relative paths.");
      await persistManifest();
    }

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("assetStore:manifest_read_failed", error);
    }
  }
}

export async function configureAssetStore(root: string) {
  uploadsRoot = path.join(root, "projects");
  manifestPath = path.join(root, "projects", "assets.json");
  await ensureDir(uploadsRoot);
  await loadManifest();
  initialized = true;
}

function buildDestination(scope: string[], projectSlug?: string) {
  const normalizedSlug = normalizeProjectSlug(projectSlug ?? DEFAULT_PROJECT_SLUG);
  const filtered = scope.filter(Boolean);
  const relativeDir = filtered.length > 0 ? path.join(...filtered) : "";
  return path.join(uploadsRoot, normalizedSlug, relativeDir);
}

async function register(asset: StoredAsset) {
  registry.set(asset.id, asset);
  await persistManifest();
  return asset;
}

export async function saveAsset(
  file: Express.Multer.File,
  scope: string[] = [],
  projectSlug?: string,
): Promise<AssetReference> {
  if (!initialized) {
    await configureAssetStore(DEFAULT_DATA_ROOT);
  }

  const destinationDir = buildDestination(scope, projectSlug);
  await ensureDir(destinationDir);

  const assetId = randomUUID();
  const extension = path.extname(file.originalname) || ".bin";
  const filename = `${assetId}${extension}`;
  const fullPath = path.join(destinationDir, filename);
  await writeFile(fullPath, file.buffer);

  const relativePath = path.relative(uploadsRoot, fullPath);

  return register({
    id: assetId,
    url: `/assets/${assetId}`,
    mimeType: file.mimetype || "application/octet-stream",
    width: 0,
    height: 0,
    filePath: relativePath,
    originalName: file.originalname,
    size: file.size,
    projectSlug: normalizeProjectSlug(projectSlug ?? DEFAULT_PROJECT_SLUG),
  });
}

export async function saveAssetBuffer(
  buffer: Buffer,
  options: {
    scope?: string[];
    mimeType: string;
    filename?: string;
    aiDescription?: string;
    generatedFromPrompt?: string;
    projectSlug?: string;
  },
): Promise<AssetReference> {
  if (!initialized) {
    await configureAssetStore(DEFAULT_DATA_ROOT);
  }

  const destinationDir = buildDestination(options.scope ?? [], options.projectSlug);
  await ensureDir(destinationDir);

  const assetId = randomUUID();
  const filename = options.filename ?? `${assetId}.bin`;
  const fullPath = path.join(destinationDir, filename);
  await writeFile(fullPath, buffer);

  const relativePath = path.relative(uploadsRoot, fullPath);

  return register({
    id: assetId,
    url: `/assets/${assetId}`,
    mimeType: options.mimeType,
    width: 0,
    height: 0,
    filePath: relativePath,
    originalName: options.filename ?? filename,
    size: buffer.byteLength,
    aiDescription: options.aiDescription,
    generatedFromPrompt: options.generatedFromPrompt,
    projectSlug: normalizeProjectSlug(options.projectSlug ?? DEFAULT_PROJECT_SLUG),
  });
}

export function getAsset(assetId: string) {
  const asset = registry.get(assetId);
  if (!asset) return null;

  const fullPath = path.resolve(uploadsRoot, asset.filePath);

  return {
    meta: asset,
    stream: createReadStream(fullPath),
  };
}

export async function getAssetBuffer(assetId: string): Promise<Buffer | null> {
  const asset = registry.get(assetId);
  if (!asset) return null;

  const fullPath = path.resolve(uploadsRoot, asset.filePath);

  try {
    return await readFile(fullPath);
  } catch (error) {
    console.error(`Failed to read asset ${assetId}:`, error);
    return null;
  }
}

export function listAssets() {
  return Array.from(registry.values());
}

