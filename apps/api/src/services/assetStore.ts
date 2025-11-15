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
    payload.forEach((asset) => {
      const normalized = {
        ...asset,
        filePath: asset.filePath,
      } as StoredAsset;
      registry.set(normalized.id, normalized);
    });
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
  const filePath = path.join(destinationDir, filename);
  await writeFile(filePath, file.buffer);

  return register({
    id: assetId,
    url: `/assets/${assetId}`,
    mimeType: file.mimetype || "application/octet-stream",
    width: 0,
    height: 0,
    filePath,
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
  const filePath = path.join(destinationDir, filename);
  await writeFile(filePath, buffer);

  return register({
    id: assetId,
    url: `/assets/${assetId}`,
    mimeType: options.mimeType,
    width: 0,
    height: 0,
    filePath,
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

  return {
    meta: asset,
    stream: createReadStream(asset.filePath),
  };
}

export async function getAssetBuffer(assetId: string): Promise<Buffer | null> {
  const asset = registry.get(assetId);
  if (!asset) return null;

  try {
    return await readFile(asset.filePath);
  } catch (error) {
    console.error(`Failed to read asset ${assetId}:`, error);
    return null;
  }
}

export function listAssets() {
  return Array.from(registry.values());
}




