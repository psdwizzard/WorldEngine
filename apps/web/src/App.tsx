import type { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CharacterAngle,
  CharacterTurnaroundSlot,
  ItemAngle,
  ItemReference,
  LocationBlueprint,
  LocationSpot,
  PanelGeometry,
  ProjectSummary,
  PromptPresetSet,
  StoryboardPage,
  StoryboardPanel,
  UUID,
} from "@worldengine/shared";
import { useSettings } from "./hooks/useSettings";
import {
  apiBaseUrl,
  createCharacterSlot,
  createProject,
  createPanel,
  deletePanel,
  fetchProjects,
  fetchStoryboardLayout,
  generateCharacterSlot,
  saveStoryboardLayout,
  uploadCharacterAngle,
  uploadItemReference,
  uploadLocationReference,
  updateProject,
  type CharacterPayload,
  listCharactersForProject,
  listLocationsForProject,
  listItemsForProject,
  deleteCharacter,
  renameCharacter,
  generateLocationView,
  generateLocationFromImage,
  renderPanelImage,
  uploadPanelImage,
} from "./lib/api";
import "./App.css";

function assetHref(pathOrId: string) {
  const base = apiBaseUrl.replace(/\/$/, "");
  if (!pathOrId) {
    return "#";
  }
  if (pathOrId.startsWith("http")) {
    return pathOrId;
  }
  if (pathOrId.startsWith("/")) {
    return `${base}${pathOrId}`;
  }
  return `${base}/assets/${pathOrId}`;
}

const MIN_PANEL_SIZE = 0.12;

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type InteractionMode = "move" | "resize" | "image-pan";

type InteractionState = {
  panelId: UUID;
  mode: InteractionMode;
  corner?: ResizeCorner;
  origin: PanelGeometry;
  pointerStartX: number;
  pointerStartY: number;
  imageOffsetX?: number;
  imageOffsetY?: number;
  panelWidth?: number;
  panelHeight?: number;
};

