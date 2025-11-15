import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { LocationBlueprint, LocationSpot, UUID } from "@worldengine/shared";
import { upload } from "../middleware/upload";
import { saveAsset, saveAssetBuffer, getAsset, getAssetBuffer } from "../services/assetStore";
import { resolveProjectSlug } from "../lib/projectScope";
import { findProjectBySlug } from "../stores/projects";

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

const generateViewSchema = z.object({
  locationId: nullableUuid,
  name: z.string().optional(),
  label: z.string().min(1),
  prompt: z.string().min(1),
});

const generateFromImageSchema = z.object({
  sourceLocationId: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  prompt: z.string().min(1),
  createAsNew: z.boolean(),
  newLocationName: z.string().optional(),
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

locationsRouter.post("/generate-view", async (req, res) => {
  const parsed = generateViewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_generate_view_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const { locationId, name, label, prompt } = parsed.data;

  const location = ensureLocation(locationId as UUID | undefined, name);

  try {
    const { generateImage } = await import("../lib/gemini");
    const { loadEnv } = await import("../lib/env");

    const env = loadEnv();

    // Compose a one-off prompt using project presets (if any) plus the ad-hoc text.
    const project = projectSlug ? findProjectBySlug(projectSlug) : null;
    const locPresets = project?.promptPresets?.location;
    const base = locPresets?.defaultPrompt?.trim();
    const spotPreset = locPresets?.spotPrompt?.trim();

    const parts = [
      `Generate a new view of the location "${location.name}" called "${label}".`,
      base && `Style: ${base}`,
      spotPreset && `Environment hints: ${spotPreset}`,
      prompt.trim(),
    ].filter(Boolean) as string[];

    const composedPrompt = parts.join(" ");

    const result = await generateImage(
      env,
      {
        prompt: composedPrompt,
        outputDimensions: {
          width: 768,
          height: 512,
        },
      },
      {
        apiKeyOverride: req.header("x-gemini-key") ?? undefined,
      },
    );

    const imageBuffer = result.imageBuffer;
    const aiDescription = result.aiDescription;

    const spot =
      findSpot(location, undefined, label) ??
      (() => {
        const now = new Date().toISOString();
        const created: LocationSpot = {
          id: randomUUID(),
          label,
          notes: undefined,
          referenceAssetId: undefined,
          createdAt: now,
          updatedAt: now,
        };
        location.spots.push(created);
        return created;
      })();

    const asset = await saveAssetBuffer(imageBuffer, {
      scope: ["locations", location.id, spot.id, "generated"],
      mimeType: "image/png",
      filename: `generated-${Date.now()}.png`,
      aiDescription,
      generatedFromPrompt: prompt,
      projectSlug,
    });

    spot.referenceAssetId = asset.id;
    spot.updatedAt = new Date().toISOString();
    location.updatedAt = new Date().toISOString();
    locations.set(location.id, location);

    res.json({
      status: "generated",
      location,
      spotId: spot.id,
      asset,
    });
  } catch (error) {
    console.error("location:generate_failed", error);
    res.status(500).json({ error: "generation_failed" });
  }
});

locationsRouter.post("/generate-from-image", async (req, res) => {
  const parsed = generateFromImageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_generate_from_image_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const { sourceLocationId, sourceAssetId, prompt, createAsNew, newLocationName, spotLabel } = parsed.data;

  try {
    const { generateImage } = await import("../lib/gemini");
    const { loadEnv } = await import("../lib/env");

    const env = loadEnv();

    // Load source image
    const sourceAsset = getAsset(sourceAssetId);
    if (!sourceAsset) {
      return res.status(404).json({ error: "source_asset_not_found" });
    }

    const sourceImageBuffer = await getAssetBuffer(sourceAssetId);
    if (!sourceImageBuffer) {
      return res.status(404).json({ error: "source_image_not_readable" });
    }

    // Compose prompt using project presets
    const project = projectSlug ? findProjectBySlug(projectSlug) : null;
    const locPresets = project?.promptPresets?.location;
    const base = locPresets?.defaultPrompt?.trim();
    const spotPreset = locPresets?.spotPrompt?.trim();

    // Get source location name for context
    const sourceLocation = locations.get(sourceLocationId as UUID);
    const sourceName = sourceLocation?.name ?? "location";

    const parts = [
      `Based on this reference image of "${sourceName}", generate a variation: ${prompt.trim()}`,
      base && `Style: ${base}`,
      spotPreset && `Environment hints: ${spotPreset}`,
    ].filter(Boolean) as string[];

    const composedPrompt = parts.join(" ");

    // Generate image using image-to-image
    const result = await generateImage(
      env,
      {
        prompt: composedPrompt,
        imageInput: {
          data: sourceImageBuffer.toString("base64"),
          mimeType: sourceAsset.meta.mimeType,
        },
        outputDimensions: {
          width: 768,
          height: 512,
        },
      },
      {
        apiKeyOverride: req.header("x-gemini-key") ?? undefined,
      },
    );

    const imageBuffer = result.imageBuffer;
    const aiDescription = result.aiDescription;

    let targetLocation: LocationBlueprint;
    let spot: LocationSpot | null = null;

    if (createAsNew) {
      // Create a new location
      const locationName = newLocationName?.trim() || `${sourceName} - Variation`;
      targetLocation = ensureLocation(undefined, locationName);

      const asset = await saveAssetBuffer(imageBuffer, {
        scope: ["locations", targetLocation.id, "primary"],
        mimeType: "image/png",
        filename: `generated-${Date.now()}.png`,
        aiDescription,
        generatedFromPrompt: prompt,
        projectSlug,
      });

      targetLocation.primaryAssetId = asset.id;
      targetLocation.updatedAt = new Date().toISOString();
      locations.set(targetLocation.id, targetLocation);

      res.json({
        status: "generated",
        location: targetLocation,
        asset,
      });
    } else {
      // Add as a spot to the source location
      if (!sourceLocation) {
        return res.status(404).json({ error: "source_location_not_found" });
      }

      const label = spotLabel?.trim() || "Generated view";
      spot =
        findSpot(sourceLocation, undefined, label) ??
        (() => {
          const now = new Date().toISOString();
          const created: LocationSpot = {
            id: randomUUID(),
            label,
            notes: undefined,
            referenceAssetId: undefined,
            createdAt: now,
            updatedAt: now,
          };
          sourceLocation.spots.push(created);
          return created;
        })();

      const asset = await saveAssetBuffer(imageBuffer, {
        scope: ["locations", sourceLocation.id, spot.id, "generated"],
        mimeType: "image/png",
        filename: `generated-${Date.now()}.png`,
        aiDescription,
        generatedFromPrompt: prompt,
        projectSlug,
      });

      spot.referenceAssetId = asset.id;
      spot.updatedAt = new Date().toISOString();
      sourceLocation.updatedAt = new Date().toISOString();
      locations.set(sourceLocation.id, sourceLocation);

      res.json({
        status: "generated",
        location: sourceLocation,
        spotId: spot.id,
        asset,
      });
    }
  } catch (error) {
    console.error("location:generate_from_image_failed", error);
    res.status(500).json({ error: "generation_failed" });
  }
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
