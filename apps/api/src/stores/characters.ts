import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetReference, CharacterAngle, CharacterProfile, UUID } from "@worldengine/shared";
import { DEFAULT_DATA_ROOT } from "../lib/env";
import { DEFAULT_PROJECT_SLUG } from "../lib/constants";
import { normalizeProjectSlug } from "../lib/projectScope";

const ANGLE_KEYS: CharacterAngle[] = ["front", "left", "right", "back", "side", "three-quarter"];

export type CharacterAngleSlot = {
  id: UUID;
  label: string;
  angle: CharacterAngle | null;
  asset: AssetReference | null;
  order: number;
};

export interface CharacterRecord extends CharacterProfile {
  slots: CharacterAngleSlot[];
  defaultSlotId: UUID;
  projectSlug: string;
}

const characters = new Map<UUID, CharacterRecord>();

let charactersPath = path.join(DEFAULT_DATA_ROOT, "projects", "characters.json");
let initialized = false;

function normalizeAngles(record: CharacterRecord): CharacterRecord {
  const angles = ANGLE_KEYS.reduce<Record<CharacterAngle, AssetReference | null>>((acc, angle) => {
    acc[angle] = record.angles?.[angle] ?? null;
    return acc;
  }, {} as Record<CharacterAngle, AssetReference | null>);

  return {
    ...record,
    angles,
  };
}

function normalizeRecord(raw: CharacterRecord): CharacterRecord {
  const slots = (raw.slots ?? []).map((slot, index) => ({
    ...slot,
    angle: slot.angle ?? null,
    asset: slot.asset ?? null,
    order: slot.order ?? index,
  }));
  const defaultSlotId = raw.defaultSlotId ?? slots[0]?.id ?? randomUUID();
  const projectSlug = normalizeProjectSlug(raw.projectSlug ?? DEFAULT_PROJECT_SLUG);

  return normalizeAngles({
    ...raw,
    slots,
    defaultSlotId,
    projectSlug,
  });
}

async function persistCharacters() {
  await mkdir(path.dirname(charactersPath), { recursive: true });
  const payload = Array.from(characters.values()).map(normalizeAngles);
  await writeFile(charactersPath, JSON.stringify(payload, null, 2), "utf8");
}

