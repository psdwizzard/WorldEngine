import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { PanelPrompt, StoryboardPage, StoryboardPanel, UUID } from "@worldengine/shared";
import { getActivePage, saveStoryboardPage } from "../stores/panels";
import { resolveProjectSlug } from "../lib/projectScope";
import { getAsset, getAssetBuffer, saveAsset, saveAssetBuffer } from "../services/assetStore";
import { loadEnv } from "../lib/env";
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

const renderPanelSchema = z.object({
  panelId: z.string().uuid(),
  prompt: z.string().min(1),
  referenceAssetId: z.string().uuid().optional(),
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
    const { generateImage } = await import("../lib/gemini");
    const env = loadEnv();

    let imageInput: { mimeType: string; data: string } | undefined;
    if (parsed.data.referenceAssetId) {
      const asset = getAsset(parsed.data.referenceAssetId);
      const buffer = await getAssetBuffer(parsed.data.referenceAssetId);
      if (asset && buffer) {
        imageInput = {
          mimeType: asset.meta.mimeType,
          data: buffer.toString("base64"),
        };
      }
    }

    const generationRequest = {
      prompt: parsed.data.prompt,
      imageInput,
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
