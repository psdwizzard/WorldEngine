import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { ItemAngle, ItemReference, UUID } from "@worldengine/shared";
import { upload } from "../middleware/upload";
import { saveAsset } from "../services/assetStore";
import { resolveProjectSlug } from "../lib/projectScope";

const itemPayload = z.object({
  itemId: z.string().uuid().optional(),
  label: z.string().min(1),
  referenceAssetId: z.string().uuid().optional(),
  angle: z.enum(["primary", "alternate"]).default("primary"),
});

const nullableUuid = z
  .string()
  .uuid()
  .or(z.literal(""))
  .optional()
  .transform((value) => (value ? value : undefined));

const uploadSchema = z.object({
  itemId: nullableUuid,
  label: z.string().optional(),
  angle: z.enum(["primary", "alternate"]),
});

const items = new Map<UUID, ItemReference>();

function ensureItem(itemId: UUID | undefined, label?: string): ItemReference {
  if (itemId && items.has(itemId)) {
    const existing = items.get(itemId)!;
    if (label && label.trim()) {
      existing.label = label.trim();
      existing.updatedAt = new Date().toISOString();
    }
    return existing;
  }

  const id = itemId ?? randomUUID();
  const now = new Date().toISOString();
  const record: ItemReference = {
    id,
    label: label?.trim() && label.trim().length > 0 ? label.trim() : "Untitled Item",
    description: undefined,
    angleAssets: {
      primary: null,
      alternate: null,
    },
    createdAt: now,
    updatedAt: now,
  };

  items.set(id, record);
  return record;
}

export const itemsRouter = Router();

itemsRouter.post("/generate", (req, res) => {
  const parsed = itemPayload.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const item = ensureItem(parsed.data.itemId as UUID | undefined, parsed.data.label);
  if (parsed.data.referenceAssetId) {
    const angle = parsed.data.angle as ItemAngle;
    item.angleAssets[angle] = {
      id: parsed.data.referenceAssetId,
      url: `/assets/${parsed.data.referenceAssetId}`,
      mimeType: "application/octet-stream",
      width: 0,
      height: 0,
    };
  }
  item.updatedAt = new Date().toISOString();
  items.set(item.id, item);

  res.json({ status: "queued", item });
});

itemsRouter.post("/upload", upload.single("reference"), async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_form_fields", issues: parsed.error.flatten() });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "file_required" });
  }

  const projectSlug = resolveProjectSlug(req);
  const item = ensureItem(parsed.data.itemId as UUID | undefined, parsed.data.label);

  try {
    const angle = parsed.data.angle as ItemAngle;
    const asset = await saveAsset(file, ["items", item.id, angle], projectSlug);
    item.angleAssets[angle] = asset;
    item.updatedAt = new Date().toISOString();
    items.set(item.id, item);

    res.json({
      status: "stored",
      item,
      asset,
      angle,
    });
  } catch (error) {
    console.error("item:upload_failed", error);
    res.status(500).json({ error: "asset_store_failure" });
  }
});

itemsRouter.get("/", (_req, res) => {
  res.json({ items: Array.from(items.values()) });
});
