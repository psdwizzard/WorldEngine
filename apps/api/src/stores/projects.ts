import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectSummary, PromptPresetSet, UUID } from "@worldengine/shared";
import { DEFAULT_DATA_ROOT } from "../lib/env";

type ProjectRecord = ProjectSummary & { userKey?: string };

const projects = new Map<UUID, ProjectRecord>();

let projectsPath = path.join(DEFAULT_DATA_ROOT, "projects.json");
let initialized = false;

async function persistProjects() {
  await mkdir(path.dirname(projectsPath), { recursive: true });
  const payload = Array.from(projects.values());
  await writeFile(projectsPath, JSON.stringify(payload, null, 2), "utf8");
}

function slugifyName(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "project";
}

function ensureUniqueSlug(baseSlug: string) {
  // Slugs MUST be globally unique because the on-disk layout is
  // `workspace-data/projects/<slug>/...` (shared by characters/locations/items/
  // panels/asset files). Two users with the same slug would write into the
  // same directory and see each other's data. Per-owner uniqueness was a
  // privacy bug; collisions now resolve via -2/-3 suffixes regardless of owner.
  let candidate = baseSlug;
  let suffix = 2;
  const existing = new Set(
    Array.from(projects.values()).map((project) => project.slug),
  );
  while (existing.has(candidate)) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function loadProjects() {
  try {
    const contents = await readFile(projectsPath, "utf8");
    const payload = JSON.parse(contents) as ProjectRecord[];
    projects.clear();
    payload.forEach((record) => projects.set(record.id, record));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("projects:load_failed", error);
    }
  }
}

function ensureInitialized() {
  if (initialized) return;
  initializeProjectStore(DEFAULT_DATA_ROOT).catch((error) => {
    console.error("projects:lazy_init_failed", error);
  });
  initialized = true;
}

export async function initializeProjectStore(root: string) {
  projectsPath = path.join(root, "projects.json");
  await mkdir(path.dirname(projectsPath), { recursive: true });
  await loadProjects();
  initialized = true;
}

export function listProjects(userKey?: string): ProjectRecord[] {
  ensureInitialized();
  return Array.from(projects.values())
    .filter((project) => !userKey || project.userKey === userKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function findProjectById(projectId: UUID): ProjectRecord | null {
  ensureInitialized();
  return projects.get(projectId) ?? null;
}

export function findProjectBySlug(slug: string): ProjectRecord | null {
  ensureInitialized();
  for (const project of projects.values()) {
    if (project.slug === slug) {
      return project;
    }
  }
  return null;
}

export function userOwnsProjectSlug(userKey: string | undefined, slug: string): boolean {
  if (!userKey) return true;
  // Slugs are unique per-user (ensureUniqueSlug filters by owner), so multiple
  // projects can share the same slug across users. Iterate all matches and look
  // for the one owned by this user; otherwise findProjectBySlug returns the
  // first arbitrary record and silently 404s legitimate assets.
  for (const project of projects.values()) {
    if (project.slug === slug && project.userKey === userKey) return true;
  }
  return false;
}

export async function createProject(input: {
  name: string;
  slug?: string;
  description?: string;
  issueLabel?: string;
  systemPrompt?: string;
  promptPresets?: PromptPresetSet;
  userKey?: string;
}): Promise<ProjectRecord> {
  ensureInitialized();
  const now = new Date().toISOString();
  const baseSlug = slugifyName(input.slug ?? input.name);
  const uniqueSlug = ensureUniqueSlug(baseSlug);
  const id = randomUUID();
  const project: ProjectRecord = {
    id,
    name: input.name.trim(),
    slug: uniqueSlug,
    description: input.description?.trim() || undefined,
    issueLabel: input.issueLabel?.trim() || undefined,
    systemPrompt: input.systemPrompt?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    promptPresets: input.promptPresets,
    userKey: input.userKey,
  };

  projects.set(project.id, project);
  await persistProjects();
  return project;
}

export async function updateProject(projectId: UUID, updates: Partial<Omit<ProjectRecord, "id" | "createdAt">>) {
  ensureInitialized();
  const existing = projects.get(projectId);
  if (!existing) {
    throw new Error("project_not_found");
  }

  let slug = existing.slug;
  if (updates.slug && updates.slug !== existing.slug) {
    slug = ensureUniqueSlug(slugifyName(updates.slug));
  }

  const updated: ProjectRecord = {
    ...existing,
    ...updates,
    slug,
    name: updates.name?.trim() ?? existing.name,
    description: updates.description?.trim() ?? existing.description,
    issueLabel: updates.issueLabel?.trim() ?? existing.issueLabel,
    systemPrompt: updates.systemPrompt !== undefined
      ? (updates.systemPrompt?.trim() || undefined)
      : existing.systemPrompt,
    updatedAt: new Date().toISOString(),
  };

  projects.set(projectId, updated);
  await persistProjects();
  return updated;
}
