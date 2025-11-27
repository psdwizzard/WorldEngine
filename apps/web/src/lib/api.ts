import type {
  AssetReference,
  CharacterAngle,
  CharacterProfile,
  CharacterTurnaroundSlot,
  ItemAngle,
  ItemReference,
  LocationBlueprint,
  PanelRenderModel,
  StoryboardPage,
  StoryboardPanel,
  UUID,
} from "@worldengine/shared";

type HeadersInit = Record<string, string>;

// Default to the API dev port (4000). Env can override via VITE_API_BASE_URL.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

function resolveUrl(path: string) {
  if (path.startsWith("http")) return path;
  return `${API_BASE_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeader(options?: { geminiKey?: string; projectId?: string; projectSlug?: string }): HeadersInit {
  const headers: HeadersInit = {};
  if (options?.geminiKey) {
    headers["x-gemini-key"] = options.geminiKey;
  }
  if (options?.projectSlug) {
    headers["x-project-slug"] = options.projectSlug;
  } else if (options?.projectId) {
    headers["x-project-id"] = options.projectId;
  }
  return headers;
}

export interface CharacterPayload extends CharacterProfile {
  slots?: CharacterTurnaroundSlot[];
  defaultSlotId?: UUID;
}

export interface CharacterUploadResponse {
  status: string;
  character: CharacterPayload;
  asset: AssetReference;
  slot: CharacterTurnaroundSlot;
}

export async function uploadCharacterAngle(input: {
  characterId?: UUID;
  name?: string;
  slotId?: UUID;
  slotLabel?: string;
  angle?: CharacterAngle | "";
  setDefault?: boolean;
  file: File;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<CharacterUploadResponse> {
  const formData = new FormData();
  if (input.characterId) formData.append("characterId", input.characterId);
  if (input.name) formData.append("name", input.name);
  if (input.slotId) formData.append("slotId", input.slotId);
  if (input.slotLabel) formData.append("slotLabel", input.slotLabel);
  if (input.angle !== undefined) formData.append("angle", input.angle ?? "");
  if (input.setDefault) formData.append("setDefault", String(input.setDefault));
  formData.append("source", input.file);

  const response = await fetch(resolveUrl("/characters/upload"), {
    method: "POST",
    body: formData,
    headers: authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to upload character reference");
  }

  return (await response.json()) as CharacterUploadResponse;
}

export interface CharacterSlotResponse {
  status: string;
  character: CharacterPayload;
  slot: CharacterTurnaroundSlot;
}

export async function createCharacterSlot(input: {
  characterId?: UUID;
  name?: string;
  slotId?: UUID;
  label: string;
  angle?: CharacterAngle | "";
  setDefault?: boolean;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<CharacterSlotResponse> {
  const response = await fetch(resolveUrl("/characters/slots"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
    },
    body: JSON.stringify({
      characterId: input.characterId,
      slotId: input.slotId,
      name: input.name,
      label: input.label,
      angle: input.angle ?? "",
      setDefault: input.setDefault,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create slot");
  }

  return (await response.json()) as CharacterSlotResponse;
}

export async function generateCharacterSlot(input: {
  characterId: UUID;
  sourceSlotId: UUID;
  targetSlotId?: UUID;
  label?: string;
  angle?: CharacterAngle | "";
  prompt?: string;
  overwrite?: boolean;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<CharacterSlotResponse> {
  const response = await fetch(resolveUrl("/characters/generate/slot"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
    },
    body: JSON.stringify({
      characterId: input.characterId,
      sourceSlotId: input.sourceSlotId,
      targetSlotId: input.targetSlotId ?? "",
      label: input.label,
      angle: input.angle ?? "",
      prompt: input.prompt,
      overwrite: input.overwrite ?? true,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to generate slot");
  }

  return (await response.json()) as CharacterSlotResponse;
}

export async function deleteCharacterSlot(input: {
  slotId: UUID;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<CharacterPayload> {
  const response = await fetch(resolveUrl(`/characters/slots/${input.slotId}`), {
    method: "DELETE",
    headers: authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to remove slot");
  }

  const payload = (await response.json()) as { character: CharacterPayload };
  return payload.character;
}

export async function deleteCharacter(input: {
  characterId: UUID;
  geminiKey?: string;
  projectSlug?: string;
  projectId?: string;
}): Promise<void> {
  const response = await fetch(resolveUrl(`/characters/${input.characterId}`), {
    method: "DELETE",
    headers: authHeader({
      geminiKey: input.geminiKey,
      projectSlug: input.projectSlug,
      projectId: input.projectId,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to delete character");
  }
}

export async function listCharactersForProject(input?: {
  geminiKey?: string;
  projectSlug?: string;
  projectId?: string;
}): Promise<CharacterPayload[]> {
  const response = await fetch(resolveUrl("/characters"), {
    headers: {
      Accept: "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug, projectId: input?.projectId }),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to list characters");
  }

  const payload = (await response.json()) as { characters: CharacterPayload[] };
  return payload.characters;
}

export async function listLocationsForProject(input?: {
  geminiKey?: string;
  projectSlug?: string;
}): Promise<LocationBlueprint[]> {
  const response = await fetch(resolveUrl("/locations"), {
    headers: {
      Accept: "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to list locations");
  }

  const payload = (await response.json()) as { locations: LocationBlueprint[] };
  return payload.locations;
}

export interface LocationUploadResponse {
  status: string;
  location: LocationBlueprint;
  asset: AssetReference;
  spotId: UUID | null;
}

export async function uploadLocationReference(input: {
  locationId?: UUID;
  name?: string;
  spotId?: UUID;
  spotLabel?: string;
  file: File;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<LocationUploadResponse> {
  const formData = new FormData();
  if (input.locationId) formData.append("locationId", input.locationId);
  if (input.name) formData.append("name", input.name);
  if (input.spotId) formData.append("spotId", input.spotId);
  if (input.spotLabel) formData.append("spotLabel", input.spotLabel);
  formData.append("reference", input.file);

  const response = await fetch(resolveUrl("/locations/upload"), {
    method: "POST",
    body: formData,
    headers: authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to upload location reference");
  }

  return (await response.json()) as LocationUploadResponse;
}

export async function generateLocationView(input: {
  locationId?: UUID;
  name?: string;
  label: string;
  prompt: string;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<{ location: LocationBlueprint; spotId: UUID | null; assetId: UUID | null }> {
  const response = await fetch(resolveUrl("/locations/generate-view"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
    },
    body: JSON.stringify({
      locationId: input.locationId,
      name: input.name,
      label: input.label,
      prompt: input.prompt,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to generate location view");
  }

  const payload = (await response.json()) as {
    status: string;
    location: LocationBlueprint;
    spotId: UUID | null;
    asset: AssetReference;
  };

  return {
    location: payload.location,
    spotId: payload.spotId,
    assetId: payload.asset.id,
  };
}

export async function generateLocationFromImage(input: {
  sourceLocationId: UUID;
  sourceAssetId: UUID;
  prompt: string;
  createAsNew: boolean;
  newLocationName?: string;
  spotLabel?: string;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<{ location: LocationBlueprint; spotId?: UUID | null; assetId: UUID | null }> {
  const response = await fetch(resolveUrl("/locations/generate-from-image"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
    },
    body: JSON.stringify({
      sourceLocationId: input.sourceLocationId,
      sourceAssetId: input.sourceAssetId,
      prompt: input.prompt,
      createAsNew: input.createAsNew,
      newLocationName: input.newLocationName,
      spotLabel: input.spotLabel,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to generate location from image");
  }

  const payload = (await response.json()) as {
    status: string;
    location: LocationBlueprint;
    spotId?: UUID | null;
    asset: AssetReference;
  };

  return {
    location: payload.location,
    spotId: payload.spotId,
    assetId: payload.asset.id,
  };
}

export interface ItemUploadResponse {
  status: string;
  item: ItemReference;
  asset: AssetReference;
  angle: ItemAngle;
}

export async function uploadItemReference(input: {
  itemId?: UUID;
  label?: string;
  angle: ItemAngle;
  file: File;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<ItemUploadResponse> {
  const formData = new FormData();
  if (input.itemId) formData.append("itemId", input.itemId);
  if (input.label) formData.append("label", input.label);
  formData.append("angle", input.angle);
  formData.append("reference", input.file);

  const response = await fetch(resolveUrl("/items/upload"), {
    method: "POST",
    body: formData,
    headers: authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to upload item reference");
  }

  return (await response.json()) as ItemUploadResponse;
}

export async function listItemsForProject(input?: {
  geminiKey?: string;
  projectSlug?: string;
}): Promise<ItemReference[]> {
  const response = await fetch(resolveUrl("/items"), {
    headers: {
      Accept: "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to list items");
  }

  const payload = (await response.json()) as { items: ItemReference[] };
  return payload.items;
}

export async function fetchStoryboardLayout(input?: { geminiKey?: string; projectSlug?: string }): Promise<StoryboardPage> {
  const response = await fetch(resolveUrl("/panels/layout"), {
    headers: {
      Accept: "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to load storyboard layout");
  }

  const payload = (await response.json()) as { page: StoryboardPage };
  return payload.page;
}

export async function renameCharacter(input: {
  characterId: UUID;
  name?: string;
  description?: string;
  geminiKey?: string;
  projectSlug?: string;
  projectId?: string;
}): Promise<CharacterPayload> {
  const response = await fetch(resolveUrl(`/characters/${input.characterId}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({
        geminiKey: input.geminiKey,
        projectSlug: input.projectSlug,
        projectId: input.projectId,
      }),
    },
    body: JSON.stringify({
      name: input.name,
      description: input.description,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to rename character");
  }

  const payload = (await response.json()) as { character: CharacterPayload };
  return payload.character;
}

