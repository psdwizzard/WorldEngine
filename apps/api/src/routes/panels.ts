import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { PanelPrompt, PanelRenderModel, StoryboardPage, StoryboardPanel, UUID } from "@worldengine/shared";
import { PANEL_RENDER_MODEL_VALUES } from "@worldengine/shared";
import {
  getActivePage,
  saveStoryboardPage,
  listStoryboardPages,
  createStoryboardPage,
  setActiveStoryboardPage,
  deleteStoryboardPage,
  findPanelById,
} from "../stores/panels";
import { resolveProjectSlug } from "../lib/projectScope";
import { findProjectBySlug } from "../stores/projects";
import { getAsset, getAssetBuffer, saveAsset, saveAssetBuffer } from "../services/assetStore";
import sharp from "sharp";
import { writePsd, Layer, Psd } from "ag-psd";
import { loadEnv } from "../lib/env";
import type { EnvConfig } from "../lib/env";
import { upload } from "../middleware/upload";

/**
 * Convert sharp image buffer to imageData format that ag-psd expects.
 * Returns { width, height, data: Uint8ClampedArray } in RGBA format.
 */
async function sharpToImageData(
  buffer: Buffer,
  targetWidth?: number,
  targetHeight?: number
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  let pipeline = sharp(buffer);
  
  if (targetWidth && targetHeight) {
    pipeline = pipeline.resize(targetWidth, targetHeight, { fit: "fill" });
  }
  
  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data),
  };
}

/**
 * Create a solid color imageData for backgrounds.
 */
function createSolidColorImageData(
  width: number,
  height: number,
  color: { r: number; g: number; b: number; a: number }
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color.r;
    data[i * 4 + 1] = color.g;
    data[i * 4 + 2] = color.b;
    data[i * 4 + 3] = color.a;
  }
  return { width, height, data };
}

/**
 * Parse a CSS color string to RGBA values.
 */
function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  // Default to white
  let r = 255, g = 255, b = 255, a = 255;
  
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else if (color.startsWith("rgb")) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match) {
      r = parseInt(match[1], 10);
      g = parseInt(match[2], 10);
      b = parseInt(match[3], 10);
      a = match[4] ? Math.round(parseFloat(match[4]) * 255) : 255;
    }
  }
  
  return { r, g, b, a };
}

const panelPayload = z.object({
  panelId: z.string().uuid().optional(),
  label: z.string().optional(),
  characterId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  prompt: z.string().min(1),
});

const geometrySchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0.01).max(1),
  height: z.number().finite().min(0.01).max(1),
  cornerOffsets: z.object({
    topLeft: z.object({ x: z.number(), y: z.number() }).optional(),
    topRight: z.object({ x: z.number(), y: z.number() }).optional(),
    bottomLeft: z.object({ x: z.number(), y: z.number() }).optional(),
    bottomRight: z.object({ x: z.number(), y: z.number() }).optional(),
  }).optional(),
});

