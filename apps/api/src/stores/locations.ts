import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocationBlueprint, LocationSpot, UUID } from "@worldengine/shared";
import { DEFAULT_DATA_ROOT } from "../lib/env";
import { DEFAULT_PROJECT_SLUG } from "../lib/constants";
import { normalizeProjectSlug } from "../lib/projectScope";

export interface LocationRecord extends LocationBlueprint {
  projectSlug: string;
}

const locations = new Map<UUID, LocationRecord>();

let locationsPath = path.join(DEFAULT_DATA_ROOT, "projects", "locations.json");
let initialized = false;

function now() {
  return new Date().toISOString();
}

function normalizeRecord(raw: LocationRecord): LocationRecord {
  const spots: LocationSpot[] = (raw.spots ?? []).map((spot) => ({
    id: spot.id ?? randomUUID(),
    label: spot.label,
    notes: spot.notes,
    referenceAssetId: spot.referenceAssetId,
    createdAt: spot.createdAt ?? now(),
    updatedAt: spot.updatedAt ?? now(),
  }));

  const projectSlug = normalizeProjectSlug(raw.projectSlug ?? DEFAULT_PROJECT_SLUG);

  return {
    ...raw,
    name: raw.name?.trim() && raw.name.trim().length > 0 ? raw.name.trim() : "Untitled Location",
    primaryAssetId: raw.primaryAssetId,
    spots,
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? now(),
    projectSlug,
  };
}

async function persistLocations() {
  await mkdir(path.dirname(locationsPath), { recursive: true });
  const payload = Array.from(locations.values()).map(normalizeRecord);
  await writeFile(locationsPath, JSON.stringify(payload, null, 2), "utf8");
}

export async function initializeLocationStore(root: string) {
  locationsPath = path.join(root, "projects", "locations.json");
  await mkdir(path.dirname(locationsPath), { recursive: true });

  try {
    const contents = await readFile(locationsPath, "utf8");
    const payload = JSON.parse(contents) as LocationRecord[];
    locations.clear();
    payload.forEach((record) => {
      const normalized = normalizeRecord(record);
      locations.set(normalized.id, normalized);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("locations:load_failed", error);
    }
  }

  initialized = true;
}

function ensureInitialized() {
  if (!initialized) {
    initializeLocationStore(DEFAULT_DATA_ROOT).catch((error) => {
      console.error("locations:lazy_init_failed", error);
    });
    initialized = true;
  }
}

export function listLocations(projectSlug?: string): LocationRecord[] {
  ensureInitialized();
  if (!projectSlug) {
    return Array.from(locations.values());
  }
  const normalizedSlug = normalizeProjectSlug(projectSlug);
  return Array.from(locations.values()).filter((record) => record.projectSlug === normalizedSlug);
}

export function getLocation(id: UUID, projectSlug?: string): LocationRecord | null {
  ensureInitialized();
  const record = locations.get(id) ?? null;
  if (!record) return null;
  if (projectSlug && record.projectSlug !== normalizeProjectSlug(projectSlug)) {
    return null;
  }
  return record;
}

export function ensureLocation(projectSlug: string, id?: UUID, name?: string): LocationRecord {
  ensureInitialized();
  const normalizedSlug = normalizeProjectSlug(projectSlug ?? DEFAULT_PROJECT_SLUG);

  if (id && locations.has(id)) {
    const existing = locations.get(id)!;
    if (existing.projectSlug === normalizedSlug) {
      if (name && name.trim()) {
        existing.name = name.trim();
        existing.updatedAt = now();
      }
      return existing;
    }
  }

  const label = name?.trim() && name.trim().length > 0 ? name.trim() : "Untitled Location";
  const createdAt = now();
  const record: LocationRecord = {
    id: id ?? randomUUID(),
    name: label,
    primaryAssetId: undefined,
    spots: [],
    createdAt,
    updatedAt: createdAt,
    projectSlug: normalizedSlug,
  };

  locations.set(record.id, record);
  return record;
}

type EnsureSpotOptions = {
  spotId?: UUID;
  label?: string;
};

export function ensureSpot(record: LocationRecord, options: EnsureSpotOptions = {}): LocationSpot | null {
  const { spotId, label } = options;

  if (spotId) {
    const existing = record.spots.find((spot) => spot.id === spotId);
    if (existing) {
      if (label && label.trim()) {
        existing.label = label.trim();
      }
      existing.updatedAt = now();
      record.updatedAt = now();
      return existing;
    }
  }

  const normalizedLabel = label?.trim();
  if (!normalizedLabel) {
    return null;
  }

  const existingByLabel = record.spots.find(
    (spot) => spot.label.toLowerCase() === normalizedLabel.toLowerCase(),
  );
  if (existingByLabel) {
    existingByLabel.updatedAt = now();
    record.updatedAt = now();
    return existingByLabel;
  }

  const created: LocationSpot = {
    id: randomUUID(),
    label: normalizedLabel,
    notes: undefined,
    referenceAssetId: undefined,
    createdAt: now(),
    updatedAt: now(),
  };

  record.spots.push(created);
  record.updatedAt = now();
  return created;
}

export async function upsertLocation(record: LocationRecord) {
  ensureInitialized();
  const normalized = normalizeRecord(record);
  normalized.updatedAt = now();
  locations.set(normalized.id, normalized);
  await persistLocations();
}