export async function initializeCharacterStore(root: string) {
  charactersPath = path.join(root, "projects", "characters.json");
  await mkdir(path.dirname(charactersPath), { recursive: true });

  try {
    const contents = await readFile(charactersPath, "utf8");
    const payload = JSON.parse(contents) as CharacterRecord[];
    characters.clear();
    payload.forEach((record) => {
      const normalized = normalizeRecord(record);
      characters.set(normalized.id, normalized);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("characters:load_failed", error);
    }
  }

  initialized = true;
}

function ensureInitialized() {
  if (!initialized) {
    // fall back to default location synchronously
    initializeCharacterStore(DEFAULT_DATA_ROOT).catch((error) => {
      console.error("characters:lazy_init_failed", error);
    });
    initialized = true;
  }
}

export function listCharacters(projectSlug?: string) {
  ensureInitialized();
  if (!projectSlug) {
    return Array.from(characters.values());
  }
  const normalizedSlug = normalizeProjectSlug(projectSlug);
  return Array.from(characters.values()).filter((record) => record.projectSlug === normalizedSlug);
}

export function getCharacter(id: UUID, projectSlug?: string) {
  ensureInitialized();
  const record = characters.get(id) ?? null;
  if (!record) return null;
  if (projectSlug && record.projectSlug !== normalizeProjectSlug(projectSlug)) {
    return null;
  }
  return record;
}

export function findCharacterWithSlot(slotId: UUID, projectSlug?: string) {
  ensureInitialized();
  const normalizedSlug = projectSlug ? normalizeProjectSlug(projectSlug) : undefined;
  for (const record of characters.values()) {
    if (normalizedSlug && record.projectSlug !== normalizedSlug) {
      continue;
    }
    if (record.slots.some((slot) => slot.id === slotId)) {
      return record;
    }
  }
  return null;
}

export function createCharacter(name: string, projectSlug: string): CharacterRecord {
  ensureInitialized();
  const now = new Date().toISOString();
  const id = randomUUID();
  const normalizedSlug = normalizeProjectSlug(projectSlug);
  const defaultSlot: CharacterAngleSlot = {
    id: randomUUID(),
    label: "Front",
    angle: "front",
    asset: null,
    order: 0,
  };

  const record: CharacterRecord = {
    id,
    name,
    description: undefined,
    sourceAssetId: undefined,
    angles: ANGLE_KEYS.reduce<Record<CharacterAngle, AssetReference | null>>((acc, angle) => {
      acc[angle] = null;
      return acc;
    }, {} as Record<CharacterAngle, AssetReference | null>),
    slots: [defaultSlot],
    defaultSlotId: defaultSlot.id,
    createdAt: now,
    updatedAt: now,
    projectSlug: normalizedSlug,
  };

  characters.set(id, record);
  return record;
}

export async function upsertCharacter(record: CharacterRecord) {
  ensureInitialized();
  record.projectSlug = normalizeProjectSlug(record.projectSlug ?? DEFAULT_PROJECT_SLUG);
  record.updatedAt = new Date().toISOString();
  characters.set(record.id, normalizeRecord(record));
  await persistCharacters();
}

export function ensureCharacter(projectSlug: string, id?: UUID, name?: string) {
  ensureInitialized();
  const normalizedSlug = normalizeProjectSlug(projectSlug);
  if (id && characters.has(id)) {
    const existing = characters.get(id)!;
    if (existing.projectSlug === normalizedSlug) {
      if (name && name.trim()) {
        existing.name = name.trim();
        existing.updatedAt = new Date().toISOString();
      }
      return existing;
    }
  }

  const label = name?.trim() && name.trim().length > 0 ? name.trim() : "Untitled Character";
  return createCharacter(label, normalizedSlug);
}

type EnsureSlotOptions = {
  slotId?: UUID;
  label?: string;
  angle?: CharacterAngle | null;
};

export function ensureSlot(record: CharacterRecord, options: EnsureSlotOptions = {}) {
  const { slotId, label, angle = null } = options;
  if (slotId) {
    const existing = record.slots.find((slot) => slot.id === slotId);
    if (existing) {
      if (label && label.trim()) {
        existing.label = label.trim();
      }
      if (angle !== undefined) {
        existing.angle = angle;
      }
      record.updatedAt = new Date().toISOString();
      return existing;
    }
  }

  const normalizedLabel = label?.trim() ?? "Custom";
  const order = record.slots.length;
  const slot: CharacterAngleSlot = {
    id: slotId ?? randomUUID(),
    label: normalizedLabel,
    angle,
    asset: null,
    order,
  };

  record.slots.push(slot);
  record.updatedAt = new Date().toISOString();
  return slot;
}

export function assignAsset(record: CharacterRecord, slotId: UUID, asset: AssetReference) {
  const slot = record.slots.find((candidate) => candidate.id === slotId);
  if (!slot) return;

  slot.asset = asset;
  if (slot.angle) {
    record.angles[slot.angle] = asset;
  }

  record.updatedAt = new Date().toISOString();
}

export function setDefaultSlot(record: CharacterRecord, slotId: UUID) {
  if (record.slots.some((slot) => slot.id === slotId)) {
    record.defaultSlotId = slotId;
    record.updatedAt = new Date().toISOString();
  }
}

export function removeSlot(record: CharacterRecord, slotId: UUID) {
  if (record.slots.length <= 1) return;

  const slotIndex = record.slots.findIndex((candidate) => candidate.id === slotId);
  if (slotIndex === -1) return;

  const [slot] = record.slots.splice(slotIndex, 1);
  if (slot.angle) {
    record.angles[slot.angle] = null;
  }

  if (record.defaultSlotId === slotId) {
    record.defaultSlotId = record.slots[0]?.id ?? record.defaultSlotId;
  }

  record.slots = record.slots.map((candidate, index) => ({ ...candidate, order: index }));
  record.updatedAt = new Date().toISOString();
}