function clampFraction(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function geometryChanged(a: PanelGeometry, b: PanelGeometry) {
  return (
    Math.abs(a.x - b.x) > 0.0001 ||
    Math.abs(a.y - b.y) > 0.0001 ||
    Math.abs(a.width - b.width) > 0.0001 ||
    Math.abs(a.height - b.height) > 0.0001
  );
}

function moveGeometry(origin: PanelGeometry, dx: number, dy: number): PanelGeometry {
  const x = clampFraction(origin.x + dx, 0, 1 - origin.width);
  const y = clampFraction(origin.y + dy, 0, 1 - origin.height);
  return {
    x,
    y,
    width: origin.width,
    height: origin.height,
  };
}

function resizeGeometry(origin: PanelGeometry, dx: number, dy: number, corner: ResizeCorner): PanelGeometry {
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;

  if (corner.includes("w")) {
    left = clampFraction(left + dx, 0, right - MIN_PANEL_SIZE);
  }
  if (corner.includes("e")) {
    right = clampFraction(right + dx, left + MIN_PANEL_SIZE, 1);
  }
  if (corner.includes("n")) {
    top = clampFraction(top + dy, 0, bottom - MIN_PANEL_SIZE);
  }
  if (corner.includes("s")) {
    bottom = clampFraction(bottom + dy, top + MIN_PANEL_SIZE, 1);
  }

  const width = clampFraction(right - left, MIN_PANEL_SIZE, 1);
  const height = clampFraction(bottom - top, MIN_PANEL_SIZE, 1);

  left = clampFraction(left, 0, 1 - width);
  top = clampFraction(top, 0, 1 - height);

  return {
    x: left,
    y: top,
    width,
    height,
  };
}

type TabKey = "characters" | "project-assets" | "locations" | "items" | "panels" | "settings";

type TabDescriptor = {
  key: TabKey;
  label: string;
  description: string;
};

type SettingsController = ReturnType<typeof useSettings>;

type UploadState = {
  status: "idle" | "uploading" | "success" | "error";
  message?: string;
  assetId?: string;
};

  const TABS: TabDescriptor[] = [
  {
    key: "characters",
    label: "Characters",
    description: "Organize front views and custom slots for each character.",
  },
  {
    key: "project-assets",
    label: "Project Assets",
    description: "Browse characters, locations, items, and storyboard pages for the active project.",
  },
  {
    key: "locations",
    label: "Locations",
    description: "Capture multi-angle shots or generate new spaces with secondary spots.",
  },
  {
    key: "items",
    label: "Items",
    description: "Store props and reference renders for quick reuse across panels.",
  },
  {
    key: "panels",
    label: "Storyboard",
    description: "Lay out a page, tag characters/backgrounds/items, and draft prompts.",
  },
  {
    key: "settings",
    label: "Settings",
    description: "Manage Gemini credentials and workspace preferences.",
  },
];

const CHARACTER_ANGLE_LABELS: Record<CharacterAngle, string> = {
  front: "Front",
  left: "Left",
  right: "Right",
  back: "Back",
  side: "Side",
  "three-quarter": "Three-quarter",
};

const GENERATABLE_CHARACTER_ANGLES: CharacterAngle[] = ["left", "right", "back"];

const itemAngles: ReadonlyArray<ItemAngle> = ["primary", "alternate"];

type CharacterView = CharacterPayload;
type CharacterSlot = CharacterTurnaroundSlot & { angle: CharacterAngle | null };

function slugifyCharacterName(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "character";
}

function formatAngleLabel(name: string, angle: CharacterAngle) {
  return `${slugifyCharacterName(name)}-${angle}`;
}

function describeAngle(angle: CharacterAngle | null) {
  if (!angle) return "Custom";
  return CHARACTER_ANGLE_LABELS[angle] ?? angle;
}

export function App() {
  const settingsController = useSettings();
  const { settings, updateSetting } = settingsController;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsStatus, setProjectsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [projectError, setProjectError] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    setProjectsStatus("loading");
    try {
      const list = await fetchProjects();
      setProjects(list);
      setProjectError(null);
      setProjectsStatus("ready");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Failed to load projects");
      setProjectsStatus("error");
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    // If a project slug is saved but no id, reconcile by slug
    if (settings.projectSlug && !settings.projectId && projectsStatus === "ready") {
      const match = projects.find((p) => p.slug === settings.projectSlug);
      if (match) {
        updateSetting("projectId", match.id);
      }
    }

    if (!settings.projectSlug && projectsStatus === "ready" && projects.length > 0) {
      const [first] = projects;
      if (!first) return;
      if (settings.projectId !== first.id) {
        updateSetting("projectId", first.id);
      }
      updateSetting("projectSlug", first.slug);
    }
  }, [projects, projectsStatus, settings.projectId, settings.projectSlug, updateSetting]);

  const handleProjectSelect = useCallback(
    (projectId: string) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      updateSetting("projectId", project.id);
      updateSetting("projectSlug", project.slug);
    },
    [projects, updateSetting],
  );

  const handleProjectCreated = useCallback(
    async (input: { name: string; description?: string; issueLabel?: string }) => {
      const project = await createProject(input);
      setProjects((previous) => [...previous, project]);
      updateSetting("projectId", project.id);
      updateSetting("projectSlug", project.slug);
      return project;
    },
    [updateSetting],
  );

  const handleSavePromptPresets = useCallback(
    async (projectId: UUID, promptPresets: PromptPresetSet) => {
      const project = await updateProject(projectId, { promptPresets });
      setProjects((previous) => previous.map((candidate) => (candidate.id === project.id ? project : candidate)));
      if (settings.projectId === project.id) {
        updateSetting("projectSlug", project.slug);
      }
      return project;
    },
    [settings.projectId, updateSetting],
  );
  const [activeTab, setActiveTab] = useState<TabKey>("characters");

  const activeDescriptor = useMemo(
    () => TABS.find((tab) => tab.key === activeTab) ?? TABS[0],
    [activeTab],
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="branding">
          <span className="brand-title">World Generator</span>
          <span className="brand-subtitle">Gemini 2.5 Flash comic pre-production toolkit</span>
        </div>
        <div className="app-header-controls">
          <div className="field header-project-picker">
            <label htmlFor="header-project-picker">Project</label>
            <select
              id="header-project-picker"
              value={settings.projectId ?? ""}
              onChange={(event) => handleProjectSelect(event.target.value)}
              disabled={projectsStatus === "loading" || projects.length === 0}
            >
              <option value="">-- Select project --</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="app-main">
        <aside className="tab-nav" aria-label="Primary">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={tab.key === activeTab ? "tab-link is-active" : "tab-link"}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className="tab-label">{tab.label}</span>
              <span className="tab-description">{tab.description}</span>
            </button>
          ))}
        </aside>

        <section className="tab-content" aria-live="polite">
          {activeDescriptor.key === "characters" && (
            <CharactersTab settingsController={settingsController} />
          )}
          {activeDescriptor.key === "project-assets" && (
            <ProjectAssetsTab settingsController={settingsController} />
          )}
          {activeDescriptor.key === "locations" && (
            <LocationsTab settingsController={settingsController} />
          )}
          {activeDescriptor.key === "items" && <ItemsTab settingsController={settingsController} />}
          {activeDescriptor.key === "panels" && <PanelsTab settingsController={settingsController} />}
          {activeDescriptor.key === "settings" && (
            <SettingsTab
              settingsController={settingsController}
              projects={projects}
              projectsStatus={projectsStatus}
              projectError={projectError}
              onRefreshProjects={refreshProjects}
              onSelectProject={handleProjectSelect}
              onCreateProject={handleProjectCreated}
              onSavePrompts={handleSavePromptPresets}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function CharactersTab({
  settingsController,
}: {
  settingsController: SettingsController;
}) {
  const { settings } = settingsController;
  const [profile, setProfile] = useState<CharacterView | null>(null);
  const [characterName, setCharacterName] = useState("Untitled Character");
  const [frontUploadState, setFrontUploadState] = useState<UploadState>({ status: "idle" });
  const [angleSelections, setAngleSelections] = useState<Partial<Record<CharacterAngle, boolean>>>(() => {
    const initial: Partial<Record<CharacterAngle, boolean>> = {};
    GENERATABLE_CHARACTER_ANGLES.forEach((angle) => {
      initial[angle] = true;
    });
    return initial;
  });
  const [generationStates, setGenerationStates] = useState<Partial<Record<CharacterAngle, UploadState>>>({});
  const [anglePrompts, setAnglePrompts] = useState<Partial<Record<CharacterAngle, string>>>({});

  useEffect(() => {
    if (profile) {
      setCharacterName(profile.name);
    }
  }, [profile]);

  const slots: CharacterSlot[] = useMemo(() => {
    if (!profile?.slots) {
      return [];
    }

    return [...profile.slots].sort((a, b) => a.order - b.order);
  }, [profile?.slots]);

  const slotByAngle = useMemo(() => {
    return slots.reduce<Partial<Record<CharacterAngle, CharacterSlot>>>((acc, slot) => {
      if (slot.angle) {
        acc[slot.angle] = slot;
      }
      return acc;
    }, {});
  }, [slots]);

  const frontSlot = slotByAngle.front ?? slots.find((slot) => slot.id === (profile?.defaultSlotId ?? "")) ?? null;
  const frontAsset = frontSlot?.asset ?? null;

  useEffect(() => {
    setAnglePrompts((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const slot of slots) {
        if (!slot.angle) continue;
        const storedPrompt = slot.asset?.generatedFromPrompt;
        if (storedPrompt && previous[slot.angle] === undefined) {
          next[slot.angle] = storedPrompt;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [slots]);

  const ensureName = () => {
    const trimmed = characterName.trim();
    return trimmed.length > 0 ? trimmed : "Untitled Character";
  };

  const syncSlot = async (angle: CharacterAngle, options?: { setDefault?: boolean }) => {
    const response = await createCharacterSlot({
      characterId: profile?.id,
      slotId: slotByAngle[angle]?.id,
      name: ensureName(),
      label: formatAngleLabel(ensureName(), angle),
      angle,
      setDefault: options?.setDefault ?? angle === "front",
      geminiKey: settings.geminiKey,
      projectSlug: settings.projectSlug,
    });
    setProfile(response.character);
    return { slot: response.slot as CharacterSlot, character: response.character };
  };

  const handleFrontUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFrontUploadState({ status: "uploading", message: `Uploading ${file.name}` });
    try {
      const { slot, character } = await syncSlot("front", { setDefault: true });
      const response = await uploadCharacterAngle({
        characterId: character?.id ?? profile?.id,
        name: ensureName(),
        slotId: slot.id,
        slotLabel: formatAngleLabel(ensureName(), "front"),
        angle: "front",
        setDefault: true,
        file,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      setProfile(response.character);
      setFrontUploadState({ status: "success", message: "Front reference saved" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setFrontUploadState({ status: "error", message });
    } finally {
      event.target.value = "";
    }
  };

  const handleAngleToggle = (angle: CharacterAngle) => {
    setAngleSelections((previous) => ({
      ...previous,
      [angle]: !previous[angle],
    }));
  };

  const handleAnglePromptChange = (angle: CharacterAngle, value: string) => {
    setAnglePrompts((previous) => ({
      ...previous,
      [angle]: value,
    }));
  };

  const handleGenerateSelected = async () => {
    if (!frontSlot || !frontSlot.asset) {
      setFrontUploadState({ status: "error", message: "Upload the front reference before generating" });
      return;
    }

    const activeAngles = GENERATABLE_CHARACTER_ANGLES.filter((angle) => angleSelections[angle]);
    if (activeAngles.length === 0) {
      return;
    }

    for (const angle of activeAngles) {
      setGenerationStates((prev) => ({
        ...prev,
        [angle]: { status: "uploading", message: `Generating ${CHARACTER_ANGLE_LABELS[angle]} view...` },
      }));

      try {
        const { slot, character } = await syncSlot(angle);
        const characterId = character?.id ?? profile?.id;
        if (!characterId) {
          throw new Error("Character not initialized");
        }
        const promptInput = anglePrompts[angle]?.trim();
        const response = await generateCharacterSlot({
          characterId,
          sourceSlotId: frontSlot.id,
          targetSlotId: slot.id,
          label: formatAngleLabel(ensureName(), angle),
          angle,
          prompt: promptInput && promptInput.length > 0 ? promptInput : undefined,
          overwrite: true,
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
        });
        setProfile(response.character);
        setGenerationStates((prev) => ({
          ...prev,
          [angle]: {
            status: "success",
            message: `${CHARACTER_ANGLE_LABELS[angle]} saved`,
            assetId: response.slot.asset?.id,
          },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Generation failed";
        setGenerationStates((prev) => ({
          ...prev,
          [angle]: { status: "error", message },
        }));
      }
    }
  };

  const selectedAngles = GENERATABLE_CHARACTER_ANGLES.filter((angle) => angleSelections[angle]);
  const canGenerate = Boolean(frontAsset) && selectedAngles.length > 0;
  const slotsWithAssets = slots.filter((slot) => slot.asset);
  const slugPreview = slugifyCharacterName(ensureName());

  return (
    <div className="pane">
      <h2>Character Turnaround Builder</h2>
      <p>Upload a front-facing source, pick the remaining views, and Nano Banana will keep them storyboard-ready.</p>

      <div className="form-card">
        <div className="field">
          <label htmlFor="character-name">Character name</label>
          <input
            id="character-name"
            type="text"
            value={characterName}
            onChange={(event) => setCharacterName(event.target.value)}
            placeholder="Hero"
          />
          <p className="helper-text">
            Latest character ID: <code>{profile?.id ?? "--"}</code>
          </p>
        </div>
        <div className="field">
          <label htmlFor="front-reference">Front reference</label>
          <div className="capture-actions">
            <label className="upload">
              <input id="front-reference" type="file" hidden onChange={handleFrontUpload} />
              {frontAsset ? "Replace Front Image" : "Upload Front Image"}
            </label>
            {frontAsset && (
              <a className="asset-link" href={assetHref(frontAsset.url)} target="_blank" rel="noreferrer">
                View current front
              </a>
            )}
          </div>
          {frontAsset && (
            <div className="capture-preview">
              <img
                src={assetHref(frontAsset.url)}
                alt={`Front view of ${ensureName()}`}
                className="asset-preview"
              />
            </div>
          )}
          <p className={`upload-status status-${frontUploadState.status}`}>
            {frontUploadState.message ?? (frontAsset ? "Front view ready" : "Awaiting upload")}
          </p>
          <p className="helper-text">
            Saved as <code>{formatAngleLabel(ensureName(), "front")}</code> for storyboard lookups.
          </p>
        </div>
      </div>

      <div className="form-card">
        <h3>Generate supporting views</h3>
        <div className="slot-form">
          {GENERATABLE_CHARACTER_ANGLES.map((angle) => {
            const selected = Boolean(angleSelections[angle]);
            const promptValue = anglePrompts[angle] ?? "";
            const slotClass = `slot-option${selected ? "" : " is-disabled"}`;
            return (
              <div key={angle} className={slotClass}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => handleAngleToggle(angle)}
                  />
                  {CHARACTER_ANGLE_LABELS[angle]}
                </label>
                <textarea
                  className="slot-prompt-input"
                  aria-label={`${CHARACTER_ANGLE_LABELS[angle]} prompt`}
                  placeholder={`Prompt for the ${CHARACTER_ANGLE_LABELS[angle].toLowerCase()} view`}
                  value={promptValue}
                  onChange={(event) => handleAnglePromptChange(angle, event.target.value)}
                  disabled={!selected}
                  rows={3}
                />
                <p className="helper-text">Used when generating this reference.</p>
              </div>
            );
          })}
        </div>
        {!frontAsset && <p className="helper-text">Upload the front view first to unlock generation.</p>}
        <div className="settings-actions">
          <button type="button" className="primary" onClick={handleGenerateSelected} disabled={!canGenerate}>
            Generate Selected Views
          </button>
        </div>
        <ul className="asset-list">
          {GENERATABLE_CHARACTER_ANGLES.map((angle) => {
            const status = generationStates[angle];
            const selected = Boolean(angleSelections[angle]);
            return (
              <li key={angle} className={`upload-status status-${status?.status ?? "idle"}`}>
                {CHARACTER_ANGLE_LABELS[angle]}: {status?.message ?? (selected ? "Waiting to generate" : "Skipped")}
              </li>
            );
          })}
        </ul>
        <p className="helper-text">
          Outputs save as <code>{`${slugPreview}-left`}</code>, <code>{`${slugPreview}-right`}</code>, and{" "}
          <code>{`${slugPreview}-back`}</code> for storyboard prompts.
        </p>
      </div>

      <div className="form-card">
        <h3>Saved references</h3>
        {slotsWithAssets.length === 0 ? (
          <p className="helper-text">Front, left, right, and back angles will appear here after generation.</p>
          ) : (
          <div className="panel-grid">
            {slotsWithAssets.map((slot) => {
              const asset = slot.asset;
              if (!asset) return null;
              return (
                <div key={slot.id} className="capture-card">
                  <div className="capture-heading-row">
                    <span className="capture-heading">{slot.label}</span>
                    <span className="capture-metadata">{describeAngle(slot.angle)}</span>
                  </div>
                  <img
                    className="asset-preview"
                    src={assetHref(asset.url)}
                    alt={`${slot.label} – ${describeAngle(slot.angle)}`}
                  />
                  <a className="asset-link" href={assetHref(asset.url)} target="_blank" rel="noreferrer">
                    Open full size
                  </a>
                  <p className="helper-text">
                    Asset ID: <code>{asset.id.slice(0, 8)}...</code>
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}function LocationsTab({
  settingsController,
}: {
  settingsController: SettingsController;
}) {
  const { settings } = settingsController;
  const [location, setLocation] = useState<LocationBlueprint | null>(null);
  const [locationName, setLocationName] = useState("Untitled Location");
  const [spotLabel, setSpotLabel] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const [viewLabel, setViewLabel] = useState("");
  const [viewPrompt, setViewPrompt] = useState("");
  const [generateState, setGenerateState] = useState<UploadState>({ status: "idle" });
  const [genLocationName, setGenLocationName] = useState("");
  const [genLocationPrompt, setGenLocationPrompt] = useState("");
  const [createAsNewLocation, setCreateAsNewLocation] = useState(false);
  const [imageGenState, setImageGenState] = useState<UploadState>({ status: "idle" });

  useEffect(() => {
    if (location) {
      setLocationName(location.name);
    }
  }, [location]);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadState({ status: "uploading", message: `Uploading ${file.name}` });

    try {
      const response = await uploadLocationReference({
        locationId: location?.id,
        name: locationName,
        spotLabel: spotLabel || undefined,
        file,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      setLocation(response.location);
      setUploadState({
        status: "success",
        message: response.spotId ? "Spot updated" : "Primary view stored",
        assetId: response.asset.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setUploadState({ status: "error", message });
    } finally {
      event.target.value = "";
    }
  };

  const handleGenerateView = async () => {
    const trimmedLabel = viewLabel.trim();
    const trimmedPrompt = viewPrompt.trim();
    if (!trimmedLabel || !trimmedPrompt) {
      setGenerateState({ status: "error", message: "Add a view label and prompt" });
      return;
    }

    setGenerateState({ status: "uploading", message: `Generating "${trimmedLabel}"` });

    try {
      const response = await generateLocationView({
        locationId: location?.id,
        name: locationName,
        label: trimmedLabel,
        prompt: trimmedPrompt,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      setLocation(response.location);
      setGenerateState({
        status: "success",
        message: "View generated",
        assetId: response.assetId ?? undefined,
      });
      setViewPrompt("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate view";
      setGenerateState({ status: "error", message });
    }
  };

  const handleGenerateFromImage = async () => {
    const trimmedName = genLocationName.trim();
    const trimmedPrompt = genLocationPrompt.trim();

    if (!trimmedPrompt) {
      setImageGenState({ status: "error", message: "Add a prompt describing the new view" });
      return;
    }

    if (!location?.primaryAssetId) {
      setImageGenState({ status: "error", message: "Upload a reference image first" });
      return;
    }

    if (createAsNewLocation && !trimmedName) {
      setImageGenState({ status: "error", message: "Provide a name for the new location" });
      return;
    }

    setImageGenState({
      status: "uploading",
      message: createAsNewLocation ? `Creating new location "${trimmedName}"` : "Generating view",
    });

    try {
      // We'll create this API function next
      const response = await generateLocationFromImage({
        sourceLocationId: location.id,
        sourceAssetId: location.primaryAssetId,
        prompt: trimmedPrompt,
        createAsNew: createAsNewLocation,
        newLocationName: createAsNewLocation ? trimmedName : undefined,
        spotLabel: !createAsNewLocation ? trimmedName : undefined,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      if (createAsNewLocation) {
        // New location created, we could optionally switch to it
        setImageGenState({
          status: "success",
          message: `New location "${response.location.name}" created`,
        });
        // Optionally clear form
        setGenLocationName("");
        setGenLocationPrompt("");
      } else {
        // Added as a spot to current location
        setLocation(response.location);
        setImageGenState({
          status: "success",
          message: "New view added to current location",
        });
        setGenLocationPrompt("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate from image";
      setImageGenState({ status: "error", message });
    }
  };

  const spots: LocationSpot[] = location?.spots ?? [];

  return (
    <div className="pane">
      <h2>Location Library</h2>
      <p>
        Map the primary room and optional secondary spots (e.g., oven, dishwasher) so panel prompts can
        target specific vantage points.
      </p>
      <div className="form-card">
        <div className="field">
          <label htmlFor="location-name">Location name</label>
          <input
            id="location-name"
            type="text"
            placeholder="Kitchen"
            value={locationName}
            onChange={(event) => setLocationName(event.target.value)}
          />
        </div>
        <div className="field multi">
          <div>
            <label htmlFor="location-reference">Reference image</label>
            <input id="location-reference" type="file" onChange={handleUpload} />
          </div>
          <div>
            <label htmlFor="location-spot">Secondary spot label</label>
            <input
              id="location-spot"
              type="text"
              placeholder="Oven counter"
              value={spotLabel}
              onChange={(event) => setSpotLabel(event.target.value)}
            />
          </div>
        </div>
        <p className={`upload-status status-${uploadState.status}`}>
          {uploadState.message ?? "Idle"}
          {uploadState.assetId ? ` � Asset ${uploadState.assetId.slice(0, 8)}` : ""}
        </p>
      </div>

      {location?.primaryAssetId && (
        <div className="form-card">
          <h3>Generate from uploaded image</h3>
          <p>
            Use the uploaded image as a visual reference to generate variations with AI. You can create a
            new location or add a secondary view to the current location.
          </p>
          <div className="field">
            <label htmlFor="gen-location-name">Name / Label</label>
            <input
              id="gen-location-name"
              type="text"
              placeholder={createAsNewLocation ? "New Kitchen View" : "Counter view"}
              value={genLocationName}
              onChange={(event) => setGenLocationName(event.target.value)}
            />
            <p className="helper-text">
              {createAsNewLocation
                ? "Name for the new location"
                : "Label for the secondary view (optional)"}
            </p>
          </div>
          <div className="field">
            <label htmlFor="gen-location-prompt">Generation prompt</label>
            <textarea
              id="gen-location-prompt"
              rows={4}
              placeholder="A close-up view of the shop as if you were sitting at the counter looking into the kitchen, please keep the style and lighting the same"
              value={genLocationPrompt}
              onChange={(event) => setGenLocationPrompt(event.target.value)}
            />
            <p className="helper-text">
              Describe the variation you want to generate based on the uploaded image.
            </p>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={createAsNewLocation}
                onChange={(event) => setCreateAsNewLocation(event.target.checked)}
              />
              Create as new location
            </label>
            <p className="helper-text">
              {createAsNewLocation
                ? "Generate a new independent location based on this image"
                : "Add as a secondary spot/view to the current location"}
            </p>
          </div>
          <div className="settings-actions">
            <button type="button" className="primary" onClick={handleGenerateFromImage}>
              Generate {createAsNewLocation ? "New Location" : "View"}
            </button>
          </div>
          <p className={`upload-status status-${imageGenState.status}`}>
            {imageGenState.message ?? "Ready to generate"}
          </p>
        </div>
      )}

      {location && (
        <div className="form-card">
          <h3>Stored Views</h3>
          <p className="helper-text">
            Location ID: <code>{location.id}</code>
          </p>
          <ul className="asset-list">
            <li>
              <strong>Primary:</strong>{" "}
              {location.primaryAssetId ? (
                <a href={assetHref(location.primaryAssetId)} target="_blank" rel="noreferrer">
                  {location.primaryAssetId.slice(0, 10)}
                </a>
              ) : (
                <span>None</span>
              )}
            </li>
            {spots.map((spot) => (
              <li key={spot.id}>
                <strong>{spot.label}:</strong>{" "}
                {spot.referenceAssetId ? (
                  <a href={assetHref(spot.referenceAssetId)} target="_blank" rel="noreferrer">
                    {spot.referenceAssetId.slice(0, 10)}
                  </a>
                ) : (
                  <span>None</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItemsTab({
  settingsController,
}: {
  settingsController: SettingsController;
}) {
  const { settings } = settingsController;
  const [item, setItem] = useState<ItemReference | null>(null);
  const [itemLabel, setItemLabel] = useState("Untitled Item");
  const [uploadStates, setUploadStates] = useState<Record<ItemAngle, UploadState>>(() => ({
    primary: { status: "idle" },
    alternate: { status: "idle" },
  }));

  useEffect(() => {
    if (item) {
      setItemLabel(item.label);
    }
  }, [item]);

  const handleFileChange = (angle: ItemAngle) =>
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setUploadStates((prev) => ({
        ...prev,
        [angle]: { status: "uploading", message: `Uploading ${file.name}` },
      }));

      try {
        const response = await uploadItemReference({
          itemId: item?.id,
          label: itemLabel,
          angle,
          file,
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
        });
        setItem(response.item);
        setUploadStates((prev) => ({
          ...prev,
          [angle]: {
            status: "success",
            message: "Uploaded",
            assetId: response.asset.id,
          },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        setUploadStates((prev) => ({
          ...prev,
          [angle]: { status: "error", message },
        }));
      } finally {
        event.target.value = "";
      }
    };

  return (
    <div className="pane">
      <h2>Prop Shelf</h2>
      <p>Store quick references for handheld props or set dressing. Two angles are supported for now.</p>
      <div className="form-card">
        <div className="field">
          <label htmlFor="item-label">Item label</label>
          <input
            id="item-label"
            type="text"
            value={itemLabel}
            onChange={(event) => setItemLabel(event.target.value)}
            placeholder="Copper pan"
          />
          <p className="helper-text">
            Item ID: <code>{item?.id ?? "--"}</code>
          </p>
        </div>
      </div>
      <div className="panel-grid">
        {itemAngles.map((angle) => {
          const status = uploadStates[angle];
          const asset = item?.angleAssets[angle];
          return (
            <div key={angle} className="capture-card">
              <span className="capture-heading">
                {angle.replace(/^[a-z]/, (char) => char.toUpperCase())} Angle
              </span>
              {asset ? (
                <a className="asset-link" href={assetHref(asset.url)} target="_blank" rel="noreferrer">
                  View asset
                </a>
              ) : (
                <p className="capture-copy">No render yet.</p>
              )}
              <div className="capture-actions">
                <label className="upload">
                  <input type="file" name={`item-${angle}`} hidden onChange={handleFileChange(angle)} />
                  Upload Reference
                </label>
                <button type="button" className="ghost" disabled>
                  Generate via Gemini
                </button>
              </div>
              <p className={`upload-status status-${status.status}`}>
                {status.message ?? "Idle"}
                {status.assetId ? ` � Asset ${status.assetId.slice(0, 8)}` : ""}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectAssetsTab({
  settingsController,
}: {
  settingsController: SettingsController;
}) {
  const { settings } = settingsController;
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [locations, setLocations] = useState<LocationBlueprint[]>([]);
  const [items, setItems] = useState<ItemReference[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterView | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationBlueprint | null>(null);
  const [selectedItem, setSelectedItem] = useState<ItemReference | null>(null);
  const [deletingId, setDeletingId] = useState<UUID | null>(null);
  const [uploadingAngle, setUploadingAngle] = useState<CharacterAngle | null>(null);
  const [renamingId, setRenamingId] = useState<UUID | null>(null);
  const [renamingAngle, setRenamingAngle] = useState<CharacterAngle | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    Promise.all([
      listCharactersForProject({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
        projectId: settings.projectId ?? undefined,
      }),
      listLocationsForProject({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      }),
      listItemsForProject({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      }),
    ])
      .then(([characterItems, locationItems, itemItems]) => {
        if (cancelled) return;
        setCharacters(characterItems);
        setLocations(locationItems);
        setItems(itemItems);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to load assets");
      });

    return () => {
      cancelled = true;
    };
  }, [settings.geminiKey, settings.projectId, settings.projectSlug]);

  const hasProject = Boolean(settings.projectId || settings.projectSlug);

  const handleViewCharacter = (character: CharacterView) => {
    setSelectedCharacter(character);
  };

  const handleDeleteCharacter = async (character: CharacterView) => {
    if (!window.confirm(`Delete character "${character.name}" from this project? This cannot be undone.`)) {
      return;
    }

    setDeletingId(character.id);
    try {
      await deleteCharacter({
        characterId: character.id,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
        projectId: settings.projectId ?? undefined,
      });
      setCharacters((previous) => previous.filter((candidate) => candidate.id !== character.id));
      setSelectedCharacter((current) => (current?.id === character.id ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete character");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRenameCharacter = async (character: CharacterView) => {
    const nextName = window.prompt("Rename character", character.name);
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === character.name) {
      return;
    }

    setRenamingId(character.id);
    setError(null);

    try {
      const updated = await renameCharacter({
        characterId: character.id,
        name: trimmed,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
        projectId: settings.projectId ?? undefined,
      });

      setCharacters((previous) =>
        previous.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setSelectedCharacter((current) => (current && current.id === updated.id ? updated : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename character");
    } finally {
      setRenamingId(null);
    }
  };

  const handleViewAsset = (assetUrl: string) => {
    const href = assetHref(assetUrl);
    if (!href || href === "#") return;
    window.open(href, "_blank", "noopener");
  };

  const inferExtension = (mimeType: string | undefined) => {
    if (!mimeType) return "png";
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
    if (mimeType === "image/webp") return "webp";
    return "png";
  };

  const handleDownloadAsset = (character: CharacterView, angle: CharacterAngle, assetUrl: string, mimeType?: string) => {
    const href = assetHref(assetUrl);
    if (!href || href === "#") return;
    const link = document.createElement("a");
    const ext = inferExtension(mimeType);
    link.href = href;
    link.download = `${slugifyCharacterName(character.name)}-${angle}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAngleUpload = async (angle: CharacterAngle, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedCharacter) return;

    setUploadingAngle(angle);
    setError(null);

    try {
      const existingSlot =
        selectedCharacter.slots?.find((slot) => slot.angle === angle) ?? null;

      const labelForSlot =
        existingSlot && existingSlot.label && existingSlot.label.trim().length > 0
          ? existingSlot.label
          : formatAngleLabel(selectedCharacter.name, angle);

      const slotResponse = await createCharacterSlot({
        characterId: selectedCharacter.id,
        name: selectedCharacter.name,
        slotId: existingSlot?.id,
        label: labelForSlot,
        angle,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      const uploadResponse = await uploadCharacterAngle({
        characterId: slotResponse.character.id,
        name: slotResponse.character.name,
        slotId: slotResponse.slot.id,
        slotLabel: slotResponse.slot.label,
        angle,
        setDefault: angle === "front",
        file,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      const updated = uploadResponse.character;
      setCharacters((previous) =>
        previous.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setSelectedCharacter(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload view");
    } finally {
      setUploadingAngle(null);
    }
  };

  const handleRenameView = async (angle: CharacterAngle) => {
    if (!selectedCharacter) return;

    const angleAsset = selectedCharacter.angles?.[angle] ?? null;
    const slot =
      selectedCharacter.slots?.find(
        (s) => s.asset && angleAsset && s.asset.id === angleAsset.id,
      ) ??
      selectedCharacter.slots?.find((s) => s.angle === angle) ??
      null;

    if (!slot) {
      setError("Could not locate the selected view to rename.");
      return;
    }

    const nextLabel = window.prompt("Rename view", slot.label || CHARACTER_ANGLE_LABELS[angle]);
    if (nextLabel === null) return;
    const trimmed = nextLabel.trim();
    if (!trimmed || trimmed === slot.label) {
      return;
    }

    setRenamingAngle(angle);
    setError(null);

    try {
      const response = await createCharacterSlot({
        characterId: selectedCharacter.id,
        name: selectedCharacter.name,
        slotId: slot.id,
        label: trimmed,
        angle,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      const updated = response.character;
      setCharacters((previous) =>
        previous.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setSelectedCharacter(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename view");
    } finally {
      setRenamingAngle(null);
    }
  };

  const handleDeleteAngle = async (angle: CharacterAngle) => {
    if (!selectedCharacter) return;
    if (!selectedCharacter.slots || selectedCharacter.slots.length <= 1) {
      setError("At least one character view is required.");
      return;
    }

    const angleAsset = selectedCharacter.angles?.[angle] ?? null;
    const slot =
      selectedCharacter.slots.find((s) => s.asset && angleAsset && s.asset.id === angleAsset.id) ??
      selectedCharacter.slots.find((s) => s.angle === angle) ??
      null;

    if (!slot) {
      setError("Could not locate the selected view slot to delete.");
      return;
    }

    if (
      !window.confirm(
        `Delete the ${CHARACTER_ANGLE_LABELS[angle]} view for "${selectedCharacter.name}"?`,
      )
    ) {
      return;
    }

    try {
      const updated = await deleteCharacterSlot({
        slotId: slot.id,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      setCharacters((previous) =>
        previous.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setSelectedCharacter(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete view");
    }
  };

  return (
    <div className="pane">
      <h2>Project Assets</h2>
      <p>
        High-level view of characters, locations, items, and storyboard pages for the active project.
        This starts with characters; locations, items, and pages will expand as those flows grow.
      </p>

      {!hasProject && (
        <p className="helper-text">
          Select a project in the header to see its assets.
        </p>
      )}

      {hasProject && (
        <>
          <div className="form-card">
            <div className="project-header">
              <div>
                <h3>Characters</h3>
                <p className="helper-text">
                  {status === "loading" && "Loading characters…"}
                  {status === "error" && (error ?? "Characters unavailable")}
                  {status === "ready" && (characters.length === 0 ? "No characters yet for this project." : `${characters.length} character(s) in this project.`)}
                </p>
              </div>
            </div>
            {status === "ready" && characters.length > 0 && (
              <div className="panel-grid">
                {characters.map((character) => {
                  const defaultAngleAsset = character.angles?.front ?? null;
                  return (
                    <div key={character.id} className="capture-card">
                      <div className="capture-heading-row">
                        <span className="capture-heading">{character.name}</span>
                      </div>
                      {defaultAngleAsset && (
                        <img
                          className="asset-preview"
                          src={assetHref(defaultAngleAsset.url)}
                          alt={character.name}
                        />
                      )}
                      <p className="helper-text">
                        Created: {new Date(character.createdAt).toLocaleString()} • Updated:{" "}
                        {new Date(character.updatedAt).toLocaleString()}
                      </p>
                      <div className="capture-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleViewCharacter(character)}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleRenameCharacter(character)}
                          disabled={renamingId === character.id}
                        >
                          {renamingId === character.id ? "Renaming..." : "Rename"}
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleDeleteCharacter(character)}
                          disabled={deletingId === character.id}
                        >
                          {deletingId === character.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedCharacter && (
            <div className="form-card">
              <div className="project-header">
                <div>
                  <h3>Character details</h3>
                  <p className="helper-text">
                    Summary for <strong>{selectedCharacter.name}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleRenameCharacter(selectedCharacter)}
                  disabled={renamingId === selectedCharacter.id}
                >
                  {renamingId === selectedCharacter.id ? "Renaming..." : "Rename"}
                </button>
              </div>
              <p className="helper-text">
                Created: {new Date(selectedCharacter.createdAt).toLocaleString()} • Updated:{" "}
                {new Date(selectedCharacter.updatedAt).toLocaleString()}
              </p>
              <p className="helper-text">
                Manage individual views below. You can upload a new image for any angle, download existing renders, or remove extra views. Use the Characters tab for more advanced turnaround editing.
              </p>
              <div className="panel-grid">
                {Object.entries(CHARACTER_ANGLE_LABELS).map(([angleKey, label]) => {
                  const angle = angleKey as CharacterAngle;
                  const asset = selectedCharacter.angles?.[angle] ?? null;
                  const slotsForCharacter = selectedCharacter.slots ?? [];
                  const slotForAngle =
                    slotsForCharacter.find((slot) => slot.angle === angle) ??
                    (asset
                      ? slotsForCharacter.find(
                          (slot) => slot.asset && slot.asset.id === asset.id,
                        )
                      : null);
                  const headingLabel =
                    slotForAngle && slotForAngle.label && slotForAngle.label.trim().length > 0
                      ? slotForAngle.label
                      : label;
                  return (
                    <div key={angle} className="capture-card">
                      <div className="capture-heading-row">
                        <span className="capture-heading">{headingLabel}</span>
                      </div>
                      {asset ? (
                        <>
                          <img
                            className="asset-preview"
                            src={assetHref(asset.url)}
                            alt={`${selectedCharacter.name} - ${headingLabel}`}
                            onClick={() => handleViewAsset(asset.url)}
                          />
                          <div className="capture-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => handleRenameView(angle)}
                              disabled={renamingAngle === angle}
                            >
                              {renamingAngle === angle ? "Renaming..." : "Rename"}
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                handleDownloadAsset(
                                  selectedCharacter,
                                  angle,
                                  asset.url,
                                  asset.mimeType,
                                )
                              }
                            >
                              Download
                            </button>
                            <label className="upload">
                              <input
                                type="file"
                                hidden
                                accept="image/*"
                                onChange={(event) => handleAngleUpload(angle, event)}
                              />
                              {uploadingAngle === angle ? "Uploading..." : "Replace"}
                            </label>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => handleDeleteAngle(angle)}
                              disabled={
                                uploadingAngle === angle ||
                                !selectedCharacter.slots ||
                                selectedCharacter.slots.length <= 1
                              }
                              title={
                                selectedCharacter.slots &&
                                selectedCharacter.slots.length <= 1
                                  ? "At least one view is required."
                                  : "Remove this view"
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="capture-actions">
                          <label className="upload">
                            <input
                              type="file"
                              hidden
                              accept="image/*"
                              onChange={(event) => handleAngleUpload(angle, event)}
                            />
                            {uploadingAngle === angle ? "Uploading..." : "Add view"}
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="form-card">
            <div className="project-header">
              <div>
                <h3>Locations</h3>
                <p className="helper-text">
                  {status === "loading" && "Loading assets…"}
                  {status === "error" && (error ?? "Assets unavailable")}
                  {status === "ready" &&
                    (locations.length === 0
                      ? "No locations yet for this workspace."
                      : `${locations.length} location(s) in this workspace.`)}
                </p>
              </div>
            </div>
            {status === "ready" && locations.length > 0 && (
              <div className="panel-grid">
                {locations.map((loc) => {
                  const primaryId = loc.primaryAssetId ?? null;
                  const firstSpotWithAsset = (loc.spots ?? []).find((spot) => spot.referenceAssetId);
                  const previewId = primaryId ?? firstSpotWithAsset?.referenceAssetId ?? null;
                  const previewUrl = previewId ? assetHref(previewId) : null;
                  const spotCount = loc.spots?.length ?? 0;

                  return (
                    <div key={loc.id} className="capture-card">
                      <div className="capture-heading-row">
                        <span className="capture-heading">{loc.name}</span>
                      </div>
                      {previewUrl && (
                        <img
                          className="asset-preview"
                          src={previewUrl}
                          alt={loc.name}
                        />
                      )}
                      <p className="helper-text">
                        {spotCount === 0
                          ? "No secondary spots yet."
                          : `${spotCount} secondary spot${spotCount === 1 ? "" : "s"}.`}
                      </p>
                      <div className="capture-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setSelectedLocation(loc)}
                        >
                          View
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedLocation && (
            <div className="form-card">
              <div className="project-header">
                <div>
                  <h3>Location details</h3>
                  <p className="helper-text">
                    Views for <strong>{selectedLocation.name}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSelectedLocation(null)}
                >
                  Close
                </button>
              </div>
              <p className="helper-text">
                Created: {new Date(selectedLocation.createdAt).toLocaleString()} • Updated:{" "}
                {new Date(selectedLocation.updatedAt).toLocaleString()}
              </p>
              <div className="panel-grid">
                {/* Primary view */}
                {selectedLocation.primaryAssetId && (
                  <div className="capture-card">
                    <div className="capture-heading-row">
                      <span className="capture-heading">Primary View</span>
                    </div>
                    <img
                      className="asset-preview"
                      src={assetHref(selectedLocation.primaryAssetId)}
                      alt={`${selectedLocation.name} - Primary`}
                      onClick={() => handleViewAsset(selectedLocation.primaryAssetId!)}
                    />
                    <div className="capture-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleViewAsset(selectedLocation.primaryAssetId!)}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                )}
                {/* Secondary spots */}
                {selectedLocation.spots?.map((spot) => (
                  <div key={spot.id} className="capture-card">
                    <div className="capture-heading-row">
                      <span className="capture-heading">{spot.label}</span>
                    </div>
                    {spot.referenceAssetId ? (
                      <>
                        <img
                          className="asset-preview"
                          src={assetHref(spot.referenceAssetId)}
                          alt={`${selectedLocation.name} - ${spot.label}`}
                          onClick={() => handleViewAsset(spot.referenceAssetId!)}
                        />
                        <div className="capture-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleViewAsset(spot.referenceAssetId!)}
                          >
                            Open
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="helper-text">No image for this spot yet.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-card">
            <div className="project-header">
              <div>
                <h3>Items</h3>
                <p className="helper-text">
                  {status === "loading" && "Loading assets…"}
                  {status === "error" && (error ?? "Assets unavailable")}
                  {status === "ready" &&
                    (items.length === 0
                      ? "No items yet for this workspace."
                      : `${items.length} item(s) in this workspace.`)}
                </p>
              </div>
            </div>
            {status === "ready" && items.length > 0 && (
              <div className="panel-grid">
                {items.map((item) => {
                  const primaryAsset = item.angleAssets.primary;
                  const alternateAsset = item.angleAssets.alternate;
                  const previewAsset = primaryAsset ?? alternateAsset;
                  const previewUrl = previewAsset ? assetHref(previewAsset.url) : null;
                  const angleCount = (primaryAsset ? 1 : 0) + (alternateAsset ? 1 : 0);

                  return (
                    <div key={item.id} className="capture-card">
                      <div className="capture-heading-row">
                        <span className="capture-heading">{item.label}</span>
                      </div>
                      {previewUrl && (
                        <img
                          className="asset-preview"
                          src={previewUrl}
                          alt={item.label}
                        />
                      )}
                      <p className="helper-text">
                        {angleCount === 0
                          ? "No angles yet."
                          : `${angleCount} angle${angleCount === 1 ? "" : "s"}.`}
                      </p>
                      <div className="capture-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setSelectedItem(item)}
                        >
                          View
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedItem && (
            <div className="form-card">
              <div className="project-header">
                <div>
                  <h3>Item details</h3>
                  <p className="helper-text">
                    Angles for <strong>{selectedItem.label}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSelectedItem(null)}
                >
                  Close
                </button>
              </div>
              <p className="helper-text">
                Created: {new Date(selectedItem.createdAt).toLocaleString()} • Updated:{" "}
                {new Date(selectedItem.updatedAt).toLocaleString()}
              </p>
              <div className="panel-grid">
                {/* Primary angle */}
                {selectedItem.angleAssets.primary && (
                  <div className="capture-card">
                    <div className="capture-heading-row">
                      <span className="capture-heading">Primary</span>
                    </div>
                    <img
                      className="asset-preview"
                      src={assetHref(selectedItem.angleAssets.primary.url)}
                      alt={`${selectedItem.label} - Primary`}
                      onClick={() => handleViewAsset(selectedItem.angleAssets.primary!.url)}
                    />
                    <div className="capture-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleViewAsset(selectedItem.angleAssets.primary!.url)}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                )}
                {/* Alternate angle */}
                {selectedItem.angleAssets.alternate && (
                  <div className="capture-card">
                    <div className="capture-heading-row">
                      <span className="capture-heading">Alternate</span>
                    </div>
                    <img
                      className="asset-preview"
                      src={assetHref(selectedItem.angleAssets.alternate.url)}
                      alt={`${selectedItem.label} - Alternate`}
                      onClick={() => handleViewAsset(selectedItem.angleAssets.alternate!.url)}
                    />
                    <div className="capture-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleViewAsset(selectedItem.angleAssets.alternate!.url)}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                )}
                {!selectedItem.angleAssets.primary && !selectedItem.angleAssets.alternate && (
                  <p className="helper-text">No angles uploaded yet. Use the Items tab to add references.</p>
                )}
              </div>
            </div>
          )}

          <div className="form-card">
            <h3>Storyboard Pages</h3>
            <p className="helper-text">
              A summary of storyboard pages and panel counts per project will land here later.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function PanelsTab({
  settingsController,
}: {
  settingsController: SettingsController;
}) {
  const { settings } = settingsController;
  const [page, setPage] = useState<StoryboardPage | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "saving" | "saved" | "error" | "generating">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<UUID | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionState | null>(null);
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [locations, setLocations] = useState<LocationBlueprint[]>([]);
  const [items, setItems] = useState<ItemReference[]>([]);
  const [characterSelection, setCharacterSelection] = useState<{ characterId?: UUID; slotId?: UUID }>({
    characterId: undefined,
    slotId: undefined,
  });
  const [locationSelection, setLocationSelection] = useState<{ locationId?: UUID; spotId?: UUID | "primary" }>({
    locationId: undefined,
    spotId: undefined,
  });
  const [selectedItemIds, setSelectedItemIds] = useState<UUID[]>([]);
  const [autoPrompt, setAutoPrompt] = useState<string>("");
  const [editingPanelId, setEditingPanelId] = useState<UUID | null>(null);
  const [panelLibraryUploading, setPanelLibraryUploading] = useState<Record<UUID, boolean>>({});
  const [subTab, setSubTab] = useState<"layout" | "library">("layout");

  const markDirty = useCallback(() => {
    setHasChanges(true);
    setStatus((current) => {
      if (current === "loading" || current === "saving" || current === "generating") {
        return current;
      }
      return current === "saved" ? "ready" : current;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    fetchStoryboardLayout({ geminiKey: settings.geminiKey, projectSlug: settings.projectSlug })
      .then((layout) => {
        if (cancelled) return;
        setPage(layout);
        setHasChanges(false);
        setStatus("ready");
        setSelectedPanelId((current) => {
          if (current && layout.panels.some((panel) => panel.id === current)) {
            return current;
          }
          return layout.panels[0]?.id ?? null;
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Failed to load layout");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [settings.geminiKey, settings.projectSlug]);

  useEffect(() => {
    let cancelled = false;
    const loadLookups = async () => {
      if (!settings.projectSlug) return;
      try {
        const [characterList, locationList, itemList] = await Promise.all([
          listCharactersForProject({ geminiKey: settings.geminiKey, projectSlug: settings.projectSlug }),
          listLocationsForProject({ geminiKey: settings.geminiKey, projectSlug: settings.projectSlug }),
          listItemsForProject({ geminiKey: settings.geminiKey, projectSlug: settings.projectSlug }),
        ]);
        if (cancelled) return;
        setCharacters(characterList);
        setLocations(locationList);
        setItems(itemList);
      } catch (cause) {
        console.error("storyboard:lookup_load_failed", cause);
      }
    };

    void loadLookups();

    return () => {
      cancelled = true;
    };
  }, [settings.geminiKey, settings.projectSlug]);

  const updatePanel = useCallback(
    (panelId: UUID, updates: Partial<StoryboardPanel>) => {
      let didChange = false;
      setPage((previous) => {
        if (!previous) return previous;
        const panelIndex = previous.panels.findIndex((panel) => panel.id === panelId);
        if (panelIndex === -1) return previous;
        const panel = previous.panels[panelIndex];
        const entries = Object.entries(updates) as Array<[keyof StoryboardPanel, unknown]>;
        const hasDelta = entries.some(([key, value]) => {
          if (key === "geometry" && value) {
            return geometryChanged(panel.geometry, value as PanelGeometry);
          }
          return (panel as Record<string, unknown>)[key as string] !== value;
        });

        if (!hasDelta) {
          return previous;
        }

        didChange = true;
        const updatedPanel: StoryboardPanel = {
          ...panel,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        const panels = [...previous.panels];
        panels.splice(panelIndex, 1, updatedPanel);

        return {
          ...previous,
          panels,
          updatedAt: new Date().toISOString(),
        };
      });

      if (didChange) {
        markDirty();
      }
    },
    [markDirty],
  );

  const updateGeometry = useCallback(
    (panelId: UUID, geometry: PanelGeometry) => {
      updatePanel(panelId, { geometry });
    },
    [updatePanel],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      const dx = (event.clientX - interaction.pointerStartX) / bounds.width;
      const dy = (event.clientY - interaction.pointerStartY) / bounds.height;

      if (interaction.mode === "move") {
        const nextGeometry = moveGeometry(interaction.origin, dx, dy);
        updateGeometry(interaction.panelId, nextGeometry);
      } else if (interaction.mode === "resize" && interaction.corner) {
        const nextGeometry = resizeGeometry(interaction.origin, dx, dy, interaction.corner);
        updateGeometry(interaction.panelId, nextGeometry);
      } else if (interaction.mode === "image-pan") {
        const panelWidth = interaction.panelWidth || bounds.width;
        const panelHeight = interaction.panelHeight || bounds.height;
        if (!panelWidth || !panelHeight) return;
        const dxPx = event.clientX - interaction.pointerStartX;
        const dyPx = event.clientY - interaction.pointerStartY;
        const baseOffsetX = interaction.imageOffsetX ?? 0;
        const baseOffsetY = interaction.imageOffsetY ?? 0;
        const offsetX = baseOffsetX + dxPx / panelWidth;
        const offsetY = baseOffsetY + dyPx / panelHeight;
        updatePanel(interaction.panelId, {
          renderOffsetX: offsetX,
          renderOffsetY: offsetY,
        });
      }
    };

    const handlePointerUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [updateGeometry]);

  useEffect(() => {
    if (!page || !selectedPanelId) return;
    if (page.panels.some((panel) => panel.id === selectedPanelId)) {
      return;
    }
    setSelectedPanelId(page.panels[0]?.id ?? null);
  }, [page, selectedPanelId]);

  useEffect(() => {
    if (status !== "saved") return;
    const timeout = window.setTimeout(() => {
      setStatus((current) => (current === "saved" ? "ready" : current));
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const selectedPanel = useMemo(() => {
    if (!page || !selectedPanelId) return null;
    return page.panels.find((panel) => panel.id === selectedPanelId) ?? null;
  }, [page, selectedPanelId]);

  useEffect(() => {
    const character =
      characterSelection.characterId && characters.find((candidate) => candidate.id === characterSelection.characterId);
    const characterSlot =
      character && character.slots?.find((slot) => slot.id === characterSelection.slotId) && character.slots
        ? character.slots.find((slot) => slot.id === characterSelection.slotId)
        : undefined;

    const location =
      locationSelection.locationId &&
      locations.find((candidate) => candidate.id === locationSelection.locationId);
    let locationLabel: string | undefined;
    if (location) {
      if (locationSelection.spotId === "primary") {
        locationLabel = location.name;
      } else if (locationSelection.spotId) {
        const spot = location.spots.find((candidate) => candidate.id === locationSelection.spotId);
        if (spot) {
          locationLabel = `${location.name} - ${spot.label}`;
        }
      }
    }

    const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));

    const parts: string[] = [];

    if (characterSlot) {
      parts.push(`[${characterSlot.label}]`);
    }

    if (locationLabel) {
      if (parts.length > 0) {
        parts.push(`is in the [${locationLabel}]`);
      } else {
        parts.push(`[${locationLabel}]`);
      }
    }

    if (selectedItems.length > 0) {
      const itemTokens = selectedItems.map((item) => `[${item.label}]`).join(", ");
      parts.push(`with ${itemTokens}`);
    }

    let composed = parts.join(" ");
    if (composed.length > 0) {
      composed = `${composed}.`;
    }

    setAutoPrompt(composed);

    if (!selectedPanel) {
      return;
    }

    if (!selectedPanel.prompt || selectedPanel.prompt.trim().length === 0) {
      if (composed.trim().length > 0) {
        updatePanel(selectedPanel.id, { prompt: composed });
      }
    }
  }, [
    characterSelection,
    characters,
    items,
    locationSelection,
    locations,
    selectedItemIds,
    selectedPanel,
    updatePanel,
  ]);

  const beginMove = useCallback(
    (panelId: UUID) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!page) return;
      event.preventDefault();
      event.stopPropagation();

      const panel = page.panels.find((candidate) => candidate.id === panelId);
      if (!panel) return;

      interactionRef.current = {
        panelId,
        mode: "move",
        origin: panel.geometry,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
      };

      setSelectedPanelId(panelId);
    },
    [page],
  );

  const beginResize = useCallback(
    (panelId: UUID, corner: ResizeCorner) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!page) return;
      event.preventDefault();
      event.stopPropagation();

      const panel = page.panels.find((candidate) => candidate.id === panelId);
      if (!panel) return;

      interactionRef.current = {
        panelId,
        mode: "resize",
        corner,
        origin: panel.geometry,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
      };

      setSelectedPanelId(panelId);
    },
    [page],
  );

  const handleCanvasPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      setSelectedPanelId(null);
      setEditingPanelId(null);
    }
  }, []);

  const markLayoutLoaded = useCallback(
    (layout: StoryboardPage) => {
      setPage(layout);
      setHasChanges(false);
      setStatus((current) => {
        if (current === "loading" || current === "error") {
          return "ready";
        }
        return current;
      });
      setSelectedPanelId((current) => {
        if (current && layout.panels.some((panel) => panel.id === current)) {
          return current;
        }
        return layout.panels[0]?.id ?? null;
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!page) return;
    setStatus("saving");
    setError(null);

    try {
      const canonicalPanels = page.panels.map((panel, index) => ({
        ...panel,
        order: index,
      }));
      const payload: StoryboardPage = {
        ...page,
        panels: canonicalPanels,
      };
      const saved = await saveStoryboardLayout(payload, {
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      markLayoutLoaded(saved);
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save layout");
      setStatus("error");
    }
  }, [markLayoutLoaded, page, settings.geminiKey, settings.projectSlug]);

  const handleRefresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const layout = await fetchStoryboardLayout({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      markLayoutLoaded(layout);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load layout");
      setStatus("error");
    }
  }, [markLayoutLoaded, settings.geminiKey, settings.projectSlug]);

  const handlePageLabelChange = useCallback(
    (value: string) => {
      let updated = false;
      setPage((previous) => {
        if (!previous || previous.label === value) return previous;
        updated = true;
        return {
          ...previous,
          label: value,
          updatedAt: new Date().toISOString(),
        };
      });
      if (updated) {
        markDirty();
      }
    },
    [markDirty],
  );

  const handlePageBackgroundChange = useCallback(
    (value: string) => {
      let updated = false;
      setPage((previous) => {
        if (!previous) return previous;
        if (previous.backgroundColor === value) return previous;
        updated = true;
        return {
          ...previous,
          backgroundColor: value,
          updatedAt: new Date().toISOString(),
        };
      });
      if (updated) {
        markDirty();
      }
    },
    [markDirty],
  );

  const statusMessage = useMemo(() => {
    if (status === "loading") return "Loading layout...";
    if (status === "saving") return "Saving changes...";
    if (status === "generating") return "Generating panel image...";
    if (status === "saved") return "Layout saved";
    if (status === "error") return error ?? "Layout unavailable";
    if (hasChanges) return "Unsaved changes";
    return "Drag panels or update metadata";
  }, [status, error, hasChanges]);

  const handleLabelChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selectedPanel) return;
      updatePanel(selectedPanel.id, { label: event.target.value });
    },
    [selectedPanel, updatePanel],
  );

  const handleNotesChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (!selectedPanel) return;
      updatePanel(selectedPanel.id, { notes: event.target.value });
    },
    [selectedPanel, updatePanel],
  );

  const handlePromptChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (!selectedPanel) return;
      updatePanel(selectedPanel.id, { prompt: event.target.value });
    },
    [selectedPanel, updatePanel],
  );

  const handleZoom = useCallback(
    (direction: "in" | "out") => {
      if (!selectedPanel) return;
      const currentScale = selectedPanel.renderScale ?? 1;
      const factor = direction === "in" ? 1.1 : 0.9;
      const nextScale = clampFraction(currentScale * factor, 0.25, 4);
      updatePanel(selectedPanel.id, { renderScale: nextScale });
    },
    [selectedPanel, updatePanel],
  );

  const beginImagePan = useCallback(
    (panelId: UUID) => (event: ReactPointerEvent<HTMLImageElement>) => {
      if (!page) return;
      if (editingPanelId !== panelId) return;
      event.preventDefault();
      event.stopPropagation();

      const panel = page.panels.find((candidate) => candidate.id === panelId);
      if (!panel) return;

      const panelElement = event.currentTarget.parentElement as HTMLElement | null;
      const rect = panelElement?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();

      interactionRef.current = {
        panelId,
        mode: "image-pan",
        origin: panel.geometry,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        imageOffsetX: panel.renderOffsetX ?? 0,
        imageOffsetY: panel.renderOffsetY ?? 0,
        panelWidth: rect.width || undefined,
        panelHeight: rect.height || undefined,
      };
    },
    [editingPanelId, page],
  );

  const handlePanelWidthChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selectedPanel) return;
      const nextPercent = Number(event.target.value);
      if (!Number.isFinite(nextPercent)) return;
      const width = clampFraction(nextPercent / 100, MIN_PANEL_SIZE, 1);
      const maxX = 1 - width;
      const x = clampFraction(selectedPanel.geometry.x, 0, maxX < 0 ? 0 : maxX);
      updateGeometry(selectedPanel.id, { ...selectedPanel.geometry, x, width });
    },
    [selectedPanel, updateGeometry],
  );

  const handlePanelHeightChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selectedPanel) return;
      const nextPercent = Number(event.target.value);
      if (!Number.isFinite(nextPercent)) return;
      const height = clampFraction(nextPercent / 100, MIN_PANEL_SIZE, 1);
      const maxY = 1 - height;
      const y = clampFraction(selectedPanel.geometry.y, 0, maxY < 0 ? 0 : maxY);
      updateGeometry(selectedPanel.id, { ...selectedPanel.geometry, y, height });
    },
    [selectedPanel, updateGeometry],
  );

  const handleCharacterChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      setCharacterSelection((previous) => ({
        characterId: value || undefined,
        slotId: value ? previous.slotId : undefined,
      }));
    },
    [],
  );

  const handleCharacterSlotChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setCharacterSelection((previous) => ({
      ...previous,
      slotId: value || undefined,
    }));
  }, []);

  const handleLocationChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      setLocationSelection((previous) => ({
        locationId: value || undefined,
        spotId: value ? previous.spotId : undefined,
      }));
    },
    [],
  );

  const handleLocationViewChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setLocationSelection((previous) => ({
      ...previous,
      spotId: value === "" ? undefined : (value as UUID | "primary"),
    }));
  }, []);

  const handleItemSelectionChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const options = Array.from(event.target.selectedOptions);
    setSelectedItemIds(options.map((option) => option.value as UUID));
  }, []);

  const handleCreatePanel = useCallback(async () => {
    setStatus("saving");
    setError(null);

    try {
      // Find a good position for the new panel
      const existingPanels = page?.panels ?? [];
      let newGeometry = { x: 0.1, y: 0.1, width: 0.3, height: 0.3 };
      
      // Simple placement logic - try to find empty space
      if (existingPanels.length > 0) {
        newGeometry = { x: 0.6, y: 0.1, width: 0.3, height: 0.3 };
        if (existingPanels.length > 1) {
          newGeometry = { x: 0.1, y: 0.5, width: 0.3, height: 0.3 };
        }
        if (existingPanels.length > 2) {
          newGeometry = { x: 0.6, y: 0.5, width: 0.3, height: 0.3 };
        }
      }

      const result = await createPanel({
        geometry: newGeometry,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      // Keep existing layout (including zoom/pan) and just append the new panel locally.
      setPage((previous) => {
        if (!previous) return previous;
        const panels = [...previous.panels, result.panel];
        return {
          ...previous,
          panels,
          updatedAt: new Date().toISOString(),
        };
      });
      setHasChanges(true);
      setSelectedPanelId(result.panel.id);
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create panel");
      setStatus("error");
    }
  }, [markLayoutLoaded, page, settings.geminiKey, settings.projectSlug]);

  const handleDeletePanel = useCallback(async (panelId: UUID) => {
    if (!page) return;
    
    // Don't allow deleting the last panel
    if (page.panels.length <= 1) {
      setError("Cannot delete the last panel");
      return;
    }

    setStatus("saving");
    setError(null);

    try {
      const result = await deletePanel(panelId, {
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      // Mirror the server-side deletion locally without resetting other panel state.
      setPage((previous) => {
        if (!previous) return previous;
        const remaining = previous.panels.filter((panel) => panel.id !== panelId);
        return {
          ...previous,
          panels: remaining.map((panel, index) => ({
            ...panel,
            order: index,
            updatedAt: new Date().toISOString(),
          })),
          updatedAt: new Date().toISOString(),
        };
      });
      setHasChanges(true);

      // If we deleted the selected or editing panel, clear or move selection.
      if (selectedPanelId === panelId) {
        const next = page.panels.filter((panel) => panel.id !== panelId);
        setSelectedPanelId(next[0]?.id ?? null);
      }
      if (editingPanelId === panelId) {
        setEditingPanelId(null);
      }

      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete panel");
      setStatus("error");
    }
  }, [editingPanelId, page, selectedPanelId, settings.geminiKey, settings.projectSlug]);

  const handlePanelAssetUpload = useCallback(
    async (panelId: UUID, file: File) => {
      setPanelLibraryUploading((previous) => ({ ...previous, [panelId]: true }));
      try {
        const result = await uploadPanelImage({
          panelId,
          file,
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
        });
        setPage(result.page);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to replace panel image");
        setStatus("error");
      } finally {
        setPanelLibraryUploading((previous) => {
          const next = { ...previous };
          delete next[panelId];
          return next;
        });
      }
    },
    [settings.geminiKey, settings.projectSlug],
  );

  const handleExportPage = useCallback(async () => {
    if (!page) return;

    try {
      const width = Math.round(page.width || 1988);
      const height = Math.round(page.height || 3075);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = page.backgroundColor ?? "#ffffff";
      ctx.fillRect(0, 0, width, height);

      const panelsWithImage = page.panels.filter((panel) => panel.renderAssetId);

      for (const panel of panelsWithImage) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = assetHref(panel.renderAssetId!);

        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to load panel image"));
        });

        const panelX = panel.geometry.x * width;
        const panelY = panel.geometry.y * height;
        const panelW = panel.geometry.width * width;
        const panelH = panel.geometry.height * height;

        const scale = panel.renderScale ?? 1;
        const offsetX = panel.renderOffsetX ?? 0;
        const offsetY = panel.renderOffsetY ?? 0;

        const drawW = panelW * scale;
        const drawH = panelH * scale;

        const centerX = panelX + panelW / 2;
        const centerY = panelY + panelH / 2;

        const drawX = centerX - drawW / 2 + offsetX * panelW;
        const drawY = centerY - drawH / 2 + offsetY * panelH;

        ctx.save();
        ctx.beginPath();
        ctx.rect(panelX, panelY, panelW, panelH);
        ctx.clip();
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        ctx.restore();
      }

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), "image/png", 1);
      });
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeLabel = (page.label || "page").replace(/[^\w.-]+/g, "-");
      link.download = `${safeLabel}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to export page");
      setStatus("error");
    }
  }, [page]);

  const handleRenderSelectedPanel = useCallback(async () => {
    if (!selectedPanel || !selectedPanel.prompt || selectedPanel.prompt.trim().length === 0) {
      setError("Add a prompt for the selected panel before generating an image.");
      return;
    }

    // Choose a primary reference image for image-to-image:
    // prefer the selected character slot; otherwise fall back to the selected location view.
    let referenceAssetId: UUID | undefined;
    const selectedCharacter =
      characterSelection.characterId &&
      characters.find((candidate) => candidate.id === characterSelection.characterId);
    const selectedSlot =
      selectedCharacter && selectedCharacter.slots
        ? selectedCharacter.slots.find((slot) => slot.id === characterSelection.slotId) ??
          selectedCharacter.slots.find((slot) => slot.asset)
        : undefined;
    if (selectedSlot?.asset?.id) {
      referenceAssetId = selectedSlot.asset.id;
    } else if (locationSelection.locationId) {
      const selectedLocation = locations.find((candidate) => candidate.id === locationSelection.locationId);
      if (selectedLocation) {
        if (locationSelection.spotId === "primary") {
          referenceAssetId = selectedLocation.primaryAssetId as UUID | undefined;
        } else if (locationSelection.spotId) {
          const spot = selectedLocation.spots.find((candidate) => candidate.id === locationSelection.spotId);
          referenceAssetId = spot?.referenceAssetId as UUID | undefined;
        } else {
          referenceAssetId =
            (selectedLocation.primaryAssetId as UUID | undefined) ||
            (selectedLocation.spots.find((spot) => spot.referenceAssetId)?.referenceAssetId as UUID | undefined);
        }
      }
    }

    setStatus("generating");
    setError(null);

    try {
      const result = await renderPanelImage({
        panelId: selectedPanel.id,
        prompt: selectedPanel.prompt,
        referenceAssetId,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      setPage(result.page);
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to generate panel image");
      setStatus("error");
    }
  }, [
    characterSelection,
    characters,
    locationSelection,
    locations,
    selectedPanel,
    settings.geminiKey,
    settings.projectSlug,
  ]);

  return (
    <div className="pane">
      <div className="pane-header">
        <h2>Storyboard Planner</h2>
        <div className="subtabs" aria-label="Storyboard mode">
          <button
            type="button"
            className={subTab === "layout" ? "subtab is-active" : "subtab"}
            onClick={() => setSubTab("layout")}
          >
            Layout
          </button>
          <button
            type="button"
            className={subTab === "library" ? "subtab is-active" : "subtab"}
            onClick={() => setSubTab("library")}
          >
            Library
          </button>
        </div>
      </div>
      <p>
        Lay out panels with adjustable boxes. Select references from the other tabs and describe the action to
        generate comic-ready frames.
      </p>
      {subTab === "layout" && (
        <div className="storyboard">
        <div className="storyboard-column">
            <div className="layout-toolbar">
              <div>
                <h3>Layout</h3>
                <p className={`layout-status status-${status}`}>{statusMessage}</p>
              </div>
              <div className="layout-controls">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void handleExportPage()}
                  disabled={!page || status === "loading" || status === "saving" || status === "generating"}
                >
                  Export Page
                </button>
                <button type="button" className="ghost" onClick={handleRefresh} disabled={status === "loading"}>
                  Reload
                </button>
                <button
                  type="button"
                className="ghost"
                onClick={handleCreatePanel}
                disabled={status === "loading" || status === "saving" || status === "generating"}
              >
                Add Panel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleSave}
                disabled={!page || !hasChanges || status === "saving" || status === "generating"}
              >
                {status === "saving" ? "Saving..." : "Save Layout"}
              </button>
            </div>
          </div>
          <div
            className="storyboard-canvas"
            ref={canvasRef}
            onPointerDown={handleCanvasPointerDown}
            style={page?.backgroundColor ? { background: page.backgroundColor } : undefined}
          >
            {status === "loading" && <div className="storyboard-empty">Loading layout...</div>}
            {status === "error" && (
              <div className="storyboard-empty" role="alert">
                {error ?? "Unable to load layout"}
              </div>
            )}
            {page &&
              status !== "loading" &&
              page.panels.map((panel) => (
                <div
                  key={panel.id}
                  className={selectedPanelId === panel.id ? "storyboard-panel is-selected" : "storyboard-panel"}
                  style={{
                    left: `${panel.geometry.x * 100}%`,
                    top: `${panel.geometry.y * 100}%`,
                    width: `${panel.geometry.width * 100}%`,
                    height: `${panel.geometry.height * 100}%`,
                  }}
                  onPointerDown={editingPanelId === panel.id ? undefined : beginMove(panel.id)}
                  onDoubleClick={() => {
                    setEditingPanelId(panel.id);
                    setSelectedPanelId(panel.id);
                  }}
                >
                  {panel.renderAssetId && (
                    <img
                      src={assetHref(panel.renderAssetId)}
                      alt={panel.label || "Panel render"}
                      className="storyboard-panel-image"
                      style={{
                        transform: `translate(${(panel.renderOffsetX ?? 0) * 100}%, ${(panel.renderOffsetY ?? 0) * 100}%) scale(${panel.renderScale ?? 1})`,
                        transformOrigin: "50% 50%",
                        pointerEvents: editingPanelId === panel.id ? "auto" : "none",
                        cursor: editingPanelId === panel.id ? "grab" : "default",
                      }}
                      onPointerDown={editingPanelId === panel.id ? beginImagePan(panel.id) : undefined}
                    />
                  )}
                  <span className="panel-label">{panel.label || "Untitled panel"}</span>
                  <span className="panel-order">#{panel.order + 1}</span>
                  <div className="panel-handle handle-nw" onPointerDown={beginResize(panel.id, "nw")} aria-hidden />
                  <div className="panel-handle handle-ne" onPointerDown={beginResize(panel.id, "ne")} aria-hidden />
                  <div className="panel-handle handle-sw" onPointerDown={beginResize(panel.id, "sw")} aria-hidden />
                  <div className="panel-handle handle-se" onPointerDown={beginResize(panel.id, "se")} aria-hidden />
                  {editingPanelId === panel.id && (
                    <div className="panel-zoom-controls">
                      <button
                        type="button"
                        className="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleZoom("out");
                        }}
                      >
                        -
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleZoom("in");
                        }}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingPanelId(null);
                          void handleSave();
                        }}
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
        <form className="storyboard-form" onSubmit={(event) => event.preventDefault()}>
          <div className="field">
            <h3>Prompt Builder</h3>
            <p className="helper-text">
              Pick references to seed the panel prompt. Bracketed names like <code>[Rabbit-front]</code> are auto-filled;
              write your description around them.
            </p>
          </div>
          <div className="field multi">
            <div className="field">
              <label htmlFor="storyboard-character">Character</label>
              <select
                id="storyboard-character"
                value={characterSelection.characterId ?? ""}
                onChange={handleCharacterChange}
              >
                <option value="">-- No character --</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="storyboard-character-view">Character view</label>
              <select
                id="storyboard-character-view"
                value={characterSelection.slotId ?? ""}
                onChange={handleCharacterSlotChange}
                disabled={!characterSelection.characterId}
              >
                <option value="">-- Any view --</option>
                {characterSelection.characterId &&
                  characters
                    .find((character) => character.id === characterSelection.characterId)
                    ?.slots?.filter((slot) => slot.asset)
                    .map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {slot.label}
                      </option>
                    ))}
              </select>
            </div>
          </div>
          <div className="field multi">
            <div className="field">
              <label htmlFor="storyboard-location">Location</label>
              <select
                id="storyboard-location"
                value={locationSelection.locationId ?? ""}
                onChange={handleLocationChange}
              >
                <option value="">-- No location --</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="storyboard-location-view">Location view</label>
              <select
                id="storyboard-location-view"
                value={locationSelection.spotId ?? ""}
                onChange={handleLocationViewChange}
                disabled={!locationSelection.locationId}
              >
                <option value="">-- Any view --</option>
                {locationSelection.locationId && <option value="primary">Primary view</option>}
                {locationSelection.locationId &&
                  locations
                    .find((location) => location.id === locationSelection.locationId)
                    ?.spots.map((spot) => (
                      <option key={spot.id} value={spot.id}>
                        {spot.label}
                      </option>
                    ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="storyboard-items">Items</label>
            <select id="storyboard-items" multiple value={selectedItemIds} onChange={handleItemSelectionChange}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="helper-text">Hold Ctrl or Cmd to select multiple items.</p>
          </div>
          <div className="field">
            <label htmlFor="auto-prompt">Auto-filled context</label>
            <textarea
              id="auto-prompt"
              rows={2}
              value={autoPrompt}
              readOnly
              placeholder="Selections will appear here in brackets."
            />
          </div>
          <div className="field">
            <label htmlFor="page-label">Page title</label>
            <input
              id="page-label"
              type="text"
              value={page?.label ?? ""}
              onChange={(event) => handlePageLabelChange(event.target.value)}
              placeholder="Page 1"
              disabled={!page}
            />
          </div>
          <div className="field">
            <label htmlFor="page-background">Page background color</label>
            <input
              id="page-background"
              type="color"
              value={page?.backgroundColor ?? "#0b0e14"}
              onChange={(event) => handlePageBackgroundChange(event.target.value)}
              disabled={!page}
            />
          </div>
          <div className="field">
            <label htmlFor="panel-picker">Panel</label>
            <select
              id="panel-picker"
              value={selectedPanelId ?? ""}
              onChange={(event) => setSelectedPanelId(event.target.value || null)}
              disabled={!page}
            >
              <option value="">-- Select panel --</option>
              {page?.panels.map((panel, index) => (
                <option key={panel.id} value={panel.id}>
                  {panel.label || `Panel ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
          {selectedPanel ? (
            <>
              <div className="panel-coordinates">
                <span>X {(selectedPanel.geometry.x * 100).toFixed(1)}%</span>
                <span>Y {(selectedPanel.geometry.y * 100).toFixed(1)}%</span>
                <span>W {(selectedPanel.geometry.width * 100).toFixed(1)}%</span>
                <span>H {(selectedPanel.geometry.height * 100).toFixed(1)}%</span>
              </div>
              <div className="field multi">
                <div className="field">
                  <label htmlFor="panel-width-input">Panel width (%)</label>
                  <input
                    id="panel-width-input"
                    type="number"
                    min={Math.round(MIN_PANEL_SIZE * 100)}
                    max={100}
                    value={Number((selectedPanel.geometry.width * 100).toFixed(1))}
                    onChange={handlePanelWidthChange}
                  />
                </div>
                <div className="field">
                  <label htmlFor="panel-height-input">Panel height (%)</label>
                  <input
                    id="panel-height-input"
                    type="number"
                    min={Math.round(MIN_PANEL_SIZE * 100)}
                    max={100}
                    value={Number((selectedPanel.geometry.height * 100).toFixed(1))}
                    onChange={handlePanelHeightChange}
                  />
                </div>
              </div>
              <div className="field multi">
                <div className="field">
                  <label htmlFor="panel-width-input">Panel width (%)</label>
                  <input
                    id="panel-width-input"
                    type="number"
                    min={Math.round(MIN_PANEL_SIZE * 100)}
                    max={100}
                    value={Number((selectedPanel.geometry.width * 100).toFixed(1))}
                    onChange={handlePanelWidthChange}
                  />
                </div>
                <div className="field">
                  <label htmlFor="panel-height-input">Panel height (%)</label>
                  <input
                    id="panel-height-input"
                    type="number"
                    min={Math.round(MIN_PANEL_SIZE * 100)}
                    max={100}
                    value={Number((selectedPanel.geometry.height * 100).toFixed(1))}
                    onChange={handlePanelHeightChange}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="panel-label">Panel label</label>
                <input
                  id="panel-label"
                  type="text"
                  value={selectedPanel.label}
                  onChange={handleLabelChange}
                  placeholder={`Panel ${selectedPanel.order + 1}`}
                />
              </div>
              <div className="field">
                <label htmlFor="panel-notes">Notes</label>
                <textarea
                  id="panel-notes"
                  rows={3}
                  value={selectedPanel.notes ?? ""}
                  onChange={handleNotesChange}
                  placeholder="Describe beats, reference assets, or camera direction."
                />
              </div>
              <div className="field">
                <label htmlFor="panel-prompt">Panel prompt</label>
                <textarea
                  id="panel-prompt"
                  rows={4}
                  value={selectedPanel.prompt ?? ""}
                  onChange={handlePromptChange}
                  placeholder="The hero steps toward the oven while balancing the pan."
                />
              </div>
              <div className="field">
                <button
                  type="button"
                  className="primary"
                  onClick={handleRenderSelectedPanel}
                  disabled={
                    !selectedPanel || status === "loading" || status === "saving" || status === "generating"
                  }
                >
                  {status === "generating" ? "Generating..." : "Generate Panel Image"}
                </button>
              </div>
              {selectedPanel.renderAssetId && (
                <div className="field">
                  <label>Latest render</label>
                  <div className="asset-preview">
                    <img
                      src={assetHref(selectedPanel.renderAssetId)}
                      alt={selectedPanel.label || "Panel render"}
                      style={{ maxWidth: "100%", borderRadius: 4 }}
                    />
                  </div>
                </div>
              )}
              <div className="panel-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleDeletePanel(selectedPanel.id)}
                  disabled={!page || page.panels.length <= 1 || status === "saving" || status === "generating"}
                  title={page && page.panels.length <= 1 ? "Cannot delete the last panel" : "Delete this panel"}
                >
                  Delete Panel
                </button>
              </div>
            </>
          ) : (
            <p className="helper-text">Select a panel on the canvas or from the list to edit its metadata.</p>
          )}
          {error && status === "error" && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
      )}
      {subTab === "library" && page && (
        <div className="storyboard-library">
          {page.panels.map((panel) => (
            <div key={panel.id} className="library-card">
              <div className="library-thumb">
                {panel.renderAssetId ? (
                  <img
                    src={assetHref(panel.renderAssetId)}
                    alt={panel.label || `Panel ${panel.order + 1}`}
                  />
                ) : (
                  <div className="library-thumb-empty">No render yet</div>
                )}
              </div>
              <div className="library-meta">
                <strong>{panel.label || `Panel ${panel.order + 1}`}</strong>
                <span className="helper-text">Panel #{panel.order + 1}</span>
              </div>
              <div className="library-actions">
                <a
                  href={panel.renderAssetId ? assetHref(panel.renderAssetId) : "#"}
                  download={`panel-${panel.order + 1}.png`}
                  className="ghost"
                  aria-disabled={!panel.renderAssetId}
                  onClick={(event) => {
                    if (!panel.renderAssetId) {
                      event.preventDefault();
                    }
                  }}
                >
                  Download
                </a>
                <label className="upload">
                  Replace
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    disabled={panelLibraryUploading[panel.id]}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void handlePanelAssetUpload(panel.id, file);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  settingsController,
  projects,
  projectsStatus,
  projectError,
  onRefreshProjects,
  onSelectProject,
  onCreateProject,
  onSavePrompts,
}: {
  settingsController: SettingsController;
  projects: ProjectSummary[];
  projectsStatus: "loading" | "ready" | "error";
  projectError: string | null;
  onRefreshProjects: () => void | Promise<void>;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (input: { name: string; description?: string; issueLabel?: string }) => Promise<ProjectSummary>;
  onSavePrompts: (projectId: UUID, prompts: PromptPresetSet) => Promise<ProjectSummary>;
}) {
  const { settings, status, saveSettings, updateSetting, reset, lastSavedAt } = settingsController;
  const [newProjectName, setNewProjectName] = useState("");
  const [newIssueLabel, setNewIssueLabel] = useState("");
  const [projectFormState, setProjectFormState] = useState<UploadState>({ status: "idle" });
  const [promptDrafts, setPromptDrafts] = useState<PromptPresetSet>({});
  const [promptState, setPromptState] = useState<UploadState>({ status: "idle" });

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === settings.projectId) ?? null,
    [projects, settings.projectId],
  );

  useEffect(() => {
    if (selectedProject?.promptPresets) {
      setPromptDrafts(selectedProject.promptPresets);
    } else {
      setPromptDrafts({});
    }
  }, [selectedProject?.id, selectedProject?.promptPresets]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveSettings({ ...settings });
  };

  const statusMessage = useMemo(() => {
    switch (status) {
      case "dirty":
        return "Unsaved changes";
      case "saving":
        return "Saving...";
      case "saved":
        return lastSavedAt ? `Saved at ${new Date(lastSavedAt).toLocaleTimeString()}` : "Settings saved";
      default:
        return "Settings ready";
    }
  }, [lastSavedAt, status]);

  const projectStatusMessage = useMemo(() => {
    if (projectsStatus === "loading") return "Loading projects...";
    if (projectsStatus === "error") return projectError ?? "Projects unavailable";
    if (selectedProject) return `Active project: ${selectedProject.name}`;
    return "Select or create a project to organize assets.";
  }, [projectsStatus, projectError, selectedProject]);

  const handleCreate = async () => {
    if (!newProjectName.trim()) {
      setProjectFormState({ status: "error", message: "Project name is required" });
      return;
    }
    setProjectFormState({ status: "uploading", message: "Creating project..." });
    try {
      await onCreateProject({
        name: newProjectName.trim(),
        issueLabel: newIssueLabel.trim() || undefined,
      });
      setNewProjectName("");
      setNewIssueLabel("");
      setProjectFormState({ status: "success", message: "Project created" });
    } catch (error) {
      setProjectFormState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to create project",
      });
    }
  };

  const sanitisePromptPayload = () => {
    const payload: PromptPresetSet = {};
    const characterDefault = promptDrafts.character?.defaultPrompt?.trim() ?? "";
    const angleEntries = Object.entries(promptDrafts.character?.anglePrompts ?? {}).reduce<
      Partial<Record<CharacterAngle, string>>
    >((acc, [angle, value]) => {
      const trimmed = value?.trim();
      if (trimmed) {
        acc[angle as CharacterAngle] = trimmed;
      }
      return acc;
    }, {});
    if (characterDefault || Object.keys(angleEntries).length > 0) {
      payload.character = {
        defaultPrompt: characterDefault,
        anglePrompts: Object.keys(angleEntries).length > 0 ? angleEntries : undefined,
      };
    }

    const locationDefault = promptDrafts.location?.defaultPrompt?.trim();
    const locationSpot = promptDrafts.location?.spotPrompt?.trim();
    if (locationDefault || locationSpot) {
      payload.location = {
        defaultPrompt: locationDefault ?? "",
        spotPrompt: locationSpot || undefined,
      };
    }

    const itemDefault = promptDrafts.item?.defaultPrompt?.trim();
    const itemAlt = promptDrafts.item?.alternatePrompt?.trim();
    if (itemDefault || itemAlt) {
      payload.item = {
        defaultPrompt: itemDefault ?? "",
        alternatePrompt: itemAlt || undefined,
      };
    }

    const panelPrompt = promptDrafts.storyboard?.panelPrompt?.trim();
    const layoutPrompt = promptDrafts.storyboard?.layoutPrompt?.trim();
    if (panelPrompt || layoutPrompt) {
      payload.storyboard = {
        panelPrompt: panelPrompt ?? "",
        layoutPrompt: layoutPrompt || undefined,
      };
    }

    return payload;
  };

  const handlePromptSave = async () => {
    if (!selectedProject) return;
    setPromptState({ status: "uploading", message: "Saving prompt presets..." });
    try {
      await onSavePrompts(selectedProject.id, sanitisePromptPayload());
      setPromptState({ status: "success", message: "Prompt presets saved" });
    } catch (error) {
      setPromptState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to save prompts",
      });
    }
  };

  const isSaving = status === "saving";
  const anglePrompts = promptDrafts.character?.anglePrompts ?? {};

  return (
    <div className="pane">
      <h2>Workspace Settings</h2>
      <p>Configure credentials, select the active project, and store reusable prompts.</p>
      <form className="form-card" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="gemini-key">Gemini API key</label>
          <input
            id="gemini-key"
            type="password"
            placeholder="sk-..."
            value={settings.geminiKey}
            onChange={(event) => updateSetting("geminiKey", event.target.value.trim())}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="asset-root">Asset output directory</label>
          <input
            id="asset-root"
            type="text"
            placeholder="c:/world-generator/cache"
            value={settings.assetRoot}
            onChange={(event) => updateSetting("assetRoot", event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="default-resolution">Default resolution</label>
          <select
            id="default-resolution"
            value={settings.defaultResolution}
            onChange={(event) =>
              updateSetting("defaultResolution", event.target.value as typeof settings.defaultResolution)
            }
          >
            <option value="768">768 x 768</option>
            <option value="1024">1024 x 1024</option>
            <option value="1536">1536 x 1536</option>
          </select>
        </div>
        <div className="settings-actions">
          <button type="submit" className="primary" disabled={isSaving || status === "saved"}>
            {isSaving ? "Saving" : "Save Settings"}
          </button>
          <button type="button" className="ghost" onClick={() => reset()}>
            Reset Defaults
          </button>
        </div>
        <p className="settings-status" aria-live="polite">
          {statusMessage}
        </p>
      </form>

      <div className="form-card">
        <div className="project-header">
          <div>
            <h3>Project Selection</h3>
            <p className="helper-text">{projectStatusMessage}</p>
          </div>
          <button type="button" className="ghost" onClick={() => onRefreshProjects()}>
            Refresh
          </button>
        </div>
        <div className="field">
          <label htmlFor="project-picker">Active project</label>
          <select
            id="project-picker"
            value={settings.projectId ?? ""}
            onChange={(event) => onSelectProject(event.target.value)}
            disabled={projectsStatus === "loading" || projects.length === 0}
          >
            <option value="">-- Select project --</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field multi">
          <div className="field">
            <label htmlFor="new-project-name">New project name</label>
            <input
              id="new-project-name"
              type="text"
              placeholder="Rabbit's Revenge"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-project-issue">Issue label (optional)</label>
            <input
              id="new-project-issue"
              type="text"
              placeholder="Issue 1"
              value={newIssueLabel}
              onChange={(event) => setNewIssueLabel(event.target.value)}
            />
          </div>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="ghost"
            onClick={handleCreate}
            disabled={projectFormState.status === "uploading"}
          >
            {projectFormState.status === "uploading" ? "Creating..." : "Create Project"}
          </button>
        </div>
        {projectFormState.message && (
          <p className={`upload-status status-${projectFormState.status}`} aria-live="polite">
            {projectFormState.message}
          </p>
        )}
      </div>

      <div className="form-card">
        <h3>Prompt Presets</h3>
        {selectedProject ? (
          <>
            <p className="helper-text">
              These defaults seed character, location, and storyboard requests for <strong>{selectedProject.name}</strong
              >.
            </p>
            <div className="field">
              <label htmlFor="character-default-prompt">Character prompt</label>
              <textarea
                id="character-default-prompt"
                rows={3}
                value={promptDrafts.character?.defaultPrompt ?? ""}
                onChange={(event) =>
                  setPromptDrafts((prev) => ({
                    ...prev,
                    character: {
                      defaultPrompt: event.target.value,
                      anglePrompts: prev.character?.anglePrompts,
                    },
                  }))
                }
                placeholder="Describe tone, style, and wardrobe details to reuse across angles."
              />
            </div>
            <div className="angle-grid">
              {GENERATABLE_CHARACTER_ANGLES.map((angle) => (
                <div key={angle} className="field">
                  <label htmlFor={`angle-${angle}`}>{CHARACTER_ANGLE_LABELS[angle]}</label>
                  <textarea
                    id={`angle-${angle}`}
                    rows={2}
                    value={anglePrompts[angle] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPromptDrafts((prev) => {
                        const existing = { ...(prev.character?.anglePrompts ?? {}) };
                        if (value.trim().length > 0) {
                          existing[angle] = value;
                        } else {
                          delete existing[angle];
                        }
                        return {
                          ...prev,
                          character: {
                            defaultPrompt: prev.character?.defaultPrompt ?? "",
                            anglePrompts: existing,
                          },
                        };
                      });
                    }}
                    placeholder={`Extra instructions for the ${CHARACTER_ANGLE_LABELS[angle].toLowerCase()} view`}
                  />
                </div>
              ))}
            </div>
            <div className="field">
              <label htmlFor="location-default">Location prompt</label>
              <textarea
                id="location-default"
                rows={3}
                value={promptDrafts.location?.defaultPrompt ?? ""}
                onChange={(event) =>
                  setPromptDrafts((prev) => ({
                    ...prev,
                    location: {
                      defaultPrompt: event.target.value,
                      spotPrompt: prev.location?.spotPrompt,
                    },
                  }))
                }
                placeholder="Base description for kitchens, labs, or hallways."
              />
            </div>
            <div className="field">
              <label htmlFor="location-spot">Spot prompt</label>
              <textarea
                id="location-spot"
                rows={2}
                value={promptDrafts.location?.spotPrompt ?? ""}
                onChange={(event) =>
                  setPromptDrafts((prev) => ({
                    ...prev,
                    location: {
                      defaultPrompt: prev.location?.defaultPrompt ?? "",
                      spotPrompt: event.target.value,
                    },
                  }))
                }
                placeholder="Describe repeating elements for named spots."
              />
            </div>
            <div className="field">
              <label htmlFor="item-default">Item prompt</label>
              <textarea
                id="item-default"
                rows={2}
                value={promptDrafts.item?.defaultPrompt ?? ""}
                onChange={(event) =>
                  setPromptDrafts((prev) => ({
                    ...prev,
                    item: {
                      defaultPrompt: event.target.value,
                      alternatePrompt: prev.item?.alternatePrompt,
                    },
                  }))
                }
                placeholder="Props style guide (materials, lighting, etc.)."
              />
            </div>
            <div className="field">
              <label htmlFor="item-alt">Alternate angle prompt</label>
              <textarea
                id="item-alt"
                rows={2}
                value={promptDrafts.item?.alternatePrompt ?? ""}
                onChange={(event) =>
                  setPromptDrafts((prev) => ({
                    ...prev,
                    item: {
                      defaultPrompt: prev.item?.defaultPrompt ?? "",
                      alternatePrompt: event.target.value,
                    },
                  }))
                }
                placeholder="Overrides for alternate prop angles."
              />
            </div>
            <div className="field">
              <label htmlFor="storyboard-panel">Storyboard panel prompt</label>
              <textarea
                id="storyboard-panel"
                rows={3}
                value={promptDrafts.storyboard?.panelPrompt ?? ""}
                onChange={(event) =>
                  setPromptDrafts((prev) => ({
                    ...prev,
                    storyboard: {
                      panelPrompt: event.target.value,
                      layoutPrompt: prev.storyboard?.layoutPrompt,
                    },
                  }))
                }
                placeholder="Default panel narration or framing details."
              />
            </div>
            <div className="field">
              <label htmlFor="storyboard-layout">Layout prompt</label>
              <textarea
                id="storyboard-layout"
                rows={2}
                value={promptDrafts.storyboard?.layoutPrompt ?? ""}
                onChange={(event) =>
                  setPromptDrafts((prev) => ({
                    ...prev,
                    storyboard: {
                      panelPrompt: prev.storyboard?.panelPrompt ?? "",
                      layoutPrompt: event.target.value,
                    },
                  }))
                }
                placeholder="Optional guidance for automatic layouts."
              />
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="primary"
                onClick={handlePromptSave}
                disabled={promptState.status === "uploading"}
              >
                {promptState.status === "uploading" ? "Saving..." : "Save Prompt Presets"}
              </button>
            </div>
            {promptState.message && (
              <p className={`upload-status status-${promptState.status}`} aria-live="polite">
                {promptState.message}
              </p>
            )}
          </>
        ) : (
          <p className="helper-text">Select a project to customize shared prompt text.</p>
        )}
      </div>
    </div>
  );
}

export default App;

