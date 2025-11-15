import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PanelGeometry, StoryboardPage, StoryboardPanel, UUID } from "@worldengine/shared";
import { DEFAULT_DATA_ROOT } from "../lib/env";
import { DEFAULT_PROJECT_SLUG } from "../lib/constants";
import { normalizeProjectSlug } from "../lib/projectScope";

interface StoryboardDocument {
  pages: StoryboardPage[];
  activePageId: UUID;
  updatedAt: string;
}

let documentRoot = path.join(DEFAULT_DATA_ROOT, "projects");
const documentCaches = new Map<string, StoryboardDocument>();
let initialized = false;

function now() {
  return new Date().toISOString();
}

function clamp(value: number, min = 0, max = 1) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitizeGeometry(geometry: PanelGeometry): PanelGeometry {
  const x = clamp(geometry.x);
  const y = clamp(geometry.y);
  const width = clamp(geometry.width, 0.01, 1);
  const height = clamp(geometry.height, 0.01, 1);
  const maxWidth = 1 - x;
  const maxHeight = 1 - y;
  return {
    x,
    y,
    width: clamp(width, 0.01, maxWidth <= 0 ? 1 : maxWidth),
    height: clamp(height, 0.01, maxHeight <= 0 ? 1 : maxHeight),
  };
}

function createDefaultPage(): StoryboardPage {
  const pageId = randomUUID();
  const createdAt = now();

  const panels: StoryboardPanel[] = [
    {
      id: randomUUID(),
      pageId,
      label: "Panel 1",
      characterId: undefined,
      locationId: undefined,
      itemId: undefined,
      prompt: "",
      notes: undefined,
      order: 0,
      geometry: { x: 0.05, y: 0.05, width: 0.4, height: 0.4 },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: randomUUID(),
      pageId,
      label: "Panel 2",
      characterId: undefined,
      locationId: undefined,
      itemId: undefined,
      prompt: "",
      notes: undefined,
      order: 1,
      geometry: { x: 0.55, y: 0.05, width: 0.4, height: 0.4 },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: randomUUID(),
      pageId,
      label: "Panel 3",
      characterId: undefined,
      locationId: undefined,
      itemId: undefined,
      prompt: "",
      notes: undefined,
      order: 2,
      geometry: { x: 0.05, y: 0.5, width: 0.9, height: 0.4 },
      createdAt,
      updatedAt: createdAt,
    },
  ];

  return {
    id: pageId,
    label: "Page 1",
    width: 1,
    height: 1,
    panels,
    createdAt,
    updatedAt: createdAt,
  };
}

function resolveDocumentPath(slug: string) {
  return path.join(documentRoot, slug, "panels.json");
}

function loadDocument(slug: string): StoryboardDocument {
  const filePath = resolveDocumentPath(slug);
  try {
    const contents = readFileSync(filePath, "utf8");
    return JSON.parse(contents) as StoryboardDocument;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("panels:load_failed", error);
    }
    const fallbackPage = createDefaultPage();
    const document: StoryboardDocument = {
      pages: [fallbackPage],
      activePageId: fallbackPage.id,
      updatedAt: fallbackPage.updatedAt,
    };
    void persistDocument(slug, document);
    return document;
  }
}

async function persistDocument(slug: string, document?: StoryboardDocument) {
  const current = document ?? documentCaches.get(slug);
  if (!current) return;
  const filePath = resolveDocumentPath(slug);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(current, null, 2), "utf8");
}

function ensureInitialized() {
  if (initialized) return;
  initializePanelStore(DEFAULT_DATA_ROOT).catch((error) => {
    console.error("panels:lazy_init_failed", error);
  });
  initialized = true;
}

function ensureDocument(slugInput: string) {
  ensureInitialized();
  const slug = normalizeProjectSlug(slugInput ?? DEFAULT_PROJECT_SLUG);
  if (documentCaches.has(slug)) {
    return documentCaches.get(slug)!;
  }

  const document = loadDocument(slug);
  documentCaches.set(slug, document);
  return document;
}

export async function initializePanelStore(root: string) {
  documentRoot = path.join(root, "projects");
  await mkdir(documentRoot, { recursive: true });
  documentCaches.clear();
  initialized = true;
}

export function getActivePage(projectSlug: string): StoryboardPage {
  const document = ensureDocument(projectSlug);
  const active = document.pages.find((page) => page.id === document.activePageId);
  if (active) {
    return active;
  }

  const fallback = document.pages[0] ?? createDefaultPage();
  if (document.pages.length === 0) {
    document.pages.push(fallback);
  }
  document.activePageId = fallback.id;
  document.updatedAt = now();
  return fallback;
}

function mergePanel(existing: StoryboardPanel | undefined, incoming: StoryboardPanel, index: number, pageId: UUID) {
  const timestamp = now();
  const createdAt = existing?.createdAt ?? incoming.createdAt ?? timestamp;
  const geometry = sanitizeGeometry(incoming.geometry);

  const label = incoming.label?.trim() || existing?.label || `Panel ${index + 1}`;
  const prompt = incoming.prompt ?? existing?.prompt ?? "";
  const notes = incoming.notes ?? existing?.notes;

  return {
    id: incoming.id,
    pageId,
    label,
    characterId: incoming.characterId ?? existing?.characterId,
    locationId: incoming.locationId ?? existing?.locationId,
    itemId: incoming.itemId ?? existing?.itemId,
    prompt,
    notes,
    order: incoming.order ?? existing?.order ?? index,
    geometry,
    createdAt,
    updatedAt: timestamp,
  } satisfies StoryboardPanel;
}

export async function saveStoryboardPage(projectSlug: string, page: StoryboardPage) {
  const slug = normalizeProjectSlug(projectSlug ?? DEFAULT_PROJECT_SLUG);
  const document = ensureDocument(slug);

  const activeIndex = document.pages.findIndex((candidate) => candidate.id === page.id);
  const existingPage = activeIndex >= 0 ? document.pages[activeIndex] : undefined;

  const panels = page.panels.map((panel, index) =>
    mergePanel(existingPage?.panels.find((candidate) => candidate.id === panel.id), panel, index, page.id),
  );

  const updatedPage: StoryboardPage = {
    id: page.id,
    label: page.label?.trim() || existingPage?.label || "Page",
    width: clamp(page.width, 0.1, 10),
    height: clamp(page.height, 0.1, 10),
    panels,
    createdAt: existingPage?.createdAt ?? page.createdAt ?? now(),
    updatedAt: now(),
  };

  if (activeIndex >= 0) {
    document.pages.splice(activeIndex, 1, updatedPage);
  } else {
    document.pages.push(updatedPage);
  }

  document.activePageId = updatedPage.id;
  document.updatedAt = updatedPage.updatedAt;

  await persistDocument(slug, document);

  return updatedPage;
}