const storyboardPanelSchema = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  label: z.string().min(1),
  characterId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  renderAssetId: z.string().uuid().optional(),
  renderScale: z.number().finite().positive().optional(),
  renderOffsetX: z.number().finite().optional(),
  renderOffsetY: z.number().finite().optional(),
  rotation: z.number().finite().min(-180).max(180).optional(),
  shadowBlur: z.number().finite().min(0).max(200).optional(),
  shadowColor: z.string().optional(),
  strokeWidth: z.number().finite().min(0).optional(),
  strokeColor: z.string().optional(),
  prompt: z.string(),
  notes: z.string().optional(),
  order: z.number().int().nonnegative(),
  geometry: geometrySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const captionBoxSchema = z.object({
  id: z.string().uuid(),
  geometry: geometrySchema,
  text: z.string(),
  fontFamily: z.string().optional(),
  fontSize: z.number().finite().positive().optional(),
  fill: z.string(),
  stroke: z.string(),
  strokeWidth: z.number().finite().min(0),
  shadowOffset: z.number().finite().min(0),
  shadowColor: z.string(),
  roughness: z.number().finite().min(0).max(1),
  seed: z.number().finite(),
  order: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const bubbleSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["speech", "thought"]),
  geometry: geometrySchema,
  text: z.string(),
  fontFamily: z.string().optional(),
  fontSize: z.number().finite().positive().optional(),
  fill: z.string(),
  stroke: z.string(),
  strokeWidth: z.number().finite().min(0),
  tailAngle: z.number().finite(),
  tailLength: z.number().finite().min(0).max(1),
  /** ID of another bubble this one links FROM (for chained dialogue). */
  linkedToId: z.string().uuid().optional(),
  order: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const storyboardPageSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  backgroundColor: z.string().optional(),
  issueLabel: z.string().optional(),
  panels: z.array(storyboardPanelSchema),
  captionBoxes: z.array(captionBoxSchema).optional(),
  bubbles: z.array(bubbleSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createPanelSchema = z.object({
  geometry: geometrySchema.optional(),
});

const deletePanelSchema = z.object({
  panelId: z.string().uuid(),
});

const panelRenderModelSchema = z.enum(PANEL_RENDER_MODEL_VALUES);

const renderDimensionsSchema = z.object({
  width: z.number().int().min(512).max(2048),
  height: z.number().int().min(512).max(2048),
});

const renderPanelSchema = z.object({
  panelId: z.string().uuid(),
  prompt: z.string().min(1),
  referenceAssetId: z.string().uuid().optional(),
  referenceAssetIds: z.array(z.string().uuid()).optional(),
  outputDimensions: renderDimensionsSchema.optional(),
  model: panelRenderModelSchema.optional(),
});

const DEFAULT_PANEL_RENDER_MODEL: PanelRenderModel = "nano-banana";

const editPanelSchema = z.object({
  panelId: z.string().uuid(),
  prompt: z.string().min(1),
  assetId: z.string().uuid().optional(),
  model: panelRenderModelSchema.optional(),
  outputDimensions: renderDimensionsSchema.optional(),
});

// Default model mappings for panel render options
const NANO_BANANA_DEFAULT = "gemini-2.5-flash-image";
const NANO_BANANA_PRO_DEFAULT = "gemini-3-pro-image-preview";

function resolvePanelRenderModel(
  requested: PanelRenderModel | undefined,
  env: EnvConfig,
  fallbackModel: string,
): string {
  const model = requested ?? DEFAULT_PANEL_RENDER_MODEL;

  if (model === "nano-banana") {
    return env.NANO_BANANA_MODEL ?? NANO_BANANA_DEFAULT;
  }

  if (model === "nano-banana-pro") {
    // Use gemini-3-pro-image-preview for Pro by default
    return env.NANO_BANANA_PRO_MODEL ?? NANO_BANANA_PRO_DEFAULT;
  }

  return fallbackModel;
}

const pageIdParamSchema = z.object({
  pageId: z.string().uuid(),
});

export const panelsRouter = Router();

panelsRouter.post("/generate", (req, res) => {
  const parsed = panelPayload.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const draftPanel: PanelPrompt = {
    id: randomUUID(),
    pageId: randomUUID(),
    label: parsed.data.label ?? "Panel",
    characterId: parsed.data.characterId,
    locationId: parsed.data.locationId,
    itemId: parsed.data.itemId,
    prompt: parsed.data.prompt,
    notes: undefined,
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  res.json({ status: "queued", panel: draftPanel });
});

panelsRouter.post("/create", async (req, res) => {
  const parsed = createPanelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const currentPage = getActivePage(projectSlug);
  const timestamp = new Date().toISOString();
  
  // Default geometry if not provided - place in available space
  const defaultGeometry = parsed.data.geometry ?? {
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.3,
  };

  const newPanel = {
    id: randomUUID(),
    pageId: currentPage.id,
    label: `Panel ${currentPage.panels.length + 1}`,
    renderAssetId: undefined,
    prompt: "",
    order: currentPage.panels.length,
    geometry: defaultGeometry,
    rotation: 0,
    shadowBlur: 0,
    shadowColor: "rgba(0,0,0,0.35)",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const updatedPage = {
    ...currentPage,
    panels: [...currentPage.panels, newPanel],
    updatedAt: timestamp,
  };

  const savedPage = await saveStoryboardPage(projectSlug, updatedPage);
  res.json({ page: savedPage, panel: newPanel });
});

panelsRouter.delete("/:panelId", async (req, res) => {
  const parsed = deletePanelSchema.safeParse({ panelId: req.params.panelId });
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_panel_id", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  
  // Search ALL pages for the panel, not just the active page
  const found = findPanelById(projectSlug, parsed.data.panelId as UUID);
  if (!found) {
    return res.status(404).json({ error: "panel_not_found" });
  }
  
  const { page: currentPage } = found;
  const panelIndex = currentPage.panels.findIndex(p => p.id === parsed.data.panelId);

  // Don't allow deleting the last panel
  if (currentPage.panels.length <= 1) {
    return res.status(400).json({ error: "cannot_delete_last_panel" });
  }

  const updatedPanels = currentPage.panels.filter(p => p.id !== parsed.data.panelId);
  // Reorder remaining panels
  const reorderedPanels = updatedPanels.map((panel, index) => ({
    ...panel,
    order: index,
    updatedAt: new Date().toISOString(),
  }));

  const updatedPage = {
    ...currentPage,
    panels: reorderedPanels,
    updatedAt: new Date().toISOString(),
  };

  const savedPage = await saveStoryboardPage(projectSlug, updatedPage);
  res.json({ page: savedPage });
});

panelsRouter.post("/:panelId/asset", upload.single("image"), async (req, res) => {
  const parsed = deletePanelSchema.safeParse({ panelId: req.params.panelId });
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_panel_id", issues: parsed.error.flatten() });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "file_required" });
  }

  const projectSlug = resolveProjectSlug(req);
  
  // Search ALL pages for the panel, not just the active page
  const found = findPanelById(projectSlug, parsed.data.panelId as UUID);
  if (!found) {
    return res.status(404).json({ error: "panel_not_found" });
  }
  
  const { page, panel } = found;

  try {
    const asset = await saveAsset(file, ["panels", page.id, panel.id, "upload"], projectSlug);

    const updatedPanel: StoryboardPanel = {
      ...panel,
      renderAssetId: asset.id,
      updatedAt: new Date().toISOString(),
    };

    const updatedPage: StoryboardPage = {
      ...page,
      panels: page.panels.map((candidate) => (candidate.id === updatedPanel.id ? updatedPanel : candidate)),
      updatedAt: new Date().toISOString(),
    };

    const savedPage = await saveStoryboardPage(projectSlug, updatedPage);
    const savedPanel = savedPage.panels.find((candidate) => candidate.id === updatedPanel.id) ?? updatedPanel;

    res.json({ status: "replaced", page: savedPage, panel: savedPanel, asset });
  } catch (error) {
    console.error("panels:asset_replace_failed", error);
    res.status(500).json({ error: "asset_store_failure" });
  }
});

panelsRouter.post("/render", async (req, res) => {
  const parsed = renderPanelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_render_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  
  // Search ALL pages for the panel, not just the active page
  const found = findPanelById(projectSlug, parsed.data.panelId as UUID);
  if (!found) {
    return res.status(404).json({ error: "panel_not_found" });
  }
  
  const { page, panel } = found;

  try {
    const { generateImage, DEFAULT_IMAGE_MODEL } = await import("../lib/gemini");
    const env = loadEnv();

    let imageInput: { mimeType: string; data: string } | undefined;
    const targetWidth = parsed.data.outputDimensions?.width ?? 1024;
    const targetHeight = parsed.data.outputDimensions?.height ?? 1024;

    const referenceIds: UUID[] = [];
    if (parsed.data.referenceAssetId) {
      referenceIds.push(parsed.data.referenceAssetId as UUID);
    }
    if (parsed.data.referenceAssetIds && parsed.data.referenceAssetIds.length > 0) {
      for (const id of parsed.data.referenceAssetIds) {
        if (!referenceIds.includes(id as UUID)) {
          referenceIds.push(id as UUID);
        }
      }
    }

    if (referenceIds.length === 1) {
      const assetId = referenceIds[0];
      const asset = getAsset(assetId);
      const buffer = await getAssetBuffer(assetId);
      if (asset && buffer) {
        // Resize single image to target dimensions (contain) to avoid aspect ratio bias
        const resized = await sharp(buffer)
          .resize({
            width: targetWidth,
            height: targetHeight,
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 1 }, // Black background for "void"
          })
          .png()
          .toBuffer();

        imageInput = {
          mimeType: "image/png",
          data: resized.toString("base64"),
        };
      }
    } else if (referenceIds.length > 1) {
      const buffers: Buffer[] = [];
      for (const id of referenceIds) {
        const buffer = await getAssetBuffer(id);
        if (buffer) {
          buffers.push(buffer);
        }
      }

      if (buffers.length === 1) {
        const resized = await sharp(buffers[0])
          .resize({
            width: targetWidth,
            height: targetHeight,
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          })
          .png()
          .toBuffer();

        imageInput = {
          mimeType: "image/png",
          data: resized.toString("base64"),
        };
      } else if (buffers.length > 1) {
        // Combine multiple reference images into a single stacked image for Gemini.
        const normalized = await Promise.all(buffers.map((buffer) => sharp(buffer).png().toBuffer()));
        const metas = await Promise.all(normalized.map((buffer) => sharp(buffer).metadata()));

        const width = Math.max(...metas.map((meta) => meta.width ?? 0));
        const totalHeight = metas.reduce((sum, meta) => sum + (meta.height ?? 0), 0);

        let currentTop = 0;
        const composites = normalized.map((buffer, index) => {
          const meta = metas[index];
          const top = currentTop;
          currentTop += meta.height ?? 0;
          return { input: buffer, top, left: 0 };
        });

        const combined = await sharp({
          create: {
            width: width || targetWidth,
            height: totalHeight || targetHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .composite(composites)
          .png()
          .toBuffer();
        
        // Force the combined image into a target-sized container
        const resized = await sharp(combined)
          .resize({
             width: targetWidth,
             height: targetHeight,
             fit: "contain",
             background: { r: 0, g: 0, b: 0, alpha: 1 },
          })
          .png()
          .toBuffer();

        imageInput = {
          mimeType: "image/png",
          data: resized.toString("base64"),
        };
      }
    }

    const targetModel = resolvePanelRenderModel(parsed.data.model, env, DEFAULT_IMAGE_MODEL);

    // Prepend project's system prompt if available
    const project = findProjectBySlug(projectSlug);
    const systemPrompt = project?.systemPrompt?.trim();
    const finalPrompt = systemPrompt
      ? `${systemPrompt}\n\n${parsed.data.prompt}`
      : parsed.data.prompt;

    const generationRequest = {
      prompt: finalPrompt,
      imageInput,
      model: targetModel,
      outputDimensions: {
        width: targetWidth,
        height: targetHeight,
      },
    };

    const result = await generateImage(env, generationRequest, {
      apiKeyOverride: req.header("x-gemini-key") ?? undefined,
    });

    const asset = await saveAssetBuffer(result.imageBuffer, {
      scope: ["panels", page.id, panel.id],
      mimeType: "image/png",
      filename: `panel-${panel.order + 1}-${Date.now()}.png`,
      aiDescription: result.aiDescription,
      generatedFromPrompt: parsed.data.prompt,
      projectSlug,
    });

    // Preserve the old render in replacedAssetIds history (if there was one)
    const replacedAssetIds = [...(panel.replacedAssetIds ?? [])];
    if (panel.renderAssetId) {
      replacedAssetIds.push(panel.renderAssetId);
    }

    const updatedPanel: StoryboardPanel = {
      ...panel,
      renderAssetId: asset.id,
      replacedAssetIds: replacedAssetIds.length > 0 ? replacedAssetIds : undefined,
      updatedAt: new Date().toISOString(),
    };

    const updatedPage: StoryboardPage = {
      ...page,
      panels: page.panels.map((candidate) => (candidate.id === updatedPanel.id ? updatedPanel : candidate)),
      updatedAt: new Date().toISOString(),
    };

    const savedPage = await saveStoryboardPage(projectSlug, updatedPage);
    const savedPanel = savedPage.panels.find((candidate) => candidate.id === updatedPanel.id) ?? updatedPanel;

    res.json({ status: "rendered", page: savedPage, panel: savedPanel, asset });
  } catch (error) {
    console.error("panels:render_failed", error);
    res.status(500).json({ error: "render_failed" });
  }
});

panelsRouter.post("/edit", async (req, res) => {
  const parsed = editPanelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_edit_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);

  // Search ALL pages for the panel, not just the active page
  const found = findPanelById(projectSlug, parsed.data.panelId as UUID);
  if (!found) {
    return res.status(404).json({ error: "panel_not_found" });
  }

  const { page, panel } = found;
  const fallbackAssetId = panel.renderAssetId ?? panel.replacedAssetIds?.[panel.replacedAssetIds.length - 1];
  const targetAssetId = parsed.data.assetId ?? fallbackAssetId;

  if (!targetAssetId) {
    return res.status(400).json({ error: "missing_panel_asset" });
  }

  try {
    const { generateImage, DEFAULT_IMAGE_MODEL } = await import("../lib/gemini");
    const env = loadEnv();
    const asset = getAsset(targetAssetId);
    const buffer = await getAssetBuffer(targetAssetId);

    if (!asset || !buffer) {
      return res.status(404).json({ error: "panel_asset_not_found" });
    }

    const metadata = await sharp(buffer).metadata();
    const maxDimension = 2048;
    const minDimension = 512;

    let targetWidth = parsed.data.outputDimensions?.width ?? metadata.width ?? 1024;
    let targetHeight = parsed.data.outputDimensions?.height ?? metadata.height ?? 1024;

    if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
      targetWidth = 1024;
    }
    if (!Number.isFinite(targetHeight) || targetHeight <= 0) {
      targetHeight = 1024;
    }

    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      const scale = Math.min(maxDimension / targetWidth, maxDimension / targetHeight);
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }

    if (targetWidth < minDimension || targetHeight < minDimension) {
      const scale = Math.max(minDimension / targetWidth, minDimension / targetHeight);
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }

    const resizedBase = await sharp(buffer)
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .png()
      .toBuffer();

    const targetModel = resolvePanelRenderModel(parsed.data.model, env, DEFAULT_IMAGE_MODEL);

    // Prepend project's system prompt if available
    const project = findProjectBySlug(projectSlug);
    const systemPrompt = project?.systemPrompt?.trim();
    const finalPrompt = systemPrompt
      ? `${systemPrompt}\n\n${parsed.data.prompt}`
      : parsed.data.prompt;

    const result = await generateImage(
      env,
      {
        prompt: finalPrompt,
        imageInput: {
          mimeType: asset.meta.mimeType || "image/png",
          data: resizedBase.toString("base64"),
        },
        model: targetModel,
        outputDimensions: {
          width: targetWidth,
          height: targetHeight,
        },
      },
      {
        apiKeyOverride: req.header("x-gemini-key") ?? undefined,
      },
    );

    const editedAsset = await saveAssetBuffer(result.imageBuffer, {
      scope: ["panels", page.id, panel.id],
      mimeType: "image/png",
      filename: `panel-${panel.order + 1}-edit-${Date.now()}.png`,
      aiDescription: result.aiDescription,
      generatedFromPrompt: parsed.data.prompt,
      projectSlug,
    });

    const replacedAssetIds = [...(panel.replacedAssetIds ?? [])];
    const pushIfMissing = (id?: UUID | null) => {
      if (id && !replacedAssetIds.includes(id)) {
        replacedAssetIds.push(id);
      }
    };
    pushIfMissing(panel.renderAssetId);
    // Ensure the edited source is in history even if it was not the latest.
    if (targetAssetId !== panel.renderAssetId) {
      pushIfMissing(targetAssetId as UUID);
    }

    const updatedPanel: StoryboardPanel = {
      ...panel,
      renderAssetId: editedAsset.id,
      replacedAssetIds: replacedAssetIds.length > 0 ? replacedAssetIds : undefined,
      updatedAt: new Date().toISOString(),
    };

    const updatedPage: StoryboardPage = {
      ...page,
      panels: page.panels.map((candidate) => (candidate.id === updatedPanel.id ? updatedPanel : candidate)),
      updatedAt: new Date().toISOString(),
    };

    const savedPage = await saveStoryboardPage(projectSlug, updatedPage);
    const savedPanel = savedPage.panels.find((candidate) => candidate.id === updatedPanel.id) ?? updatedPanel;

    res.json({ status: "edited", page: savedPage, panel: savedPanel, asset: editedAsset });
  } catch (error) {
    console.error("panels:edit_failed", error);
    res.status(500).json({ error: "edit_failed" });
  }
});

panelsRouter.get("/", (req, res) => {
  const projectSlug = resolveProjectSlug(req);
  const page = getActivePage(projectSlug);
  res.json({ panels: page.panels, page });
});

panelsRouter.get("/layout", (req, res) => {
  const projectSlug = resolveProjectSlug(req);
  const page = getActivePage(projectSlug);
  res.json({ page });
});

panelsRouter.put("/layout", async (req, res) => {
  const parsed = storyboardPageSchema.safeParse(req.body?.page ?? req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_layout", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const page = await saveStoryboardPage(projectSlug, parsed.data);
  res.json({ page });
});

panelsRouter.get("/pages", (req, res) => {
  const projectSlug = resolveProjectSlug(req);
  const issueLabel = typeof req.query.issueLabel === "string" ? req.query.issueLabel : undefined;
  const pages = listStoryboardPages(projectSlug, issueLabel);
  res.json({ pages });
});

const createPageSchema = z.object({
  issueLabel: z.string().optional(),
});

panelsRouter.post("/pages", async (req, res) => {
  const parsed = createPageSchema.safeParse(req.body);
  const projectSlug = resolveProjectSlug(req);
  const issueLabel = parsed.success ? parsed.data.issueLabel : undefined;
  const page = await createStoryboardPage(projectSlug, issueLabel);
  res.status(201).json({ page });
});

panelsRouter.post("/pages/:pageId/activate", async (req, res) => {
  const parsed = pageIdParamSchema.safeParse({ pageId: req.params.pageId });
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_page_id", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const page = await setActiveStoryboardPage(projectSlug, parsed.data.pageId as UUID);
  if (!page) {
    return res.status(404).json({ error: "page_not_found" });
  }

  res.json({ page });
});

panelsRouter.delete("/pages/:pageId", async (req, res) => {
  const parsed = pageIdParamSchema.safeParse({ pageId: req.params.pageId });
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_page_id", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const activePage = await deleteStoryboardPage(projectSlug, parsed.data.pageId as UUID);
  
  if (!activePage) {
     return res.status(404).json({ error: "page_not_found" });
  }

  res.json({ page: activePage });
});

const updatePageIssueSchema = z.object({
  issueLabel: z.string().optional().nullable(),
});

// Update a page's issue label (for assigning orphaned pages or moving pages between issues)
panelsRouter.patch("/pages/:pageId/issue", async (req, res) => {
  const paramsParsed = pageIdParamSchema.safeParse({ pageId: req.params.pageId });
  if (!paramsParsed.success) {
    return res.status(400).json({ error: "invalid_page_id", issues: paramsParsed.error.flatten() });
  }

  const bodyParsed = updatePageIssueSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: bodyParsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const pages = listStoryboardPages(projectSlug);
  const page = pages.find((p) => p.id === paramsParsed.data.pageId);
  
  if (!page) {
    return res.status(404).json({ error: "page_not_found" });
  }

  // Update the page's issueLabel
  const updatedPage: StoryboardPage = {
    ...page,
    issueLabel: bodyParsed.data.issueLabel ?? undefined,
    updatedAt: new Date().toISOString(),
  };

  const savedPage = await saveStoryboardPage(projectSlug, updatedPage);
  res.json({ page: savedPage });
});

const exportPageSchema = z.object({
  pageId: z.string().uuid(),
  imageData: z.string().min(1), // base64 encoded PNG
  outputFolder: z.string().min(1),
  filename: z.string().optional(),
  comicName: z.string().optional(), // Override for folder name (defaults to projectSlug)
  issueName: z.string().optional(), // Override for issue folder (defaults to page.issueLabel)
});

/**
 * Export a rendered page image to the specified output folder.
 * This allows saving directly to disk instead of downloading.
 */
panelsRouter.post("/pages/:pageId/export", async (req, res) => {
  const parsed = exportPageSchema.safeParse({
    pageId: req.params.pageId,
    ...req.body,
  });

  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_export_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const pages = listStoryboardPages(projectSlug);
  const page = pages.find((p) => p.id === parsed.data.pageId);

  if (!page) {
    return res.status(404).json({ error: "page_not_found" });
  }

  try {
    const { outputFolder, imageData, filename, comicName, issueName } = parsed.data;
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Build organized folder structure: outputFolder/ComicName/IssueName/PNG
    const safeComicName = (comicName || projectSlug || "Comic").replace(/[^\w.-]+/g, "-");
    const safeIssueName = (issueName || page.issueLabel || "Issue 01").replace(/[^\w.-]+/g, "-");
    const exportFolder = path.join(outputFolder, safeComicName, safeIssueName, "PNG");

    // Ensure output folder exists
    await fs.mkdir(exportFolder, { recursive: true });

    // Generate filename from page label if not provided
    const safeLabel = (filename || page.label || "page").replace(/[^\w.-]+/g, "-");
    const baseFilename = safeLabel.endsWith(".png") ? safeLabel.slice(0, -4) : safeLabel;

    // Find next available version number
    let version = 1;
    let outputFilename = `${baseFilename}-V${version}.png`;
    let outputPath = path.join(exportFolder, outputFilename);

    // Check for existing versions and increment
    const existingFiles = await fs.readdir(exportFolder).catch(() => []);
    const versionPattern = new RegExp(`^${baseFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-V(\\d+)\\.png$`, "i");
    
    for (const file of existingFiles) {
      const match = file.match(versionPattern);
      if (match) {
        const existingVersion = parseInt(match[1], 10);
        if (existingVersion >= version) {
          version = existingVersion + 1;
        }
      }
    }

    outputFilename = `${baseFilename}-V${version}.png`;
    outputPath = path.join(exportFolder, outputFilename);

    // Decode base64 and write to file
    const buffer = Buffer.from(imageData, "base64");
    await fs.writeFile(outputPath, buffer);

    res.json({
      status: "exported",
      path: outputPath,
      filename: outputFilename,
      version,
    });
  } catch (error) {
    console.error("panels:export_failed", error);
    res.status(500).json({
      error: "export_failed",
      message: error instanceof Error ? error.message : "Failed to export page",
    });
  }
});

const exportPsdSchema = z.object({
  pageId: z.string().uuid(),
  outputFolder: z.string().min(1),
  filename: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  comicName: z.string().optional(), // Override for folder name (defaults to projectSlug)
  issueName: z.string().optional(), // Override for issue folder (defaults to page.issueLabel)
});

/**
 * Export a page as a layered PSD file.
 * Each panel becomes its own layer, preserving editability in Photoshop.
 */
panelsRouter.post("/pages/:pageId/export-psd", async (req, res) => {
  const parsed = exportPsdSchema.safeParse({
    pageId: req.params.pageId,
    ...req.body,
  });

  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_export_payload", issues: parsed.error.flatten() });
  }

  const projectSlug = resolveProjectSlug(req);
  const pages = listStoryboardPages(projectSlug);
  const page = pages.find((p) => p.id === parsed.data.pageId);

  if (!page) {
    return res.status(404).json({ error: "page_not_found" });
  }

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { outputFolder, filename, comicName, issueName } = parsed.data;

    // Use provided dimensions or fall back to page dimensions or defaults
    const hasNormalizedSize =
      page.width > 0 && page.width <= 1 && page.height > 0 && page.height <= 1;
    const psdWidth = parsed.data.width ?? Math.round(hasNormalizedSize ? 1988 : page.width || 1988);
    const psdHeight = parsed.data.height ?? Math.round(hasNormalizedSize ? 3075 : page.height || 3075);

    // Build organized folder structure: outputFolder/ComicName/IssueName/PSD
    const safeComicName = (comicName || projectSlug || "Comic").replace(/[^\w.-]+/g, "-");
    const safeIssueName = (issueName || page.issueLabel || "Issue 01").replace(/[^\w.-]+/g, "-");
    const exportFolder = path.join(outputFolder, safeComicName, safeIssueName, "PSD");

    // Ensure output folder exists
    await fs.mkdir(exportFolder, { recursive: true });

    // Generate filename with versioning
    const safeLabel = (filename || page.label || "page").replace(/[^\w.-]+/g, "-");
    const baseFilename = safeLabel.endsWith(".psd") ? safeLabel.slice(0, -4) : safeLabel;

    let version = 1;
    const existingFiles = await fs.readdir(exportFolder).catch(() => []);
    const versionPattern = new RegExp(`^${baseFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-V(\\d+)\\.psd$`, "i");

    for (const file of existingFiles) {
      const match = file.match(versionPattern);
      if (match) {
        const existingVersion = parseInt(match[1], 10);
        if (existingVersion >= version) {
          version = existingVersion + 1;
        }
      }
    }

    const outputFilename = `${baseFilename}-V${version}.psd`;
    const outputPath = path.join(exportFolder, outputFilename);

    // Build the PSD structure
    const layers: Layer[] = [];

    // Create background layer
    const bgColor = parseColor(page.backgroundColor ?? "#ffffff");
    const backgroundImageData = createSolidColorImageData(psdWidth, psdHeight, bgColor);
    layers.push({
      name: "Background",
      imageData: backgroundImageData,
      left: 0,
      top: 0,
      opacity: 1,
      blendMode: "normal",
    });

    // Sort panels by order (lower order = further back)
    const sortedPanels = [...page.panels].sort((a, b) => a.order - b.order);

    // Create a layer for each panel
    for (const panel of sortedPanels) {
      if (!panel.renderAssetId) continue;

      const assetBuffer = await getAssetBuffer(panel.renderAssetId);
      if (!assetBuffer) continue;

      // Calculate panel position and size in pixels
      const panelX = Math.round(panel.geometry.x * psdWidth);
      const panelY = Math.round(panel.geometry.y * psdHeight);
      const panelW = Math.round(panel.geometry.width * psdWidth);
      const panelH = Math.round(panel.geometry.height * psdHeight);
      const rotation = panel.rotation ?? 0;

      try {
        // Get original image metadata
        const metadata = await sharp(assetBuffer).metadata();
        const imgWidth = metadata.width ?? panelW;
        const imgHeight = metadata.height ?? panelH;

        // Calculate how the image fits in the panel (same logic as frontend)
        const imageAspect = imgWidth / imgHeight || 1;
        const panelAspect = panelW / panelH || 1;
        const containScale = panelAspect > imageAspect 
          ? panelH / imgHeight 
          : panelW / imgWidth;

        const scale = (panel.renderScale ?? 1) * containScale;
        const offsetX = panel.renderOffsetX ?? 0;
        const offsetY = panel.renderOffsetY ?? 0;

        // Calculate final image dimensions
        const drawW = Math.round(imgWidth * scale);
        const drawH = Math.round(imgHeight * scale);

        // Calculate image position (centered in panel + offsets)
        const centerX = panelX + panelW / 2;
        const centerY = panelY + panelH / 2;

        // Build sharp pipeline with rotation if needed
        let pipeline = sharp(assetBuffer).resize(drawW, drawH, { fit: "fill" });
        
        // Apply rotation if present
        let finalWidth = drawW;
        let finalHeight = drawH;
        if (rotation !== 0) {
          // Rotate the image - sharp rotates around center
          pipeline = pipeline.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
          
          // Calculate the bounding box after rotation
          const radians = (Math.abs(rotation) * Math.PI) / 180;
          const cos = Math.cos(radians);
          const sin = Math.sin(radians);
          finalWidth = Math.ceil(Math.abs(drawW * cos) + Math.abs(drawH * sin));
          finalHeight = Math.ceil(Math.abs(drawW * sin) + Math.abs(drawH * cos));
        }

        const resizedBuffer = await pipeline.ensureAlpha().png().toBuffer();
        
        // Get actual dimensions after rotation
        const finalMetadata = await sharp(resizedBuffer).metadata();
        const actualWidth = finalMetadata.width ?? finalWidth;
        const actualHeight = finalMetadata.height ?? finalHeight;

        const imageData = await sharpToImageData(resizedBuffer);

        // Position accounting for rotation expansion
        const imgLeft = Math.round(centerX + offsetX * panelW - actualWidth / 2);
        const imgTop = Math.round(centerY + offsetY * panelH - actualHeight / 2);

        // Create the panel layer
        const panelLayer: Layer = {
          name: panel.label || `Panel ${panel.order + 1}`,
          imageData,
          left: imgLeft,
          top: imgTop,
          opacity: 1,
          blendMode: "normal",
        };

        layers.push(panelLayer);

        // Add stroke as a separate layer if present
        // Note: strokeWidth is in export pixels, not UI pixels
        if (panel.strokeWidth && panel.strokeWidth > 0) {
          const strokeColor = panel.strokeColor ?? "#000000";
          // The strokeWidth from the panel is already in "export" scale since it's stored as-is
          const sw = panel.strokeWidth;
          const offsets = panel.geometry.cornerOffsets;

          // Create stroke SVG - stroke is drawn ON the panel boundary
          let strokeSvg: string;
          if (offsets) {
            // Custom shape with corner offsets
            // Offsets are fractions of panel size, corners start at panel edges
            const tl = { 
              x: (offsets.topLeft?.x ?? 0) * panelW, 
              y: (offsets.topLeft?.y ?? 0) * panelH 
            };
            const tr = { 
              x: panelW + (offsets.topRight?.x ?? 0) * panelW, 
              y: (offsets.topRight?.y ?? 0) * panelH 
            };
            const br = { 
              x: panelW + (offsets.bottomRight?.x ?? 0) * panelW, 
              y: panelH + (offsets.bottomRight?.y ?? 0) * panelH 
            };
            const bl = { 
              x: (offsets.bottomLeft?.x ?? 0) * panelW, 
              y: panelH + (offsets.bottomLeft?.y ?? 0) * panelH 
            };
            strokeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${panelW}" height="${panelH}" viewBox="0 0 ${panelW} ${panelH}">
              <polygon points="${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" stroke-linejoin="miter"/>
            </svg>`;
          } else {
            // Simple rectangle stroke - centered on the panel edge
            strokeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${panelW}" height="${panelH}" viewBox="0 0 ${panelW} ${panelH}">
              <rect x="${sw / 2}" y="${sw / 2}" width="${panelW - sw}" height="${panelH - sw}" fill="none" stroke="${strokeColor}" stroke-width="${sw}"/>
            </svg>`;
          }

          try {
            const strokeBuffer = await sharp(Buffer.from(strokeSvg)).png().toBuffer();
            const strokeImageData = await sharpToImageData(strokeBuffer);

            layers.push({
              name: `${panel.label || `Panel ${panel.order + 1}`} - Stroke`,
              imageData: strokeImageData,
              left: panelX,
              top: panelY,
              opacity: 1,
              blendMode: "normal",
            });
          } catch (strokeError) {
            console.warn("Failed to create stroke layer:", strokeError);
          }
        }
      } catch (panelError) {
        console.warn(`Failed to process panel ${panel.id}:`, panelError);
      }
    }

    // Create caption box layers
    // Scale factor for fonts/strokes: UI preview ~500px, export ~2000px
    const uiPreviewWidth = 500;
    const exportScale = psdWidth / uiPreviewWidth;

    const captionBoxes = page.captionBoxes ?? [];
    for (const caption of captionBoxes) {
      const capX = Math.round(caption.geometry.x * psdWidth);
      const capY = Math.round(caption.geometry.y * psdHeight);
      const capW = Math.round(caption.geometry.width * psdWidth);
      const capH = Math.round(caption.geometry.height * psdHeight);

      const fill = caption.fill ?? "#f5f5f0";
      const stroke = caption.stroke ?? "#1a1a1a";
      const sw = Math.max(1, Math.round((caption.strokeWidth ?? 2) * exportScale));
      const shadowOff = Math.round((caption.shadowOffset ?? 3) * exportScale);
      const shadowColor = caption.shadowColor ?? "#1a1a1a";

      try {
        // Generate rough edge points (matching frontend CaptionBox rendering)
        const seededRandom = (seed: number) => {
          const x = Math.sin(seed) * 10000;
          return x - Math.floor(x);
        };

        const generateRoughPoints = (
          startX: number, startY: number, endX: number, endY: number,
          segments: number, roughness: number, seed: number, isHorizontal: boolean
        ): Array<{ x: number; y: number }> => {
          const points: Array<{ x: number; y: number }> = [];
          const dx = (endX - startX) / segments;
          const dy = (endY - startY) / segments;
          const perpX = isHorizontal ? 0 : 1;
          const perpY = isHorizontal ? 1 : 0;
          const maxOffset = 2.5 * roughness * exportScale;

          for (let i = 0; i <= segments; i++) {
            const baseX = startX + dx * i;
            const baseY = startY + dy * i;
            const edgeFactor = i === 0 || i === segments ? 0.2 : 1;
            const offsetSeed = seed + i * 137.5 + (isHorizontal ? 0 : 1000);
            const randomOffset = (seededRandom(offsetSeed) - 0.5) * 2 * maxOffset * edgeFactor;
            const tearSeed = seed + i * 73.1 + (isHorizontal ? 2000 : 3000);
            const hasTear = seededRandom(tearSeed) > 0.92;
            const tearAmount = hasTear ? (seededRandom(tearSeed + 1) - 0.5) * maxOffset * 2.5 : 0;
            points.push({
              x: baseX + perpX * (randomOffset + tearAmount),
              y: baseY + perpY * (randomOffset + tearAmount),
            });
          }
          return points;
        };

        const edgeDetail = 24;
        const roughness = caption.roughness ?? 0.7;
        const seed = caption.seed ?? 0;
        
        // Extra padding for rough points that go outside the box bounds
        const roughPadding = Math.ceil(2.5 * roughness * exportScale * 3); // Max possible offset

        // Generate rough edges for all 4 sides (offset by roughPadding to keep in positive space)
        const topEdge = generateRoughPoints(roughPadding, roughPadding, capW + roughPadding, roughPadding, edgeDetail, roughness, seed, true);
        const rightEdge = generateRoughPoints(capW + roughPadding, roughPadding, capW + roughPadding, capH + roughPadding, edgeDetail, roughness, seed + 100, false);
        const bottomEdge = generateRoughPoints(capW + roughPadding, capH + roughPadding, roughPadding, capH + roughPadding, edgeDetail, roughness, seed + 200, true);
        const leftEdge = generateRoughPoints(roughPadding, capH + roughPadding, roughPadding, roughPadding, edgeDetail, roughness, seed + 300, false);

        const allPoints = [...topEdge, ...rightEdge.slice(1), ...bottomEdge.slice(1), ...leftEdge.slice(1)];
        const pathPoints = allPoints.map(p => `${p.x},${p.y}`).join(" ");

        // Shadow points (offset from main box)
        const shadowPoints = allPoints.map(p => `${p.x + shadowOff},${p.y + shadowOff}`).join(" ");

        // Canvas needs to be larger to fit roughness padding + shadow + stroke
        const canvasW = capW + roughPadding * 2 + shadowOff + sw;
        const canvasH = capH + roughPadding * 2 + shadowOff + sw;
        
        // Build SVG with rough polygon shape
        let captionSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">`;
        
        // Shadow polygon (offset to bottom-right)
        if (shadowOff > 0) {
          captionSvg += `<polygon points="${shadowPoints}" fill="${shadowColor}" opacity="0.9"/>`;
        }
        
        // Main caption box polygon with stroke
        captionSvg += `<polygon points="${pathPoints}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
        captionSvg += `</svg>`;

        const captionBuffer = await sharp(Buffer.from(captionSvg)).png().toBuffer();
        const captionImageData = await sharpToImageData(captionBuffer);

        layers.push({
          name: `Caption Box: ${(caption.text || "").slice(0, 20)}`,
          imageData: captionImageData,
          left: capX - roughPadding,
          top: capY - roughPadding,
          opacity: 1,
          blendMode: "normal",
        });

        // Add text layer
        if (caption.text) {
          const baseFontSizePx = (caption.fontSize ?? 0.7) * 16;
          const fontSize = Math.max(12, Math.round(baseFontSizePx * exportScale));
          const fontFamily = caption.fontFamily ?? "Courier New, monospace";
          const lineHeight = Math.round(fontSize * 1.3);
          const padX = Math.round(0.6 * 16 * exportScale);
          const padY = Math.round(0.5 * 16 * exportScale);
          const maxW = capW - padX * 2;

          // Word wrap
          const charsPerLine = Math.max(5, Math.floor(maxW / (fontSize * 0.6)));
          const words = caption.text.split(/\s+/);
          const lines: string[] = [];
          let line = "";
          for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (test.length > charsPerLine && line) {
              lines.push(line);
              line = w;
            } else {
              line = test;
            }
          }
          if (line) lines.push(line);

          const tspans = lines.map((l, i) => {
            const y = padY + fontSize + i * lineHeight;
            const escaped = l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return `<tspan x="${padX}" y="${y}">${escaped}</tspan>`;
          }).join("");

          const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${capW}" height="${capH}">
            <text font-family="${fontFamily}" font-size="${fontSize}" fill="#1a1a1a">${tspans}</text>
          </svg>`;

          try {
            const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();
            const textImageData = await sharpToImageData(textBuffer);
            layers.push({
              name: `Caption Text`,
              imageData: textImageData,
              left: capX,
              top: capY,
              opacity: 1,
              blendMode: "normal",
            });
          } catch (textErr) {
            console.warn("Caption text failed:", textErr);
          }
        }
      } catch (captionErr) {
        console.warn("Caption layer failed:", captionErr);
      }
    }

    // Create bubble connector layers for linked bubbles
    const bubbles = page.bubbles ?? [];
    for (const bubble of bubbles) {
      if (!bubble.linkedToId) continue;
      const parentBubble = bubbles.find((b) => b.id === bubble.linkedToId);
      if (!parentBubble) continue;

      try {
        // Calculate center points in pixels
        const parentCenterX = (parentBubble.geometry.x + parentBubble.geometry.width / 2) * psdWidth;
        const parentCenterY = (parentBubble.geometry.y + parentBubble.geometry.height / 2) * psdHeight;
        const childCenterX = (bubble.geometry.x + bubble.geometry.width / 2) * psdWidth;
        const childCenterY = (bubble.geometry.y + bubble.geometry.height / 2) * psdHeight;

        // Calculate edge points
        const dx = childCenterX - parentCenterX;
        const dy = childCenterY - parentCenterY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) continue; // Too close, skip

        const angle = Math.atan2(dy, dx);

        const parentRx = (parentBubble.geometry.width / 2) * psdWidth;
        const parentRy = (parentBubble.geometry.height / 2) * psdHeight;
        const parentEdgeX = parentCenterX + parentRx * 0.8 * Math.cos(angle);
        const parentEdgeY = parentCenterY + parentRy * 0.8 * Math.sin(angle);

        const childRx = (bubble.geometry.width / 2) * psdWidth;
        const childRy = (bubble.geometry.height / 2) * psdHeight;
        const childEdgeX = childCenterX - childRx * 0.8 * Math.cos(angle);
        const childEdgeY = childCenterY - childRy * 0.8 * Math.sin(angle);

        const fill = bubble.fill ?? "#ffffff";
        const stroke = bubble.stroke ?? "#000000";
        const outerStrokeW = Math.round(8 * exportScale);
        const innerStrokeW = Math.round(5 * exportScale);

        // Calculate bounding box for the connector line
        const padding = outerStrokeW + 2;
        const minX = Math.min(parentEdgeX, childEdgeX) - padding;
        const maxX = Math.max(parentEdgeX, childEdgeX) + padding;
        const minY = Math.min(parentEdgeY, childEdgeY) - padding;
        const maxY = Math.max(parentEdgeY, childEdgeY) + padding;

        const svgW = Math.max(4, Math.ceil(maxX - minX));
        const svgH = Math.max(4, Math.ceil(maxY - minY));

        // Offset to local SVG coordinates
        const localParentX = parentEdgeX - minX;
        const localParentY = parentEdgeY - minY;
        const localChildX = childEdgeX - minX;
        const localChildY = childEdgeY - minY;

        // Draw connector as two lines: outer stroke + inner fill
        const connectorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">
          <line x1="${localParentX}" y1="${localParentY}" x2="${localChildX}" y2="${localChildY}" stroke="${stroke}" stroke-width="${outerStrokeW}" stroke-linecap="round"/>
          <line x1="${localParentX}" y1="${localParentY}" x2="${localChildX}" y2="${localChildY}" stroke="${fill}" stroke-width="${innerStrokeW}" stroke-linecap="round"/>
        </svg>`;

        const connectorBuffer = await sharp(Buffer.from(connectorSvg)).png().toBuffer();
        const connectorImageData = await sharpToImageData(connectorBuffer);

        layers.push({
          name: "Bubble Connector",
          imageData: connectorImageData,
          left: Math.round(minX),
          top: Math.round(minY),
          opacity: 1,
          blendMode: "normal",
        });
      } catch (connectorErr) {
        console.warn("Bubble connector layer failed:", connectorErr);
      }
    }

    // Create speech/thought bubble layers
    // All coordinates calculated directly in pixel space (no viewBox scaling)
    for (const bubble of bubbles) {
      const bubX = Math.round(bubble.geometry.x * psdWidth);
      const bubY = Math.round(bubble.geometry.y * psdHeight);
      const bubW = Math.round(bubble.geometry.width * psdWidth);
      const bubH = Math.round(bubble.geometry.height * psdHeight);

      const fill = bubble.fill ?? "#ffffff";
      const stroke = bubble.stroke ?? "#000000";
      const sw = Math.max(1, Math.round((bubble.strokeWidth ?? 2) * exportScale));
      const tailAngle = bubble.tailAngle ?? 240;
      const tailLength = bubble.tailLength ?? 0.3;

      // Calculate bubble geometry in actual pixels
      // Leave room for tail: ellipse is in upper portion
      const padding = bubW * 0.04;
      const cx = bubW / 2;
      const cy = bubH * (0.5 - tailLength * 0.15); // Shift up based on tail
      const rx = bubW / 2 - padding;
      const ry = bubH * (0.5 - tailLength * 0.15) - padding;

      let bubbleSvg: string;

      if (bubble.type === "thought") {
        // Thought bubble: main ellipse + 3 trailing circles
        // Use expanded canvas that can fit circles in any direction
        const angleRad = (tailAngle * Math.PI) / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        
        // Make canvas 50% larger to accommodate circles in any direction
        const canvasW = Math.round(bubW * 1.5);
        const canvasH = Math.round(bubH * 1.5);
        const canvasCx = canvasW / 2;
        const canvasCy = canvasH / 2;
        
        // Ellipse centered in expanded canvas
        const ellipseRx = bubW * 0.4;
        const ellipseRy = bubH * 0.35;
        
        // Trailing circles
        const tailLen = Math.max(bubW, bubH) * tailLength * 0.8;
        const c1Dist = ellipseRx + tailLen * 0.3;
        const c2Dist = ellipseRx + tailLen * 0.55;
        const c3Dist = ellipseRx + tailLen * 0.8;
        const c1R = bubW * 0.055;
        const c2R = bubW * 0.04;
        const c3R = bubW * 0.025;

        const c1X = canvasCx + c1Dist * cosA;
        const c1Y = canvasCy + c1Dist * sinA;
        const c2X = canvasCx + c2Dist * cosA;
        const c2Y = canvasCy + c2Dist * sinA;
        const c3X = canvasCx + c3Dist * cosA;
        const c3Y = canvasCy + c3Dist * sinA;

        bubbleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
          <ellipse cx="${canvasCx}" cy="${canvasCy}" rx="${ellipseRx}" ry="${ellipseRy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
          <circle cx="${c1X}" cy="${c1Y}" r="${c1R}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
          <circle cx="${c2X}" cy="${c2Y}" r="${c2R}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
          <circle cx="${c3X}" cy="${c3Y}" r="${c3R}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
        </svg>`;

        try {
          const bubbleBuffer = await sharp(Buffer.from(bubbleSvg)).png().toBuffer();
          const bubbleImageData = await sharpToImageData(bubbleBuffer);

          // Center the expanded canvas on the original bubble position
          const layerLeft = bubX - Math.round((canvasW - bubW) / 2);
          const layerTop = bubY - Math.round((canvasH - bubH) / 2);

          layers.push({
            name: `Thought Bubble`,
            imageData: bubbleImageData,
            left: layerLeft,
            top: layerTop,
            opacity: 1,
            blendMode: "normal",
          });

          // Add thought bubble text
          if (bubble.text) {
            const fontSize = Math.max(12, Math.round((bubble.fontSize ?? 0.85) * 16 * exportScale));
            const fontFamily = bubble.fontFamily ?? "Comic Sans MS, cursive, sans-serif";
            const lineHeight = Math.round(fontSize * 1.2);
            const textW = ellipseRx * 1.5;
            const charsPerLine = Math.max(3, Math.floor(textW / (fontSize * 0.55)));
            
            const words = bubble.text.split(/\s+/);
            const lines: string[] = [];
            let line = "";
            for (const w of words) {
              const test = line ? `${line} ${w}` : w;
              if (test.length > charsPerLine && line) {
                lines.push(line);
                line = w;
              } else {
                line = test;
              }
            }
            if (line) lines.push(line);

            const totalH = lines.length * lineHeight;
            const textCenterY = bubH / 2;
            const startY = textCenterY - totalH / 2 + fontSize * 0.8;

            const tspans = lines.map((l, i) => {
              const y = startY + i * lineHeight;
              const escaped = l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              return `<tspan x="${bubW / 2}" y="${y}" text-anchor="middle">${escaped}</tspan>`;
            }).join("");

            const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bubW}" height="${bubH}">
              <text font-family="${fontFamily}" font-size="${fontSize}" fill="#000000">${tspans}</text>
            </svg>`;

            try {
              const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();
              const textImageData = await sharpToImageData(textBuffer);
              layers.push({
                name: `Thought Text`,
                imageData: textImageData,
                left: bubX,
                top: bubY,
                opacity: 1,
                blendMode: "normal",
              });
            } catch (textErr) {
              console.warn("Thought text failed:", textErr);
            }
          }
        } catch (bubbleErr) {
          console.warn("Thought bubble failed:", bubbleErr);
        }
        continue;
      } else {
        // Speech bubble: ellipse with pointed tail
        const angleRad = (tailAngle * Math.PI) / 180;
        const tailSpread = 15 * Math.PI / 180; // 15 degrees spread
        const tailLen = tailLength * bubH * 0.6;

        // Points where tail connects to ellipse
        const base1X = cx + rx * Math.cos(angleRad - tailSpread);
        const base1Y = cy + ry * Math.sin(angleRad - tailSpread);
        const base2X = cx + rx * Math.cos(angleRad + tailSpread);
        const base2Y = cy + ry * Math.sin(angleRad + tailSpread);
        
        // Tail tip
        const tipX = cx + (rx + tailLen) * Math.cos(angleRad);
        const tipY = cy + (ry + tailLen) * Math.sin(angleRad);

        // SVG path: arc around most of ellipse, then tail triangle
        const largeArc = 1; // Go the long way around
        const sweep = 0; // Counter-clockwise
        
        bubbleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bubW}" height="${bubH}">
          <path d="M ${base1X} ${base1Y} A ${rx} ${ry} 0 ${largeArc} ${sweep} ${base2X} ${base2Y} L ${tipX} ${tipY} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
        </svg>`;
      }

      // This block only runs for speech bubbles (thought bubbles continue above)
      try {
        const bubbleBuffer = await sharp(Buffer.from(bubbleSvg)).png().toBuffer();
        const bubbleImageData = await sharpToImageData(bubbleBuffer);

        layers.push({
          name: "Speech Bubble",
          imageData: bubbleImageData,
          left: bubX,
          top: bubY,
          opacity: 1,
          blendMode: "normal",
        });

        // Add bubble text layer
        if (bubble.text) {
          const fontSize = Math.max(12, Math.round((bubble.fontSize ?? 0.85) * 16 * exportScale));
          const fontFamily = bubble.fontFamily ?? "Comic Sans MS, cursive, sans-serif";
          const lineHeight = Math.round(fontSize * 1.2);

          // Text area
          const textW = rx * 1.4;
          const charsPerLine = Math.max(3, Math.floor(textW / (fontSize * 0.55)));
          
          const words = bubble.text.split(/\s+/);
          const lines: string[] = [];
          let line = "";
          for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (test.length > charsPerLine && line) {
              lines.push(line);
              line = w;
            } else {
              line = test;
            }
          }
          if (line) lines.push(line);

          // Center text vertically in ellipse
          const totalH = lines.length * lineHeight;
          const startY = cy - totalH / 2 + fontSize * 0.8;

          const tspans = lines.map((l, i) => {
            const y = startY + i * lineHeight;
            const escaped = l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return `<tspan x="${cx}" y="${y}" text-anchor="middle">${escaped}</tspan>`;
          }).join("");

          const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bubW}" height="${bubH}">
            <text font-family="${fontFamily}" font-size="${fontSize}" fill="#000000">${tspans}</text>
          </svg>`;

          try {
            const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();
            const textImageData = await sharpToImageData(textBuffer);
            layers.push({
              name: `Bubble Text`,
              imageData: textImageData,
              left: bubX,
              top: bubY,
              opacity: 1,
              blendMode: "normal",
            });
          } catch (textErr) {
            console.warn("Bubble text failed:", textErr);
          }
        }
      } catch (bubbleErr) {
        console.warn("Bubble layer failed:", bubbleErr);
      }
    }

    // Build the PSD document
    const psd: Psd = {
      width: psdWidth,
      height: psdHeight,
      channels: 4,
      bitsPerChannel: 8,
      colorMode: 3, // RGB
      children: layers,
    };

    // Write the PSD file
    const psdBuffer = writePsd(psd);
    await fs.writeFile(outputPath, Buffer.from(psdBuffer));

    res.json({
      status: "exported",
      path: outputPath,
      filename: outputFilename,
      version,
      layerCount: layers.length,
    });
  } catch (error) {
    console.error("panels:export_psd_failed", error);
    res.status(500).json({
      error: "export_psd_failed",
      message: error instanceof Error ? error.message : "Failed to export PSD",
    });
  }
});