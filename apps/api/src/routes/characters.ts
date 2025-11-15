import { Router } from "express";
import { z } from "zod";
import type { CharacterAngle, UUID } from "@worldengine/shared";
import { upload } from "../middleware/upload";
import { saveAsset, saveAssetBuffer } from "../services/assetStore";
import { resolveProjectSlug } from "../lib/projectScope";
import {
  assignAsset,
  getCharacter,
  ensureCharacter,
  ensureSlot,
  findCharacterWithSlot,
  listCharacters,
  removeSlot,
  setDefaultSlot,
  upsertCharacter,
} from "../stores/characters";

const generateSchema = z.object({
  characterId: z.string().uuid().optional(),
  name: z.string().min(1),
  referenceAssetId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

const nullableUuid = z
  .string()
  .uuid()
  .or(z.literal(""))
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const angleSchema = z.union([
  z.literal("front"),
  z.literal("left"),
  z.literal("right"),
  z.literal("back"),
  z.literal("side"),
  z.literal("three-quarter"),
]);

const booleanLike = z
  .union([z.string(), z.number(), z.boolean()])
  .optional()
  .transform((value) => {
    if (value === undefined) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const normalized = value.toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  });

const slotAngleField = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value.length === 0) return null;
    return angleSchema.safeParse(value).success ? (value as CharacterAngle) : null;
  });

const createSlotSchema = z.object({
  characterId: nullableUuid,
  slotId: nullableUuid,
  name: z.string().optional(),
  label: z.string().min(1),
  angle: slotAngleField,
  setDefault: booleanLike,
});

const uploadSchema = z.object({
  characterId: nullableUuid,
  slotId: nullableUuid,
  name: z.string().optional(),
  slotLabel: z.string().optional(),
  angle: slotAngleField,
  setDefault: booleanLike,
});

const generateSlotSchema = z.object({
  characterId: z.string().uuid(),
  sourceSlotId: z.string().uuid(),
  targetSlotId: nullableUuid,
  label: z.string().optional(),
  angle: slotAngleField,
  prompt: z.string().optional(),
  overwrite: booleanLike,
});

// PLACEHOLDER_PNG removed - now using generateImage() function

export const charactersRouter = Router();

charactersRouter.get("/", (req, res) => {
  const projectSlug = resolveProjectSlug(req);
  res.json({ characters: listCharacters(projectSlug) });
});

charactersRouter.post("/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const character = ensureCharacter(projectSlug, parsed.data.characterId as UUID | undefined, parsed.data.name);
  character.description = parsed.data.notes ?? character.description;
  character.sourceAssetId = parsed.data.referenceAssetId ?? character.sourceAssetId;
  await upsertCharacter(character);

  res.json({ status: "queued", character });
});

charactersRouter.post("/slots", async (req, res) => {
  const parsed = createSlotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_slot_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const character = ensureCharacter(projectSlug, parsed.data.characterId as UUID | undefined, parsed.data.name);
  const normalizedAngle = parsed.data.angle === undefined ? undefined : (parsed.data.angle as CharacterAngle | null);
  const slot = ensureSlot(character, {
    slotId: parsed.data.slotId as UUID | undefined,
    label: parsed.data.label,
    angle: normalizedAngle,
  });

  if (parsed.data.setDefault) {
    setDefaultSlot(character, slot.id);
  }

  await upsertCharacter(character);

  res.json({ status: "ok", character, slot });
});

charactersRouter.delete("/slots/:slotId", async (req, res) => {
  const { slotId } = req.params;
  const projectSlug = resolveProjectSlug(req);
  const record = findCharacterWithSlot(slotId as UUID, projectSlug);
  if (!record) {
    return res.status(404).json({ error: "slot_not_found" });
  }

  if (record.slots.length <= 1) {
    return res.status(400).json({ error: "cannot_remove_last_slot" });
  }

  removeSlot(record, slotId as UUID);
  await upsertCharacter(record);

  res.json({ status: "removed", character: record });
});

