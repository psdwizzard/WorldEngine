import { Router } from "express";
import { z } from "zod";

const renderAndFetchSchema = z.object({
  panelId: z.string().uuid(),
  prompt: z.string().min(1),
  referenceAssetId: z.string().uuid().optional(),
  referenceAssetIds: z.array(z.string().uuid()).optional(),
  model: z.string().optional(),
  outputDimensions: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  includeBase64: z.boolean().optional().default(false),
});

export const psRouter = Router();

/**
 * Convenience endpoint for Photoshop UXP.
 *
 * This wraps /panels/render and (optionally) returns base64 PNG bytes so
 * the plugin can place the image without a second request.
 */
psRouter.post("/render-and-fetch", async (req, res) => {
  const parsed = renderAndFetchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const origin = `${req.protocol}://${req.get("host")}`;

  const forwardHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const geminiKey = req.header("x-gemini-key");
  if (geminiKey) forwardHeaders["x-gemini-key"] = geminiKey;
  const projectSlug = req.header("x-project-slug");
  if (projectSlug) forwardHeaders["x-project-slug"] = projectSlug;
  const projectId = req.header("x-project-id");
  if (projectId) forwardHeaders["x-project-id"] = projectId;

  const { includeBase64, ...renderBody } = parsed.data;

  const renderResponse = await fetch(`${origin}/panels/render`, {
    method: "POST",
    headers: forwardHeaders,
    body: JSON.stringify(renderBody),
  });

  if (!renderResponse.ok) {
    const text = await renderResponse.text();
    return res.status(renderResponse.status).send(text);
  }

  const payload = (await renderResponse.json()) as {
    status?: string;
    page?: unknown;
    panel?: unknown;
    asset?: { id: string };
  };

  if (!includeBase64 || !payload.asset?.id) {
    return res.json(payload);
  }

  const assetResponse = await fetch(`${origin}/assets/${payload.asset.id}`, {
    method: "GET",
    headers: projectSlug ? { "x-project-slug": projectSlug } : undefined,
  });

  if (!assetResponse.ok) {
    const text = await assetResponse.text();
    return res.status(assetResponse.status).send(text);
  }

  const buffer = Buffer.from(await assetResponse.arrayBuffer());
  const base64Png = buffer.toString("base64");

  res.json({ ...payload, base64Png });
});
