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
} from "../stores/panels";
import { resolveProjectSlug } from "../lib/projectScope";
import { getAsset, getAssetBuffer, saveAsset, saveAssetBuffer } from "../services/assetStore";
import sharp from "sharp";
import { loadEnv } from "../lib/env";
import type { EnvConfig } from "../lib/env";
import { upload } from "../middleware/upload";

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
  strokeWidth: z.number().finite().min(0).optional(),
  strokeColor: z.string().optional(),
  prompt: z.string(),
  notes: z.string().optional(),
  order: z.number().int().nonnegative(),
  geometry: geometrySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const storyboardPageSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  backgroundColor: z.string().optional(),
  panels: z.array(storyboardPanelSchema),
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

const renderPanelSchema = z.object({
  panelId: z.string().uuid(),
  prompt: z.string().min(1),
  referenceAssetId: z.string().uuid().optional(),
  referenceAssetIds: z.array(z.string().uuid()).optional(),
  model: panelRenderModelSchema.optional(),
});

const DEFAULT_PANEL_RENDER_MODEL: PanelRenderModel = "nano-banana";

function resolvePanelRenderModel(
  requested: PanelRenderModel | undefined,
  env: EnvConfig,
  fallbackModel: string,
): string {
  const model = requested ?? DEFAULT_PANEL_RENDER_MODEL;
  if (model === "nano-banana") {
    return env.NANO_BANANA_MODEL ?? fallbackModel;
  }

  if (model === "nano-banana-pro") {
    return env.NANO_BANANA_PRO_MODEL ?? env.NANO_BANANA_MODEL ?? fallbackModel;
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
  const currentPage = getActivePage(projectSlug);
  const panelIndex = currentPage.panels.findIndex(p => p.id === parsed.data.panelId);
  
  if (panelIndex === -1) {
    return res.status(404).json({ error: "panel_not_found" });
  }

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
  const page = getActivePage(projectSlug);
  const panel = page.panels.find((candidate) => candidate.id === parsed.data.panelId);
  if (!panel) {
    return res.status(404).json({ error: "panel_not_found" });
  }

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
  const page = getActivePage(projectSlug);
  const panel = page.panels.find((candidate) => candidate.id === (parsed.data.panelId as UUID));
  if (!panel) {
    return res.status(404).json({ error: "panel_not_found" });
  }

  try {
    const { generateImage, DEFAULT_IMAGE_MODEL } = await import("../lib/gemini");
    const env = loadEnv();

    let imageInput: { mimeType: string; data: string } | undefined;

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
        // Resize single image to target 1024x1024 (contain) to avoid aspect ratio bias
        const resized = await sharp(buffer)
          .resize({
            width: 1024,
            height: 1024,
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
            width: 1024,
            height: 1024,
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
            width: width || 1024,
            height: totalHeight || 1024,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .composite(composites)
          .png()
          .toBuffer();
        
        // Force the combined image into a 1024x1024 container
        const resized = await sharp(combined)
          .resize({
             width: 1024,
             height: 1024,
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

    const generationRequest = {
      prompt: parsed.data.prompt,
      imageInput,
      model: targetModel,
      outputDimensions: {
        width: 1024,
        height: 1024,
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

    res.json({ status: "rendered", page: savedPage, panel: savedPanel, asset });
  } catch (error) {
    console.error("panels:render_failed", error);
    res.status(500).json({ error: "render_failed" });
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
  const pages = listStoryboardPages(projectSlug);
  res.json({ pages });
});

panelsRouter.post("/pages", async (req, res) => {
  const projectSlug = resolveProjectSlug(req);
  const page = await createStoryboardPage(projectSlug);
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