charactersRouter.post("/upload", upload.single("source"), async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_form_fields", issues: parsed.error.flatten() });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "file_required" });
  }

  const projectSlug = resolveProjectSlug(req);
  const character = ensureCharacter(projectSlug, parsed.data.characterId as UUID | undefined, parsed.data.name);
  const label = parsed.data.slotLabel ?? undefined;
  const slotAngle = parsed.data.angle === undefined ? undefined : (parsed.data.angle as CharacterAngle | null);
  const slot = ensureSlot(character, {
    slotId: parsed.data.slotId as UUID | undefined,
    label,
    angle: slotAngle,
  });

  try {
    const scope = ["characters", character.id, slot.id];
    const asset = await saveAsset(file, scope, projectSlug);
    assignAsset(character, slot.id, asset);
    if (parsed.data.setDefault) {
      setDefaultSlot(character, slot.id);
    }
    await upsertCharacter(character);

    res.json({
      status: "stored",
      character,
      slot,
      asset,
    });
  } catch (error) {
    console.error("character:upload_failed", error);
    res.status(500).json({ error: "asset_store_failure" });
  }
});

charactersRouter.post("/generate/slot", async (req, res) => {
  const parsed = generateSlotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_generate_payload", issues: parsed.error.flatten() });
  }

  const { characterId, sourceSlotId, targetSlotId, prompt, label, angle, overwrite } = parsed.data;
  const projectSlug = resolveProjectSlug(req);
  const character = getCharacter(characterId as UUID, projectSlug);
  if (!character) {
    return res.status(404).json({ error: "character_not_found" });
  }

  const sourceSlot = character.slots.find((slot) => slot.id === sourceSlotId);
  if (!sourceSlot || !sourceSlot.asset) {
    return res.status(400).json({ error: "source_missing_asset" });
  }

  const normalizedAngle = angle === undefined ? undefined : (angle as CharacterAngle | null);
  const target = ensureSlot(character, {
    slotId: targetSlotId as UUID | undefined,
    label: label ?? sourceSlot.label,
    angle: normalizedAngle ?? sourceSlot.angle ?? null,
  });

  if (!overwrite && target.asset) {
    return res.status(409).json({ error: "target_has_asset" });
  }

  try {
    // Import the required functions
    const { generateImage } = await import("../lib/gemini");
    const { loadEnv } = await import("../lib/env");
    const { getAssetBuffer } = await import("../services/assetStore");

    const env = loadEnv();

    // Read the source image and convert to base64
    let imageInput: { mimeType: string; data: string } | undefined;
    if (sourceSlot.asset) {
      const sourceImageBuffer = await getAssetBuffer(sourceSlot.asset.id);
      if (sourceImageBuffer) {
        imageInput = {
          mimeType: sourceSlot.asset.mimeType,
          data: sourceImageBuffer.toString('base64')
        };
        console.log(`Using source image: ${sourceSlot.asset.mimeType}, ${sourceImageBuffer.length} bytes`);
      } else {
        console.warn(`Failed to read source image for asset ${sourceSlot.asset.id}`);
      }
    }

    // Build the generation request with source image
    const generationRequest = {
      prompt: prompt || `Generate a character image for ${character.name}`,
      imageInput,
      outputDimensions: {
        width: 512,
        height: 512,
      },
    };

    // Generate the image
    const result = await generateImage(env, generationRequest);
    const imageBuffer = result.imageBuffer;
    const aiDescription = result.aiDescription;

    const asset = await saveAssetBuffer(imageBuffer, {
      scope: ["characters", character.id, target.id, "generated"],
      mimeType: "image/png",
      filename: `generated-${Date.now()}.png`,
      aiDescription,
      generatedFromPrompt: prompt,
      projectSlug,
    });

    assignAsset(character, target.id, asset);
    await upsertCharacter(character);

    res.json({
      status: "generated",
      character,
      slot: target,
      prompt,
    });
  } catch (error) {
    console.error("character:generate_failed", error);
    res.status(500).json({ error: "generation_failed" });
  }
});
