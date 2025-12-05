import { Router } from "express";
import { z } from "zod";
import type { PromptPresetSet } from "@worldengine/shared";
import { createProject, listProjects, updateProject } from "../stores/projects";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const anglePromptSchema = z.object({
  front: z.string().optional(),
  left: z.string().optional(),
  right: z.string().optional(),
  back: z.string().optional(),
  side: z.string().optional(),
  "three-quarter": z.string().optional(),
});

// Allow empty strings for default/layout prompts; UI may send "" when only
// secondary fields (e.g., spotPrompt) are provided. We trim, but do not enforce
// non-empty at validation time.
const promptPresetSchema = z
  .object({
    character: z
      .object({
        defaultPrompt: z.string().transform((s) => s.trim()).optional(),
        anglePrompts: anglePromptSchema.partial().optional(),
      })
      .partial()
      .optional(),
    location: z
      .object({
        defaultPrompt: z.string().transform((s) => s.trim()).optional(),
        spotPrompt: z.string().transform((s) => s.trim()).optional(),
      })
      .partial()
      .optional(),
    item: z
      .object({
        defaultPrompt: z.string().transform((s) => s.trim()).optional(),
        alternatePrompt: z.string().transform((s) => s.trim()).optional(),
      })
      .partial()
      .optional(),
    storyboard: z
      .object({
        panelPrompt: z.string().transform((s) => s.trim()).optional(),
        layoutPrompt: z.string().transform((s) => s.trim()).optional(),
      })
      .partial()
      .optional(),
  })
  .partial()
  .optional();

const createProjectSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .regex(slugPattern)
    .optional(),
  description: z.string().optional(),
  issueLabel: z.string().optional(),
  /** System prompt prepended to all panel generation requests. */
  systemPrompt: z.string().optional(),
  promptPresets: promptPresetSchema,
});

const updateProjectSchema = createProjectSchema.partial();

function normalizePromptPresets(input?: z.infer<typeof promptPresetSchema>): PromptPresetSet | undefined {
  if (!input) return undefined;
  const presets: PromptPresetSet = {};
  if (input.character) {
    presets.character = {
      defaultPrompt: input.character.defaultPrompt ?? "",
      anglePrompts: input.character.anglePrompts,
    };
  }
  if (input.location) {
    presets.location = {
      defaultPrompt: input.location.defaultPrompt ?? "",
      spotPrompt: input.location.spotPrompt,
    };
  }
  if (input.item) {
    presets.item = {
      defaultPrompt: input.item.defaultPrompt ?? "",
      alternatePrompt: input.item.alternatePrompt,
    };
  }
  if (input.storyboard) {
    presets.storyboard = {
      panelPrompt: input.storyboard.panelPrompt ?? "",
      layoutPrompt: input.storyboard.layoutPrompt,
    };
  }

  return Object.keys(presets).length > 0 ? presets : undefined;
}

export const projectsRouter = Router();

projectsRouter.get("/", (_req, res) => {
  res.json({ projects: listProjects() });
});

projectsRouter.post("/", async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_project_payload", issues: parsed.error.flatten() });
  }

  try {
    const { promptPresets, systemPrompt, ...rest } = parsed.data;
    const project = await createProject({
      ...rest,
      systemPrompt: systemPrompt?.trim() || undefined,
      promptPresets: normalizePromptPresets(promptPresets),
    });
    res.status(201).json({ project });
  } catch (error) {
    console.error("projects:create_failed", error);
    res.status(500).json({ error: "project_creation_failed" });
  }
});

projectsRouter.patch("/:projectId", async (req, res) => {
  const params = z
    .object({
      projectId: z.string().uuid(),
    })
    .safeParse(req.params);

  if (!params.success) {
    return res.status(400).json({ error: "invalid_project_id", issues: params.error.flatten() });
  }

  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_project_payload", issues: parsed.error.flatten() });
  }

  try {
    const { promptPresets, systemPrompt, ...rest } = parsed.data;
    const project = await updateProject(params.data.projectId, {
      ...rest,
      systemPrompt: systemPrompt?.trim() || undefined,
      promptPresets: normalizePromptPresets(promptPresets),
    });
    res.json({ project });
  } catch (error) {
    if ((error as Error).message === "project_not_found") {
      return res.status(404).json({ error: "project_not_found" });
    }
    console.error("projects:update_failed", error);
    res.status(500).json({ error: "project_update_failed" });
  }
});
