import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { resolveProjectSlug } from "../lib/projectScope";
import { listAssets } from "../services/assetStore";

const listSchema = z.object({
  scopePrefix: z.string().optional(),
});

export const assetsRouter = Router();

/**
 * List known assets for the current project.
 *
 * Notes:
 * - This is meant for local tooling (Photoshop plugin) and returns metadata only.
 * - Binary data should be fetched via GET /assets/:assetId.
 */
assetsRouter.get("/", (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const prefix = parsed.data.scopePrefix?.trim();

  const assets = listAssets()
    .filter((asset) => asset.projectSlug === projectSlug)
    .filter((asset) => {
      if (!prefix) return true;
      const expected = `${projectSlug}${path.sep}${prefix}`;
      return asset.filePath.startsWith(expected);
    })
    .map((asset) => ({
      id: asset.id,
      url: asset.url,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      aiDescription: asset.aiDescription,
      generatedFromPrompt: asset.generatedFromPrompt,
      originalName: asset.originalName,
      size: asset.size,
    }));

  res.json({ assets });
});