export async function saveStoryboardLayout(
  page: StoryboardPage,
  input?: { geminiKey?: string; projectSlug?: string },
): Promise<StoryboardPage> {
  const response = await fetch(resolveUrl("/panels/layout"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
    body: JSON.stringify({ page }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to save storyboard layout");
  }

  const payload = (await response.json()) as { page: StoryboardPage };
  return payload.page;
}

export async function listStoryboardPages(input?: {
  geminiKey?: string;
  projectSlug?: string;
  issueLabel?: string;
}): Promise<StoryboardPage[]> {
  const url = new URL(resolveUrl("/panels/pages"));
  if (input?.issueLabel) {
    url.searchParams.set("issueLabel", input.issueLabel);
  }
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to list storyboard pages");
  }

  const payload = (await response.json()) as { pages: StoryboardPage[] };
  return payload.pages;
}

export async function createStoryboardPageApi(input?: {
  geminiKey?: string;
  projectSlug?: string;
  issueLabel?: string;
}): Promise<StoryboardPage> {
  const response = await fetch(resolveUrl("/panels/pages"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
    body: JSON.stringify({ issueLabel: input?.issueLabel }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create storyboard page");
  }

  const payload = (await response.json()) as { page: StoryboardPage };
  return payload.page;
}

export async function activateStoryboardPage(
  pageId: UUID,
  input?: { geminiKey?: string; projectSlug?: string },
): Promise<StoryboardPage> {
  const response = await fetch(resolveUrl(`/panels/pages/${pageId}/activate`), {
    method: "POST",
    headers: {
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to activate storyboard page");
  }

  const payload = (await response.json()) as { page: StoryboardPage };
  return payload.page;
}

export async function deleteStoryboardPageApi(
  pageId: UUID,
  input?: { geminiKey?: string; projectSlug?: string },
): Promise<StoryboardPage> {
  const response = await fetch(resolveUrl(`/panels/pages/${pageId}`), {
    method: "DELETE",
    headers: {
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to delete storyboard page");
  }

  const payload = (await response.json()) as { page: StoryboardPage };
  return payload.page;
}

export async function updatePageIssue(
  pageId: UUID,
  issueLabel: string | null,
  input?: { geminiKey?: string; projectSlug?: string },
): Promise<StoryboardPage> {
  const response = await fetch(resolveUrl(`/panels/pages/${pageId}/issue`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
    body: JSON.stringify({ issueLabel }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to update page issue");
  }

  const payload = (await response.json()) as { page: StoryboardPage };
  return payload.page;
}

export async function createPanel(input?: {
  geometry?: PanelGeometry;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<{ page: StoryboardPage; panel: StoryboardPanel }> {
  const response = await fetch(resolveUrl("/panels/create"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
    body: JSON.stringify({ geometry: input?.geometry }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create panel");
  }

  return response.json();
}

export async function deletePanel(panelId: UUID, input?: { geminiKey?: string; projectSlug?: string }): Promise<{ page: StoryboardPage }> {
  const response = await fetch(resolveUrl(`/panels/${panelId}`), {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input?.geminiKey, projectSlug: input?.projectSlug }),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to delete panel");
  }

  return response.json();
}

export async function uploadPanelImage(input: {
  panelId: UUID;
  file: File;
  geminiKey?: string;
  projectSlug?: string;
}): Promise<{ page: StoryboardPage; panel: StoryboardPanel; asset: AssetReference }> {
  const formData = new FormData();
  formData.append("image", input.file);

  const response = await fetch(resolveUrl(`/panels/${input.panelId}/asset`), {
    method: "POST",
    body: formData,
    headers: authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to replace panel image");
  }

  const payload = (await response.json()) as {
    status: string;
    page: StoryboardPage;
    panel: StoryboardPanel;
    asset: AssetReference;
  };

  return { page: payload.page, panel: payload.panel, asset: payload.asset };
}

export async function renderPanelImage(input: {
  panelId: UUID;
  prompt: string;
  referenceAssetId?: UUID;
  referenceAssetIds?: UUID[];
  model?: PanelRenderModel;
  outputDimensions?: {
    width: number;
    height: number;
  };
  geminiKey?: string;
  projectSlug?: string;
}): Promise<{ page: StoryboardPage; panel: StoryboardPanel; asset: AssetReference }> {
  const response = await fetch(resolveUrl("/panels/render"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ geminiKey: input.geminiKey, projectSlug: input.projectSlug }),
    },
    body: JSON.stringify({
      panelId: input.panelId,
      prompt: input.prompt,
      referenceAssetId: input.referenceAssetId,
      referenceAssetIds: input.referenceAssetIds,
      outputDimensions: input.outputDimensions,
      model: input.model,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to render panel image");
  }

  const payload = (await response.json()) as {
    status: string;
    page: StoryboardPage;
    panel: StoryboardPanel;
    asset: AssetReference;
  };

  return { page: payload.page, panel: payload.panel, asset: payload.asset };
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const response = await fetch(resolveUrl("/projects"));
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to load projects");
  }

  const payload = (await response.json()) as { projects: ProjectSummary[] };
  return payload.projects;
}

export async function createProject(input: {
  name: string;
  slug?: string;
  description?: string;
  issueLabel?: string;
  promptPresets?: PromptPresetSet;
}): Promise<ProjectSummary> {
  const response = await fetch(resolveUrl("/projects"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to create project");
  }

  const payload = (await response.json()) as { project: ProjectSummary };
  return payload.project;
}

export async function updateProject(
  projectId: UUID,
  input: {
    name?: string;
    slug?: string;
    description?: string;
    issueLabel?: string;
    promptPresets?: PromptPresetSet;
  },
): Promise<ProjectSummary> {
  const response = await fetch(resolveUrl(`/projects/${projectId}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeader({ projectId }),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to update project");
  }

  const payload = (await response.json()) as { project: ProjectSummary };
  return payload.project;
}

export { API_BASE_URL as apiBaseUrl };

