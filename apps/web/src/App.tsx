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
type InteractionMode = "move" | "resize";

type InteractionState = {
  panelId: UUID;
  mode: InteractionMode;
  corner?: ResizeCorner;
  origin: PanelGeometry;
  pointerStartX: number;
  pointerStartY: number;
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

type TabKey =  "characters" | "locations" | "items" | "panels" | "settings";

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
                  <a className="asset-link" href={assetHref(asset.url)} target="_blank" rel="noreferrer">
                    View asset
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

function PanelsTab({
  settingsController,
}: {
  settingsController: SettingsController;
}) {
  const { settings } = settingsController;
  const [page, setPage] = useState<StoryboardPage | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<UUID | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionState | null>(null);

  const markDirty = useCallback(() => {
    setHasChanges(true);
    setStatus((current) => {
      if (current === "loading" || current === "saving") {
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
      } else if (interaction.corner) {
        const nextGeometry = resizeGeometry(interaction.origin, dx, dy, interaction.corner);
        updateGeometry(interaction.panelId, nextGeometry);
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

  const selectedPanel = useMemo(() => {
    if (!page || !selectedPanelId) return null;
    return page.panels.find((panel) => panel.id === selectedPanelId) ?? null;
  }, [page, selectedPanelId]);

  const statusMessage = useMemo(() => {
    if (status === "loading") return "Loading layout...";
    if (status === "saving") return "Saving changes...";
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
      markLayoutLoaded(result.page);
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
      markLayoutLoaded(result.page);
      
      // If we deleted the selected panel, select another one
      if (selectedPanelId === panelId) {
        setSelectedPanelId(result.page.panels[0]?.id ?? null);
      }
      
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete panel");
      setStatus("error");
    }
  }, [markLayoutLoaded, page, selectedPanelId, settings.geminiKey, settings.projectSlug]);

  return (
    <div className="pane">
      <h2>Storyboard Planner</h2>
      <p>
        Lay out panels with adjustable boxes. Select references from the other tabs and describe the action to
        generate comic-ready frames.
      </p>
      <div className="storyboard">
        <div className="storyboard-column">
          <div className="layout-toolbar">
            <div>
              <h3>Layout</h3>
              <p className={`layout-status status-${status}`}>{statusMessage}</p>
            </div>
            <div className="layout-controls">
              <button type="button" className="ghost" onClick={handleRefresh} disabled={status === "loading"}>
                Reload
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleCreatePanel}
                disabled={status === "loading" || status === "saving"}
              >
                Add Panel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleSave}
                disabled={!page || !hasChanges || status === "saving"}
              >
                {status === "saving" ? "Saving..." : "Save Layout"}
              </button>
            </div>
          </div>
          <div className="storyboard-canvas" ref={canvasRef} onPointerDown={handleCanvasPointerDown}>
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
                  onPointerDown={beginMove(panel.id)}
                >
                  <span className="panel-label">{panel.label || "Untitled panel"}</span>
                  <span className="panel-order">#{panel.order + 1}</span>
                  <div className="panel-handle handle-nw" onPointerDown={beginResize(panel.id, "nw")} aria-hidden />
                  <div className="panel-handle handle-ne" onPointerDown={beginResize(panel.id, "ne")} aria-hidden />
                  <div className="panel-handle handle-sw" onPointerDown={beginResize(panel.id, "sw")} aria-hidden />
                  <div className="panel-handle handle-se" onPointerDown={beginResize(panel.id, "se")} aria-hidden />
                </div>
              ))}
          </div>
        </div>
        <form className="storyboard-form" onSubmit={(event) => event.preventDefault()}>
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
                <label htmlFor="panel-prompt">Prompt</label>
                <textarea
                  id="panel-prompt"
                  rows={4}
                  value={selectedPanel.prompt ?? ""}
                  onChange={handlePromptChange}
                  placeholder="The hero steps toward the oven while balancing the pan."
                />
              </div>
              <div className="panel-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleDeletePanel(selectedPanel.id)}
                  disabled={!page || page.panels.length <= 1 || status === "saving"}
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

