import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { LocationBlueprint, LocationSpot, UUID } from "@worldengine/shared";
import { upload } from "../middleware/upload";
import { saveAsset } from "../services/assetStore";
import { resolveProjectSlug } from "../lib/projectScope";

const locationPayload = z.object({
  locationId: z.string().uuid().optional(),
  name: z.string().min(1),
  secondarySpots: z.array(z.string().min(1)).default([]),
  referenceAssetId: z.string().uuid().optional(),
});

const nullableUuid = z
  .string()
  .uuid()
  .or(z.literal(""))
  .optional()
  .transform((value) => (value ? value : undefined));

const uploadSchema = z.object({
  locationId: nullableUuid,
  name: z.string().optional(),
  spotId: nullableUuid,
  spotLabel: z.string().optional(),
});

const locations = new Map<UUID, LocationBlueprint>();

function ensureLocation(locationId: UUID | undefined, name?: string): LocationBlueprint {
  if (locationId && locations.has(locationId)) {
    const existing = locations.get(locationId)!;
    if (name && name.trim()) {
      existing.name = name.trim();
      existing.updatedAt = new Date().toISOString();
    }
    return existing;
  }

  const id = locationId ?? randomUUID();
  const now = new Date().toISOString();
  const location: LocationBlueprint = {
    id,
    name: name?.trim() && name.trim().length > 0 ? name.trim() : "Untitled Location",
    primaryAssetId: undefined,
    spots: [],
    createdAt: now,
    updatedAt: now,
  };

  locations.set(id, location);
  return location;
}

function findSpot(location: LocationBlueprint, spotId?: UUID, spotLabel?: string): LocationSpot | null {
  if (spotId) {
    const existing = location.spots.find((spot) => spot.id === spotId);
    if (existing) {
      return existing;
    }
  }

  if (spotLabel) {
    const normalized = spotLabel.trim();
    const existing = location.spots.find(
      (spot) => spot.label.toLowerCase() === normalized.toLowerCase(),
    );
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const created: LocationSpot = {
      id: randomUUID(),
      label: normalized,
      notes: undefined,
      referenceAssetId: undefined,
      createdAt: now,
      updatedAt: now,
    };
    location.spots.push(created);
    return created;
  }

  return null;
}

export const locationsRouter = Router();

locationsRouter.post("/generate", (req, res) => {
  const parsed = locationPayload.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const location = ensureLocation(parsed.data.locationId as UUID | undefined, parsed.data.name);
  if (parsed.data.referenceAssetId) {
    location.primaryAssetId = parsed.data.referenceAssetId;
  }
  if (parsed.data.secondarySpots.length) {
    parsed.data.secondarySpots.forEach((label) => {
      findSpot(location, undefined, label);
    });
  }
  location.updatedAt = new Date().toISOString();
  locations.set(location.id, location);

  res.json({ status: "queued", location });
});

locationsRouter.post("/upload", upload.single("reference"), async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_form_fields", issues: parsed.error.flatten() });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "file_required" });
  }

  const projectSlug = resolveProjectSlug(req);
  const location = ensureLocation(parsed.data.locationId as UUID | undefined, parsed.data.name);

  try {
    const spot = findSpot(location, parsed.data.spotId as UUID | undefined, parsed.data.spotLabel);
    const scope = ["locations", location.id];
    if (spot) scope.push(spot.id);
    const asset = await saveAsset(file, scope, projectSlug);

    if (spot) {
      spot.referenceAssetId = asset.id;
      spot.updatedAt = new Date().toISOString();
    } else {
      location.primaryAssetId = asset.id;
    }

    location.updatedAt = new Date().toISOString();
    locations.set(location.id, location);

    res.json({
      status: "stored",
      location,
      asset,
      spotId: spot?.id ?? null,
    });
  } catch (error) {
    console.error("location:upload_failed", error);
    res.status(500).json({ error: "asset_store_failure" });
  }
});

locationsRouter.get("/", (_req, res) => {
  res.json({ locations: Array.from(locations.values()) });
});
