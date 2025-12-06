import type { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BubbleType,
  CharacterAngle,
  CharacterTurnaroundSlot,
  ItemAngle,
  ItemReference,
  LocationBlueprint,
  LocationSpot,
  PanelGeometry,
  PanelRenderModel,
  ProjectSummary,
  PromptPresetSet,
  StoryboardPage,
  StoryboardPanel,
  StoryboardCaptionBox,
  StoryboardBubble,
  UUID,
} from "@worldengine/shared";
import { PANEL_RENDER_MODEL_LABELS } from "@worldengine/shared";
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
  editPanelImage,
  uploadPanelImage,
  listStoryboardPages,
  createStoryboardPageApi,
  activateStoryboardPage,
  deleteStoryboardPageApi,
  updatePageIssue,
  exportPageToFolder,
  exportPageToPsd,
} from "./lib/api";
import { CaptionBox, FontSelector, SpeechBubble } from "./components";
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
const MIN_CAPTION_SIZE = 0.03; // Smaller minimum for caption boxes
const BUBBLE_VIEWBOX_WIDTH = 200;
const BUBBLE_VIEWBOX_HEIGHT = 150;
const BUBBLE_PADDING = 8;
const BUBBLE_TAIL_LIFT = 0.3;
const SPEECH_TAIL_SCALE = 0.6;
const THOUGHT_TAIL_SCALE = 0.5;

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type InteractionMode = "move" | "resize" | "image-pan";

const generateId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

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
  /** Whether this interaction is for a caption box (vs a panel). */
  isCaptionBox?: boolean;
  /** Whether this interaction is for a speech/thought bubble. */
  isBubble?: boolean;
};

function clampFraction(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function geometryChanged(a: PanelGeometry, b: PanelGeometry) {
  if (
    Math.abs(a.x - b.x) > 0.0001 ||
    Math.abs(a.y - b.y) > 0.0001 ||
    Math.abs(a.width - b.width) > 0.0001 ||
    Math.abs(a.height - b.height) > 0.0001
  ) {
    return true;
  }

  // Quick deep equality check for optional cornerOffsets
  return JSON.stringify(a.cornerOffsets) !== JSON.stringify(b.cornerOffsets);
}

function moveGeometry(origin: PanelGeometry, dx: number, dy: number): PanelGeometry {
  const x = clampFraction(origin.x + dx, 0, 1 - origin.width);
  const y = clampFraction(origin.y + dy, 0, 1 - origin.height);
  return {
    x,
    y,
    width: origin.width,
    height: origin.height,
    cornerOffsets: origin.cornerOffsets,
  };
}

function resizeGeometry(origin: PanelGeometry, dx: number, dy: number, corner: ResizeCorner, minSize = MIN_PANEL_SIZE): PanelGeometry {
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;

  if (corner.includes("w")) {
    left = clampFraction(left + dx, 0, right - minSize);
  }
  if (corner.includes("e")) {
    right = clampFraction(right + dx, left + minSize, 1);
  }
  if (corner.includes("n")) {
    top = clampFraction(top + dy, 0, bottom - minSize);
  }
  if (corner.includes("s")) {
    bottom = clampFraction(bottom + dy, top + minSize, 1);
  }

  const width = clampFraction(right - left, minSize, 1);
  const height = clampFraction(bottom - top, minSize, 1);

  left = clampFraction(left, 0, 1 - width);
  top = clampFraction(top, 0, 1 - height);

  return {
    x: left,
    y: top,
    width,
    height,
    cornerOffsets: origin.cornerOffsets,
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
    key: "project-assets",
    label: "Project Assets",
    description: "Browse characters, locations, items, and pages for the active project.",
  },
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

const PANEL_RENDER_SIZE_OPTIONS = [
  { id: "square", label: "Square (1024 x 1024)", width: 1024, height: 1024, orientations: ["horizontal", "vertical"] },
  { id: "widescreen", label: "16:9 (1536 x 864)", width: 1536, height: 864, orientations: ["horizontal"] },
  { id: "landscape_3_2", label: "3:2 (1536 x 1024)", width: 1536, height: 1024, orientations: ["horizontal"] },
  { id: "portrait_9_16", label: "9:16 (864 x 1536)", width: 864, height: 1536, orientations: ["vertical"] },
  { id: "portrait", label: "2:3 (1024 x 1536)", width: 1024, height: 1536, orientations: ["vertical"] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  width: number;
  height: number;
  orientations: PanelOrientation[];
}>;

type PanelRenderSizeId = (typeof PANEL_RENDER_SIZE_OPTIONS)[number]["id"];

type CharacterView = CharacterPayload;
type CharacterSlot = CharacterTurnaroundSlot & { angle: CharacterAngle | null };

type StoryboardCharacterReference = {
  id: UUID;
  characterId: UUID;
  slotId?: UUID;
};

type StoryboardLocationReference = {
  id: UUID;
  locationId: UUID;
  spotId?: UUID | "primary";
};

type StoryboardItemReferenceEntry = {
  id: UUID;
  itemId: UUID;
};

type PanelOrientation = "horizontal" | "vertical";

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
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [headerNewProjectName, setHeaderNewProjectName] = useState("");
  const [headerNewProjectIssue, setHeaderNewProjectIssue] = useState("");
  const [headerProjectCreating, setHeaderProjectCreating] = useState(false);
  const [showNewIssueModal, setShowNewIssueModal] = useState(false);
  const [newIssueName, setNewIssueName] = useState("");
  const [storyboardIssues, setStoryboardIssues] = useState<string[]>([]);
  const customIssues = settings.customIssues ?? [];
  const selectedIssue = settings.selectedIssue ?? "";

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

  const handleHeaderCreateProject = useCallback(async () => {
    if (!headerNewProjectName.trim()) return;
    setHeaderProjectCreating(true);
    try {
      await handleProjectCreated({
        name: headerNewProjectName.trim(),
        issueLabel: headerNewProjectIssue.trim() || undefined,
      });
      setHeaderNewProjectName("");
      setHeaderNewProjectIssue("");
      setShowNewProjectModal(false);
    } catch {
      // Keep modal open on error so user can retry
    } finally {
      setHeaderProjectCreating(false);
    }
  }, [headerNewProjectName, headerNewProjectIssue, handleProjectCreated]);

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
  const [activeTab, setActiveTab] = useState<TabKey>("project-assets");

  const activeDescriptor = useMemo(
    () => TABS.find((tab) => tab.key === activeTab) ?? TABS[0],
    [activeTab],
  );

  // Fetch all storyboard pages to extract unique issues
  const refreshStoryboardIssues = useCallback(async () => {
    if (!settings.projectSlug) return;
    try {
      // Fetch ALL pages (no issue filter) to get the list of issues
      const allPages = await listStoryboardPages({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      const issues = allPages
        .map((p) => p.issueLabel)
        .filter((label): label is string => Boolean(label && label.trim()));
      setStoryboardIssues([...new Set(issues)]);
    } catch (cause) {
      console.error("issues:load_failed", cause);
    }
  }, [settings.geminiKey, settings.projectSlug]);

  useEffect(() => {
    void refreshStoryboardIssues();
  }, [refreshStoryboardIssues]);

  // Combine issues from storyboard pages + custom issues created by user
  const uniqueIssues = useMemo(() => {
    const allIssues = [...storyboardIssues, ...customIssues];
    return [...new Set(allIssues)].sort();
  }, [storyboardIssues, customIssues]);

  // Handle issue dropdown change - show modal if "new" selected
  const handleIssueChange = useCallback((value: string) => {
    if (value === "__new__") {
      setShowNewIssueModal(true);
    } else {
      updateSetting("selectedIssue", value || undefined);
    }
  }, [updateSetting]);

  // Handle creating a new issue
  const handleCreateIssue = useCallback(() => {
    if (!newIssueName.trim()) return;
    const trimmed = newIssueName.trim();
    if (!customIssues.includes(trimmed) && !uniqueIssues.includes(trimmed)) {
      // Persist custom issues to settings
      updateSetting("customIssues", [...customIssues, trimmed]);
    }
    updateSetting("selectedIssue", trimmed);
    setNewIssueName("");
    setShowNewIssueModal(false);
  }, [newIssueName, customIssues, uniqueIssues, updateSetting]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="branding">
          <span className="brand-title">World Generator</span>
        </div>
        <div className="app-header-controls">
          <select
            className="header-select"
            value={settings.projectId ?? ""}
            onChange={(event) => handleProjectSelect(event.target.value)}
            disabled={projectsStatus === "loading" || projects.length === 0}
            title="Select project"
          >
            <option value="">Select project...</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            className="header-select"
            value={selectedIssue}
            onChange={(e) => handleIssueChange(e.target.value)}
            title="Select issue"
          >
            <option value="">All issues</option>
            <option value="__new__">+ New Issue...</option>
            {uniqueIssues.map((issue) => (
              <option key={issue} value={issue}>
                {issue}
              </option>
            ))}
          </select>
          <div className="header-divider" />
          <button
            type="button"
            className="header-btn"
            onClick={() => {
              // Pre-fill issue if one is selected
              if (selectedIssue && selectedIssue !== "__new__") {
                setHeaderNewProjectIssue(selectedIssue);
              }
              setShowNewProjectModal(true);
            }}
            title="Create new project"
          >
            <span className="header-btn-icon">+</span>
            New
          </button>
        </div>
        {showNewProjectModal && (
          <div className="modal-overlay" onClick={() => setShowNewProjectModal(false)}>
            <div className="modal-content new-project-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Create New Project</h3>
              <div className="field">
                <label htmlFor="header-new-project-name">Project name</label>
                <input
                  id="header-new-project-name"
                  type="text"
                  placeholder="My Awesome Project"
                  value={headerNewProjectName}
                  onChange={(e) => setHeaderNewProjectName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="header-new-project-issue">Issue (optional)</label>
                <input
                  id="header-new-project-issue"
                  type="text"
                  list="issue-suggestions"
                  placeholder="Select or type an issue..."
                  value={headerNewProjectIssue}
                  onChange={(e) => setHeaderNewProjectIssue(e.target.value)}
                />
                <datalist id="issue-suggestions">
                  {uniqueIssues.map((issue) => (
                    <option key={issue} value={issue} />
                  ))}
                </datalist>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowNewProjectModal(false)}
                  disabled={headerProjectCreating}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={handleHeaderCreateProject}
                  disabled={headerProjectCreating || !headerNewProjectName.trim()}
                >
                  {headerProjectCreating ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
        {showNewIssueModal && (
          <div className="modal-overlay" onClick={() => setShowNewIssueModal(false)}>
            <div className="modal-content new-issue-modal" onClick={(e) => e.stopPropagation()}>
              <h3>New Issue</h3>
              <div className="field">
                <label htmlFor="new-issue-name">Issue name</label>
                <input
                  id="new-issue-name"
                  type="text"
                  placeholder="Issue 4"
                  value={newIssueName}
                  onChange={(e) => setNewIssueName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newIssueName.trim()) {
                      handleCreateIssue();
                    }
                  }}
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setShowNewIssueModal(false);
                    setNewIssueName("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={handleCreateIssue}
                  disabled={!newIssueName.trim()}
                >
                  Add Issue
                </button>
              </div>
            </div>
          </div>
        )}
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
          {activeDescriptor.key === "panels" && (
            <PanelsTab settingsController={settingsController} onRefreshIssues={refreshStoryboardIssues} />
          )}
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
  const [uploadingLocationId, setUploadingLocationId] = useState<UUID | null>(null);
  const [renamingId, setRenamingId] = useState<UUID | null>(null);
  const [renamingAngle, setRenamingAngle] = useState<CharacterAngle | null>(null);

  // Pages state
  const [pages, setPages] = useState<StoryboardPage[]>([]);
  const [allPages, setAllPages] = useState<StoryboardPage[]>([]);
  const [pagesStatus, setPagesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [issueList, setIssueList] = useState<string[]>([]);
  const [orphanedCount, setOrphanedCount] = useState(0);
  const [selectedIssue, setSelectedIssue] = useState<string>("");
  const [updatingPageId, setUpdatingPageId] = useState<UUID | null>(null);

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

  // Load all issues for this project
  const refreshIssueList = useCallback(async () => {
    if (!settings.projectSlug) {
      setIssueList([]);
      setOrphanedCount(0);
      return;
    }

    try {
      const fetchedPages = await listStoryboardPages({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      setAllPages(fetchedPages);
      
      // Count orphaned pages (no issueLabel)
      const orphaned = fetchedPages.filter((p) => !p.issueLabel || !p.issueLabel.trim());
      setOrphanedCount(orphaned.length);
      
      // Get unique issue labels
      const issues = fetchedPages
        .map((p) => p.issueLabel)
        .filter((label): label is string => Boolean(label && label.trim()));
      const uniqueIssues = [...new Set(issues)].sort();
      setIssueList(uniqueIssues);
      
      // Auto-select first issue if none selected (prefer an actual issue over unassigned)
      if (!selectedIssue) {
        if (uniqueIssues.length > 0) {
          setSelectedIssue(uniqueIssues[0]);
        } else if (orphaned.length > 0) {
          setSelectedIssue("__unassigned__");
        }
      }
    } catch (err) {
      console.error("Failed to load issues:", err);
    }
  }, [settings.geminiKey, settings.projectSlug, selectedIssue]);

  useEffect(() => {
    void refreshIssueList();
  }, [refreshIssueList]);

  // Load pages for the selected issue
  useEffect(() => {
    if (!settings.projectSlug || !selectedIssue) {
      setPages([]);
      setPagesStatus("idle");
      return;
    }

    setPagesStatus("loading");
    
    // Handle special "__unassigned__" selection for orphaned pages
    if (selectedIssue === "__unassigned__") {
      // Filter from allPages for pages without issueLabel
      const orphaned = allPages.filter((p) => !p.issueLabel || !p.issueLabel.trim());
      const sorted = [...orphaned].sort((a, b) => (a.label || "").localeCompare(b.label || ""));
      setPages(sorted);
      setPagesStatus("ready");
      return;
    }

    // Load pages for a specific issue from API
    listStoryboardPages({
      geminiKey: settings.geminiKey,
      projectSlug: settings.projectSlug,
      issueLabel: selectedIssue,
    })
      .then((list) => {
        // Sort pages by label
        const sorted = [...list].sort((a, b) => (a.label || "").localeCompare(b.label || ""));
        setPages(sorted);
        setPagesStatus("ready");
      })
      .catch((err) => {
        console.error("Failed to load pages:", err);
        setPagesStatus("error");
      });
  }, [settings.geminiKey, settings.projectSlug, selectedIssue, allPages]);

  const hasProject = Boolean(settings.projectId || settings.projectSlug);

  // Handle changing a page's issue assignment
  const handleChangePageIssue = useCallback(async (pageId: UUID, newIssue: string | null) => {
    setUpdatingPageId(pageId);
    try {
      await updatePageIssue(pageId, newIssue, {
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      // Refresh the issue list and pages
      await refreshIssueList();
    } catch (err) {
      console.error("Failed to update page issue:", err);
    } finally {
      setUpdatingPageId(null);
    }
  }, [settings.geminiKey, settings.projectSlug, refreshIssueList]);

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

  const handleLocationPrimaryUpload = async (location: LocationBlueprint, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadingLocationId(location.id);
    setError(null);

    try {
      const response = await uploadLocationReference({
        locationId: location.id,
        name: location.name,
        file,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      setLocations((previous) =>
        previous.map((candidate) => (candidate.id === response.location.id ? response.location : candidate)),
      );
      setSelectedLocation((current) =>
        current && current.id === response.location.id ? response.location : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to replace location image");
    } finally {
      setUploadingLocationId(null);
    }
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
        High-level view of characters, locations, items, and pages for the active project.
        Select an issue to see all its pages together.
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
                        <label className="upload">
                          <input
                            type="file"
                            hidden
                            accept="image/*"
                            disabled={uploadingLocationId === loc.id}
                            onChange={(event) => handleLocationPrimaryUpload(loc, event)}
                          />
                          {uploadingLocationId === loc.id ? "Uploading..." : previewUrl ? "Replace" : "Upload"}
                        </label>
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
                      <label className="upload">
                        <input
                          type="file"
                          hidden
                          accept="image/*"
                          disabled={uploadingLocationId === selectedLocation.id}
                          onChange={(event) => handleLocationPrimaryUpload(selectedLocation, event)}
                        />
                        {uploadingLocationId === selectedLocation.id ? "Uploading..." : "Replace"}
                      </label>
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
            <div className="project-header">
              <div>
                <h3>Pages</h3>
                <p className="helper-text">
                  {pagesStatus === "loading" && "Loading pages…"}
                  {pagesStatus === "error" && "Failed to load pages"}
                  {pagesStatus === "ready" && !selectedIssue && "Select an issue to view pages."}
                  {pagesStatus === "ready" && selectedIssue && pages.length === 0 && "No pages yet for this issue."}
                  {pagesStatus === "ready" && selectedIssue && pages.length > 0 && `${pages.length} page(s) in this issue.`}
                </p>
              </div>
              <div className="project-header-actions">
                <label htmlFor="issue-select" className="sr-only">Select Issue</label>
                <select
                  id="issue-select"
                  className="header-select"
                  value={selectedIssue}
                  onChange={(e) => setSelectedIssue(e.target.value)}
                  disabled={issueList.length === 0 && orphanedCount === 0}
                >
                  {issueList.length === 0 && orphanedCount === 0 && <option value="">No pages</option>}
                  {issueList.map((issue) => (
                    <option key={issue} value={issue}>
                      {issue}
                    </option>
                  ))}
                  {orphanedCount > 0 && (
                    <option value="__unassigned__">
                      ⚠️ Unassigned ({orphanedCount})
                    </option>
                  )}
                </select>
              </div>
            </div>
            {pagesStatus === "ready" && selectedIssue && pages.length > 0 && (
              <div className="pages-gallery">
                {pages.map((pageItem, index) => {
                  const panels = pageItem.panels ?? [];
                  const panelCount = panels.length;
                  const hasAnyRenders = panels.some((p) => p.renderAssetId);
                  const isUpdating = updatingPageId === pageItem.id;

                  return (
                    <div key={pageItem.id} className="page-card">
                      <div 
                        className="page-card-canvas"
                        style={{
                          backgroundColor: pageItem.backgroundColor || undefined,
                        }}
                      >
                        {panelCount === 0 && (
                          <div className="page-canvas-empty">
                            <span className="page-number">{index + 1}</span>
                          </div>
                        )}
                        {panels.map((panel) => (
                          <div
                            key={panel.id}
                            className="page-mini-panel"
                            style={{
                              left: `${panel.geometry.x * 100}%`,
                              top: `${panel.geometry.y * 100}%`,
                              width: `${panel.geometry.width * 100}%`,
                              height: `${panel.geometry.height * 100}%`,
                            }}
                          >
                            {panel.renderAssetId && (
                              <img
                                src={assetHref(panel.renderAssetId)}
                                alt=""
                                className="page-mini-panel-image"
                                style={{
                                  transform: `translate(${(panel.renderOffsetX ?? 0) * 100}%, ${(panel.renderOffsetY ?? 0) * 100}%) scale(${panel.renderScale ?? 1})`,
                                  transformOrigin: "50% 50%",
                                }}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="page-card-info">
                        <span className="page-card-label">
                          {pageItem.label || `Page ${index + 1}`}
                        </span>
                        <span className="page-card-meta">
                          {panelCount} panel{panelCount !== 1 ? "s" : ""}
                          {hasAnyRenders && " • rendered"}
                        </span>
                      </div>
                      <div className="page-card-actions">
                        <select
                          className="page-issue-select"
                          value={pageItem.issueLabel || "__unassigned__"}
                          onChange={(e) => {
                            const newIssue = e.target.value === "__unassigned__" ? null : e.target.value;
                            void handleChangePageIssue(pageItem.id, newIssue);
                          }}
                          disabled={isUpdating}
                          title="Assign to issue"
                        >
                          <option value="__unassigned__">Unassigned</option>
                          {issueList.map((issue) => (
                            <option key={issue} value={issue}>
                              {issue}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PanelsTab({
  settingsController,
  onRefreshIssues,
}: {
  settingsController: SettingsController;
  onRefreshIssues?: () => void;
}) {
  const { settings, updateSetting } = settingsController;
  const [page, setPage] = useState<StoryboardPage | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "saving" | "saved" | "error" | "generating">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<StoryboardPage[]>([]);
  const [allProjectPages, setAllProjectPages] = useState<StoryboardPage[]>([]); // All pages across all issues for library
  const [selectedPanelId, setSelectedPanelId] = useState<UUID | null>(null);
  const [selectedCaptionId, setSelectedCaptionId] = useState<UUID | null>(null);
  const [selectedBubbleId, setSelectedBubbleId] = useState<UUID | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasDisplayWidth, setCanvasDisplayWidth] = useState(0);
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
  const [characterReferences, setCharacterReferences] = useState<StoryboardCharacterReference[]>([]);
  const [locationReferences, setLocationReferences] = useState<StoryboardLocationReference[]>([]);
  const [itemReferences, setItemReferences] = useState<StoryboardItemReferenceEntry[]>([]);
  const [pendingItemId, setPendingItemId] = useState<UUID | "">("");
  const [autoPrompt, setAutoPrompt] = useState<string>("");
  const [editingPanelId, setEditingPanelId] = useState<UUID | null>(null);
  const [panelLibraryUploading, setPanelLibraryUploading] = useState<Record<UUID, boolean>>({});
  const [projectLibraryTargets, setProjectLibraryTargets] = useState<
    Record<UUID, { pageId: UUID | ""; panelId: UUID | "" }>
  >({});
  const [subTab, setSubTab] = useState<"layout" | "library" | "project-library">("layout");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    references: true,
    page: true,
    panel: true,
    generation: true,
    caption: true,
    bubble: true,
  });
  const [renderModelInFlight, setRenderModelInFlight] = useState<PanelRenderModel | null>(null);
  const [panelActionInFlight, setPanelActionInFlight] = useState<"render" | "edit" | null>(null);
  const [updatingPageIssue, setUpdatingPageIssue] = useState(false);
  // Track which history index each panel is viewing (undefined = latest/current)
  const [panelHistoryIndex, setPanelHistoryIndex] = useState<Record<UUID, number>>({});
  const [renderOrientation, setRenderOrientation] = useState<PanelOrientation>("horizontal");
  const [renderSizeId, setRenderSizeId] = useState<PanelRenderSizeId>("square");
  const renderSizeOptionsForOrientation = useMemo(
    () => PANEL_RENDER_SIZE_OPTIONS.filter((option) => option.orientations.includes(renderOrientation)),
    [renderOrientation],
  );

  useEffect(() => {
    if (renderSizeOptionsForOrientation.some((option) => option.id === renderSizeId)) {
      return;
    }
    const fallback = renderSizeOptionsForOrientation[0]?.id ?? PANEL_RENDER_SIZE_OPTIONS[0].id;
    setRenderSizeId(fallback as PanelRenderSizeId);
  }, [renderOrientation, renderSizeId, renderSizeOptionsForOrientation]);

  // Track canvas display size to scale strokes proportionally to export resolution
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateWidth = () => {
      setCanvasDisplayWidth(canvas.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [page]);

  // Get available issues from all project pages + custom issues
  const availableIssues = useMemo(() => {
    const issuesFromPages = allProjectPages
      .map((p) => p.issueLabel)
      .filter((label): label is string => Boolean(label && label.trim()));
    const customIssues = settings.customIssues ?? [];
    const allIssues = [...new Set([...issuesFromPages, ...customIssues])];
    return allIssues.sort();
  }, [allProjectPages, settings.customIssues]);

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

  useEffect(() => {
    let cancelled = false;
    const loadPages = async () => {
      if (!settings.projectSlug) return;
      try {
        const list = await listStoryboardPages({
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
          issueLabel: settings.selectedIssue,
        });
        if (cancelled) return;
        setPages(list);
        // When issue changes, switch to the first page of that issue (or null if empty)
        setPage((currentPage) => {
          if (!currentPage || !list.find((p) => p.id === currentPage.id)) {
            return list[0] ?? null;
          }
          return currentPage;
        });
      } catch (cause) {
        console.error("storyboard:pages_load_failed", cause);
      }
    };

    void loadPages();

    return () => {
      cancelled = true;
    };
  }, [settings.geminiKey, settings.projectSlug, settings.selectedIssue]);

  // Load ALL pages (no issue filter) for the project library view
  useEffect(() => {
    let cancelled = false;
    const loadAllPages = async () => {
      if (!settings.projectSlug) return;
      try {
        const list = await listStoryboardPages({
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
          // No issueLabel filter - get ALL pages for the library
        });
        if (cancelled) return;
        setAllProjectPages(list);
      } catch (cause) {
        console.error("storyboard:all_pages_load_failed", cause);
      }
    };

    void loadAllPages();

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

  // Caption box helpers
  const updateCaptionBox = useCallback(
    (captionId: UUID, updates: Partial<StoryboardCaptionBox>) => {
      let didChange = false;
      setPage((previous) => {
        if (!previous) return previous;
        const captionBoxes = previous.captionBoxes ?? [];
        const captionIndex = captionBoxes.findIndex((c) => c.id === captionId);
        if (captionIndex === -1) return previous;
        
        const caption = captionBoxes[captionIndex];
        const entries = Object.entries(updates) as Array<[keyof StoryboardCaptionBox, unknown]>;
        const hasDelta = entries.some(([key, value]) => {
          if (key === "geometry" && value) {
            return geometryChanged(caption.geometry, value as PanelGeometry);
          }
          return (caption as Record<string, unknown>)[key as string] !== value;
        });

        if (!hasDelta) return previous;

        didChange = true;
        const updatedCaption: StoryboardCaptionBox = {
          ...caption,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        const newCaptionBoxes = [...captionBoxes];
        newCaptionBoxes.splice(captionIndex, 1, updatedCaption);

        return {
          ...previous,
          captionBoxes: newCaptionBoxes,
          updatedAt: new Date().toISOString(),
        };
      });

      if (didChange) {
        markDirty();
      }
    },
    [markDirty],
  );

  const handleCreateCaptionBox = useCallback(() => {
    if (!page) return;
    
    const now = new Date().toISOString();
    const newCaption: StoryboardCaptionBox = {
      id: crypto.randomUUID() as UUID,
      geometry: { x: 0.05, y: 0.05, width: 0.25, height: 0.08 },
      text: "Caption text...",
      fontFamily: "Courier New",
      fontSize: 0.7,
      fill: "#f5f5f0",
      stroke: "#1a1a1a",
      strokeWidth: 2,
      shadowOffset: 3,
      shadowColor: "#1a1a1a",
      roughness: 0.7,
      seed: Math.floor(Math.random() * 10000),
      order: (page.captionBoxes?.length ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };

    setPage((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        captionBoxes: [...(previous.captionBoxes ?? []), newCaption],
        updatedAt: now,
      };
    });

    setSelectedCaptionId(newCaption.id);
    setSelectedPanelId(null);
    markDirty();
  }, [page, markDirty]);

  const handleDeleteCaptionBox = useCallback(
    (captionId: UUID) => {
      setPage((previous) => {
        if (!previous) return previous;
        const captionBoxes = previous.captionBoxes ?? [];
        const filtered = captionBoxes.filter((c) => c.id !== captionId);
        if (filtered.length === captionBoxes.length) return previous;
        return {
          ...previous,
          captionBoxes: filtered,
          updatedAt: new Date().toISOString(),
        };
      });
      if (selectedCaptionId === captionId) {
        setSelectedCaptionId(null);
      }
      markDirty();
    },
    [selectedCaptionId, markDirty],
  );

  const selectedCaption = useMemo(() => {
    if (!page || !selectedCaptionId) return null;
    return page.captionBoxes?.find((c) => c.id === selectedCaptionId) ?? null;
  }, [page, selectedCaptionId]);

  // Bubble helpers
  const updateBubble = useCallback(
    (bubbleId: UUID, updates: Partial<StoryboardBubble>) => {
      let didChange = false;
      setPage((previous) => {
        if (!previous) return previous;
        const bubbles = previous.bubbles ?? [];
        const bubbleIndex = bubbles.findIndex((b) => b.id === bubbleId);
        if (bubbleIndex === -1) return previous;

        const bubble = bubbles[bubbleIndex];
        const entries = Object.entries(updates) as Array<[keyof StoryboardBubble, unknown]>;
        const hasDelta = entries.some(([key, value]) => {
          if (key === "geometry" && value) {
            return geometryChanged(bubble.geometry, value as PanelGeometry);
          }
          return (bubble as Record<string, unknown>)[key as string] !== value;
        });

        if (!hasDelta) return previous;

        didChange = true;
        const updatedBubble: StoryboardBubble = {
          ...bubble,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        const newBubbles = [...bubbles];
        newBubbles.splice(bubbleIndex, 1, updatedBubble);

        return {
          ...previous,
          bubbles: newBubbles,
          updatedAt: new Date().toISOString(),
        };
      });

      if (didChange) {
        markDirty();
      }
    },
    [markDirty],
  );

  const handleCreateBubble = useCallback((type: BubbleType) => {
    if (!page) return;

    const now = new Date().toISOString();
    const newBubble: StoryboardBubble = {
      id: crypto.randomUUID() as UUID,
      type,
      geometry: { x: 0.1, y: 0.1, width: 0.25, height: 0.12 },
      text: type === "speech" ? "Hello!" : "Hmm...",
      fontFamily: "Comic Sans MS, cursive",
      fontSize: 0.85,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 2,
      tailAngle: 240,
      tailLength: 0.25,
      order: (page.bubbles?.length ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };

    setPage((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        bubbles: [...(previous.bubbles ?? []), newBubble],
        updatedAt: now,
      };
    });

    setSelectedBubbleId(newBubble.id);
    setSelectedPanelId(null);
    setSelectedCaptionId(null);
    markDirty();
  }, [page, markDirty]);

  // Create a new bubble linked to the currently selected bubble
  const handleCreateLinkedBubble = useCallback(() => {
    if (!page || !selectedBubbleId) return;

    const parentBubble = page.bubbles?.find((b) => b.id === selectedBubbleId);
    if (!parentBubble) return;

    const now = new Date().toISOString();
    
    // Position the new bubble offset from the parent
    // Calculate offset based on where there's space (try right, then down, then left, then up)
    const offsetX = 0.15;
    const offsetY = 0.08;
    let newX = parentBubble.geometry.x + parentBubble.geometry.width + 0.02;
    let newY = parentBubble.geometry.y;
    
    // If it would go off the right edge, try below
    if (newX + 0.2 > 0.95) {
      newX = parentBubble.geometry.x;
      newY = parentBubble.geometry.y + parentBubble.geometry.height + 0.02;
    }
    
    // Clamp to canvas bounds
    newX = Math.max(0.02, Math.min(0.75, newX));
    newY = Math.max(0.02, Math.min(0.85, newY));

    const newBubble: StoryboardBubble = {
      id: crypto.randomUUID() as UUID,
      type: parentBubble.type,
      geometry: { x: newX, y: newY, width: 0.2, height: 0.1 },
      text: "",
      fontFamily: parentBubble.fontFamily,
      fontSize: parentBubble.fontSize,
      fill: parentBubble.fill,
      stroke: parentBubble.stroke,
      strokeWidth: parentBubble.strokeWidth,
      tailAngle: parentBubble.tailAngle,
      tailLength: 0, // No tail for linked bubbles - the connector replaces it
      linkedToId: parentBubble.id,
      linkedCurveFlip: false,
      order: (page.bubbles?.length ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };

    setPage((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        bubbles: [...(previous.bubbles ?? []), newBubble],
        updatedAt: now,
      };
    });

    setSelectedBubbleId(newBubble.id);
    markDirty();
  }, [page, selectedBubbleId, markDirty]);

  const handleDeleteBubble = useCallback(
    (bubbleId: UUID) => {
      setPage((previous) => {
        if (!previous) return previous;
        const bubbles = previous.bubbles ?? [];
        const filtered = bubbles.filter((b) => b.id !== bubbleId);
        if (filtered.length === bubbles.length) return previous;
        return {
          ...previous,
          bubbles: filtered,
          updatedAt: new Date().toISOString(),
        };
      });
      if (selectedBubbleId === bubbleId) {
        setSelectedBubbleId(null);
      }
      markDirty();
    },
    [selectedBubbleId, markDirty],
  );

  const selectedBubble = useMemo(() => {
    if (!page || !selectedBubbleId) return null;
    return page.bubbles?.find((b) => b.id === selectedBubbleId) ?? null;
  }, [page, selectedBubbleId]);

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
        if (interaction.isCaptionBox) {
          updateCaptionBox(interaction.panelId, { geometry: nextGeometry });
        } else if (interaction.isBubble) {
          updateBubble(interaction.panelId, { geometry: nextGeometry });
        } else {
          updateGeometry(interaction.panelId, nextGeometry);
        }
      } else if (interaction.mode === "resize" && interaction.corner) {
        const minSize = (interaction.isCaptionBox || interaction.isBubble) ? MIN_CAPTION_SIZE : MIN_PANEL_SIZE;
        const nextGeometry = resizeGeometry(interaction.origin, dx, dy, interaction.corner, minSize);
        if (interaction.isCaptionBox) {
          updateCaptionBox(interaction.panelId, { geometry: nextGeometry });
        } else if (interaction.isBubble) {
          updateBubble(interaction.panelId, { geometry: nextGeometry });
        } else {
          updateGeometry(interaction.panelId, nextGeometry);
        }
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
  }, [updateGeometry, updateCaptionBox, updateBubble]);

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

  // Get full history of render assets for a panel: [...replacedAssetIds, renderAssetId]
  const getPanelHistory = useCallback((panel: StoryboardPanel | null): UUID[] => {
    if (!panel) return [];
    const history: UUID[] = [...(panel.replacedAssetIds ?? [])];
    if (panel.renderAssetId) {
      history.push(panel.renderAssetId);
    }
    return history;
  }, []);

  // Get the currently displayed asset ID for a panel (based on history index)
  const getPanelDisplayAssetId = useCallback(
    (panel: StoryboardPanel | null): UUID | undefined => {
      if (!panel) return undefined;
      const history = getPanelHistory(panel);
      if (history.length === 0) return undefined;
      const index = panelHistoryIndex[panel.id];
      if (index !== undefined && index >= 0 && index < history.length) {
        return history[index];
      }
      // Default to latest (renderAssetId)
      return panel.renderAssetId;
    },
    [getPanelHistory, panelHistoryIndex],
  );

  // Check if we can undo (go back in history)
  const canUndo = useMemo(() => {
    if (!selectedPanel) return false;
    const history = getPanelHistory(selectedPanel);
    if (history.length <= 1) return false;
    const currentIndex = panelHistoryIndex[selectedPanel.id] ?? history.length - 1;
    return currentIndex > 0;
  }, [selectedPanel, getPanelHistory, panelHistoryIndex]);

  // Check if we can redo (go forward in history)
  const canRedo = useMemo(() => {
    if (!selectedPanel) return false;
    const history = getPanelHistory(selectedPanel);
    if (history.length === 0) return false;
    const currentIndex = panelHistoryIndex[selectedPanel.id];
    if (currentIndex === undefined) return false; // Already at latest
    return currentIndex < history.length - 1;
  }, [selectedPanel, getPanelHistory, panelHistoryIndex]);

  // Handle undo - go back in history
  const handlePanelUndo = useCallback(() => {
    if (!selectedPanel || !canUndo) return;
    const history = getPanelHistory(selectedPanel);
    const currentIndex = panelHistoryIndex[selectedPanel.id] ?? history.length - 1;
    const newIndex = currentIndex - 1;
    setPanelHistoryIndex((previous) => ({
      ...previous,
      [selectedPanel.id]: newIndex,
    }));
  }, [selectedPanel, canUndo, getPanelHistory, panelHistoryIndex]);

  // Handle redo - go forward in history
  const handlePanelRedo = useCallback(() => {
    if (!selectedPanel || !canRedo) return;
    const history = getPanelHistory(selectedPanel);
    const currentIndex = panelHistoryIndex[selectedPanel.id] ?? history.length - 1;
    const newIndex = currentIndex + 1;
    if (newIndex >= history.length - 1) {
      // At latest, clear the index
      setPanelHistoryIndex((previous) => {
        const updated = { ...previous };
        delete updated[selectedPanel.id];
        return updated;
      });
    } else {
      setPanelHistoryIndex((previous) => ({
        ...previous,
        [selectedPanel.id]: newIndex,
      }));
    }
  }, [selectedPanel, canRedo, getPanelHistory, panelHistoryIndex]);

  // Get current history position info for display
  const historyInfo = useMemo(() => {
    if (!selectedPanel) return null;
    const history = getPanelHistory(selectedPanel);
    if (history.length === 0) return null;
    const currentIndex = panelHistoryIndex[selectedPanel.id] ?? history.length - 1;
    return {
      current: currentIndex + 1,
      total: history.length,
      isLatest: currentIndex === history.length - 1,
    };
  }, [selectedPanel, getPanelHistory, panelHistoryIndex]);

  useEffect(() => {
    const characterTokens = characterReferences
      .map((reference) => {
        const character = characters.find((candidate) => candidate.id === reference.characterId);
        if (!character) {
          return null;
        }
        if (reference.slotId) {
          const slot = character.slots?.find((entry) => entry.id === reference.slotId);
          if (slot) {
            return `[${slot.label}]`;
          }
        }
        return `[${character.name}]`;
      })
      .filter((token): token is string => Boolean(token));

    const locationTokens = locationReferences
      .map((reference) => {
        const location = locations.find((candidate) => candidate.id === reference.locationId);
        if (!location) {
          return null;
        }
        if (!reference.spotId || reference.spotId === "primary") {
          return `[${location.name}]`;
        }
        const spot = location.spots?.find((candidate) => candidate.id === reference.spotId);
        if (spot) {
          return `[${location.name} - ${spot.label}]`;
        }
        return `[${location.name}]`;
      })
      .filter((token): token is string => Boolean(token));

    const itemTokens = itemReferences
      .map((reference) => {
        const item = items.find((candidate) => candidate.id === reference.itemId);
        return item ? `[${item.label}]` : null;
      })
      .filter((token): token is string => Boolean(token));

    const parts: string[] = [];

    if (characterTokens.length > 0) {
      parts.push(characterTokens.join(", "));
    }

    if (locationTokens.length > 0) {
      const prefix = characterTokens.length > 0 ? "in " : "";
      parts.push(`${prefix}${locationTokens.join(", ")}`);
    }

    if (itemTokens.length > 0) {
      parts.push(`with ${itemTokens.join(", ")}`);
    }

    let composed = parts.join(" ").trim();
    if (composed.length > 0 && !composed.endsWith(".")) {
      composed = `${composed}.`;
    } else if (composed.length === 0) {
      composed = "";
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
    characterReferences,
    characters,
    itemReferences,
    items,
    locationReferences,
    locations,
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
      setPages((current) => {
        const without = current.filter((candidate) => candidate.id !== layout.id);
        return [...without, layout];
      });
      setHasChanges(false);
      setStatus((current) => {
        if (current === "loading" || current === "error") {
          return "ready";
        }
        return current;
      });
      // Only update panel selection if no bubble or caption is currently selected
      // This prevents the selection from jumping away when auto-save runs
      setSelectedPanelId((current) => {
        if (current && layout.panels.some((panel) => panel.id === current)) {
          return current;
        }
        // Don't auto-select a panel if we don't have one selected
        // (user might have a bubble or caption selected instead)
        if (current === null) {
          return null;
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

  // Auto-save effect
  useEffect(() => {
    if (!hasChanges || !page) return;

    const timer = setTimeout(() => {
      void handleSave();
    }, 1000);

    return () => clearTimeout(timer);
  }, [page, hasChanges, handleSave]);

  const handleRefresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const layout = await fetchStoryboardLayout({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      markLayoutLoaded(layout);
      const list = await listStoryboardPages({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
        issueLabel: settings.selectedIssue,
      });
      setPages(list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load layout");
      setStatus("error");
    }
  }, [markLayoutLoaded, settings.geminiKey, settings.projectSlug, settings.selectedIssue]);

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
      if (!page) return;
      if (page.backgroundColor === value) return;

      setPage((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          backgroundColor: value,
          updatedAt: new Date().toISOString(),
        };
      });
      markDirty();
      updateSetting("defaultPageBackgroundColor", value);
    },
    [markDirty, page, updateSetting],
  );

  // Change the current page's issue assignment
  const handlePageIssueChange = useCallback(
    async (newIssue: string | null) => {
      if (!page) return;
      setUpdatingPageIssue(true);
      try {
        const updated = await updatePageIssue(page.id, newIssue, {
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
        });
        // Update local page state
        setPage(updated);
        // Update the selected issue setting if we moved to a different issue
        if (newIssue && newIssue !== settings.selectedIssue) {
          updateSetting("selectedIssue", newIssue);
        }
        // Refresh all project pages
        const allList = await listStoryboardPages({
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
        });
        setAllProjectPages(allList);
        // Refresh the current issue's pages
        const filteredList = await listStoryboardPages({
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
          issueLabel: newIssue ?? settings.selectedIssue,
        });
        setPages(filteredList);
        // Notify parent to refresh issues
        onRefreshIssues?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update page issue");
        setStatus("error");
      } finally {
        setUpdatingPageIssue(false);
      }
    },
    [page, settings.geminiKey, settings.projectSlug, settings.selectedIssue, updateSetting, onRefreshIssues],
  );

  const statusMessage = useMemo(() => {
    if (status === "loading") return "Loading layout...";
    if (status === "saving") return "Saving changes...";
    if (status === "generating") {
      return panelActionInFlight === "edit" ? "Editing panel image..." : "Generating panel image...";
    }
    if (status === "saved") return "Layout saved";
    if (status === "error") return error ?? "Layout unavailable";
    if (hasChanges) return "Unsaved changes";
    return "Drag panels or update metadata";
  }, [status, error, hasChanges, panelActionInFlight]);

  const renderButtonDisabled =
    !selectedPanel ||
    !selectedPanel.prompt ||
    selectedPanel.prompt.trim().length === 0 ||
    status === "loading" ||
    status === "saving" ||
    status === "generating";

  const renderButtonLabel = (model: PanelRenderModel) => {
    const label = PANEL_RENDER_MODEL_LABELS[model] ?? "Nano Banana";
    if (status === "generating" && renderModelInFlight === model && panelActionInFlight === "render") {
      return `Generating with ${label}...`;
    }
    return `Generate Panel Image with ${label}`;
  };

  const editButtonDisabled = renderButtonDisabled || !getPanelDisplayAssetId(selectedPanel);

  const editButtonLabel = (model: PanelRenderModel) => {
    const label = PANEL_RENDER_MODEL_LABELS[model] ?? "Nano Banana";
    if (status === "generating" && renderModelInFlight === model && panelActionInFlight === "edit") {
      return `Editing with ${label}...`;
    }
    return `Edit with ${label}`;
  };

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

  const handleResetCrop = useCallback(() => {
    if (!selectedPanel) return;
    updatePanel(selectedPanel.id, {
      renderScale: 1,
      renderOffsetX: 0,
      renderOffsetY: 0,
    });
  }, [selectedPanel, updatePanel]);

  const duplicateSelectedPanel = useCallback(() => {
    if (!selectedPanel) return;
    const newId = generateId();
    const timestamp = new Date().toISOString();
    let duplicated = false;

    setPage((previous) => {
      if (!previous) return previous;
      const panelIndex = previous.panels.findIndex((panel) => panel.id === selectedPanel.id);
      if (panelIndex === -1) return previous;
      const base = previous.panels[panelIndex];

      const geometry = {
        ...base.geometry,
        x: clampFraction(base.geometry.x + 0.02, 0, 1 - base.geometry.width),
        y: clampFraction(base.geometry.y + 0.02, 0, 1 - base.geometry.height),
      };

      const duplicate: StoryboardPanel = {
        ...base,
        id: newId as UUID,
        pageId: previous.id,
        label: base.label ? `${base.label} copy` : `Panel ${base.order + 2}`,
        order: base.order + 1,
        geometry,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const panels = [...previous.panels];
      panels.splice(panelIndex + 1, 0, duplicate);
      const reindexed = panels.map((panel, order) => ({
        ...panel,
        order,
        updatedAt: timestamp,
      }));

      duplicated = true;
      return {
        ...previous,
        panels: reindexed,
        updatedAt: timestamp,
      };
    });

    if (duplicated) {
      setSelectedPanelId(newId as UUID);
      markDirty();
    }
  }, [markDirty, selectedPanel]);

  const movePanelLayer = useCallback(
    (panelId: UUID, direction: "up" | "down") => {
      setPage((previous) => {
        if (!previous) return previous;
        const index = previous.panels.findIndex((panel) => panel.id === panelId);
        if (index === -1) return previous;

        const targetIndex = direction === "up" ? Math.min(previous.panels.length - 1, index + 1) : Math.max(0, index - 1);
        if (targetIndex === index) return previous;

        const panels = [...previous.panels];
        const [moved] = panels.splice(index, 1);
        panels.splice(targetIndex, 0, moved);

        const reindexed = panels.map((panel, order) => ({
          ...panel,
          order,
          updatedAt: new Date().toISOString(),
        }));

        return {
          ...previous,
          panels: reindexed,
          updatedAt: new Date().toISOString(),
        };
      });
      markDirty();
    },
    [markDirty],
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

  const handleAddCharacterReference = useCallback(() => {
    if (!characterSelection.characterId) {
      return;
    }
    setCharacterReferences((previous) => {
      const duplicate = previous.some(
        (entry) =>
          entry.characterId === characterSelection.characterId &&
          (entry.slotId ?? null) === (characterSelection.slotId ?? null),
      );
      if (duplicate) {
        return previous;
      }
      return [
        ...previous,
        {
          id: crypto.randomUUID() as UUID,
          characterId: characterSelection.characterId as UUID,
          slotId: characterSelection.slotId,
        },
      ];
    });
    setCharacterSelection((previous) => ({
      characterId: previous.characterId,
      slotId: undefined,
    }));
  }, [characterSelection]);

  const handleRemoveCharacterReference = useCallback((referenceId: UUID) => {
    setCharacterReferences((previous) => previous.filter((reference) => reference.id !== referenceId));
  }, []);

  const handleAddLocationReference = useCallback(() => {
    if (!locationSelection.locationId) {
      return;
    }
    setLocationReferences((previous) => {
      const duplicate = previous.some(
        (entry) =>
          entry.locationId === locationSelection.locationId &&
          (entry.spotId ?? null) === (locationSelection.spotId ?? null),
      );
      if (duplicate) {
        return previous;
      }
      return [
        ...previous,
        {
          id: crypto.randomUUID() as UUID,
          locationId: locationSelection.locationId as UUID,
          spotId: locationSelection.spotId,
        },
      ];
    });
    setLocationSelection((previous) => ({
      locationId: previous.locationId,
      spotId: undefined,
    }));
  }, [locationSelection]);

  const handleRemoveLocationReference = useCallback((referenceId: UUID) => {
    setLocationReferences((previous) => previous.filter((reference) => reference.id !== referenceId));
  }, []);

  const handlePendingItemChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setPendingItemId(event.target.value as UUID | "");
  }, []);

  const handleAddItemReference = useCallback(() => {
    if (!pendingItemId) {
      return;
    }
    setItemReferences((previous) => {
      const duplicate = previous.some((entry) => entry.itemId === pendingItemId);
      if (duplicate) {
        return previous;
      }
      return [
        ...previous,
        {
          id: crypto.randomUUID() as UUID,
          itemId: pendingItemId,
        },
      ];
    });
    setPendingItemId("");
  }, [pendingItemId]);

  const handleRemoveItemReference = useCallback((referenceId: UUID) => {
    setItemReferences((previous) => previous.filter((reference) => reference.id !== referenceId));
  }, []);

  const handleRenderSizeChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setRenderSizeId(event.target.value as PanelRenderSizeId);
  }, []);

  const handleRenderOrientationChange = useCallback((orientation: PanelOrientation) => {
    setRenderOrientation(orientation);
  }, []);

  const resolveCharacterReferenceLabel = useCallback(
    (reference: StoryboardCharacterReference): string => {
      const character = characters.find((candidate) => candidate.id === reference.characterId);
      if (!character) {
        return "Unknown character";
      }
      if (reference.slotId) {
        const slot = character.slots?.find((entry) => entry.id === reference.slotId);
        if (slot) {
          return `${character.name} - ${slot.label}`;
        }
      }
      return `${character.name} (Any view)`;
    },
    [characters],
  );

  const resolveLocationReferenceLabel = useCallback(
    (reference: StoryboardLocationReference): string => {
      const location = locations.find((candidate) => candidate.id === reference.locationId);
      if (!location) {
        return "Unknown location";
      }
      if (!reference.spotId || reference.spotId === "primary") {
        return `${location.name}${reference.spotId === "primary" ? " - Primary" : ""}`;
      }
      const spot = location.spots?.find((entry) => entry.id === reference.spotId);
      if (spot) {
        return `${location.name} - ${spot.label}`;
      }
      return location.name;
    },
    [locations],
  );

  const resolveItemReferenceLabel = useCallback(
    (reference: StoryboardItemReferenceEntry): string => {
      const item = items.find((candidate) => candidate.id === reference.itemId);
      return item?.label ?? "Unknown item";
    },
    [items],
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

  const handleCreatePage = useCallback(async () => {
    setStatus("saving");
    setError(null);
    try {
      let next = await createStoryboardPageApi({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
        issueLabel: settings.selectedIssue,
      });

      if (settings.defaultPageBackgroundColor) {
        next = { ...next, backgroundColor: settings.defaultPageBackgroundColor };
        next = await saveStoryboardLayout(next, {
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
        });
      }

      markLayoutLoaded(next);
      setSelectedPanelId(next.panels[0]?.id ?? null);
      // Refresh pages list for this issue
      const list = await listStoryboardPages({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
        issueLabel: settings.selectedIssue,
      });
      setPages(list);
      // Also refresh all project pages for the library
      const allList = await listStoryboardPages({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      setAllProjectPages(allList);
      // Notify parent to refresh issues list if this is a new issue
      onRefreshIssues?.();
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create page");
      setStatus("error");
    }
  }, [markLayoutLoaded, settings.geminiKey, settings.projectSlug, settings.defaultPageBackgroundColor, settings.selectedIssue, onRefreshIssues]);

  const handleDeletePage = useCallback(async () => {
    if (!page) return;
    if (!window.confirm(`Delete "${page.label || "current page"}"? This cannot be undone.`)) {
      return;
    }

    setStatus("saving");
    setError(null);
    try {
      const active = await deleteStoryboardPageApi(page.id, {
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      markLayoutLoaded(active);
      const list = await listStoryboardPages({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
        issueLabel: settings.selectedIssue,
      });
      setPages(list);
      // Also refresh all project pages for the library
      const allList = await listStoryboardPages({
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      setAllProjectPages(allList);
      // Refresh issues list in case this was the last page for an issue
      onRefreshIssues?.();
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete page");
      setStatus("error");
    }
  }, [markLayoutLoaded, page, settings.geminiKey, settings.projectSlug, settings.selectedIssue, onRefreshIssues]);

  const handleSelectPage = useCallback(
    async (pageId: UUID) => {
      setStatus("loading");
      setError(null);
      try {
        const active = await activateStoryboardPage(pageId, {
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
        });
        markLayoutLoaded(active);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to switch page");
        setStatus("error");
      }
    },
    [markLayoutLoaded, settings.geminiKey, settings.projectSlug],
  );

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
        setPage((current) => {
          if (current?.id === result.page.id) {
            return result.page;
          }
          return current;
        });
        setPages((previous) => {
          const index = previous.findIndex((candidate) => candidate.id === result.page.id);
          if (index === -1) {
            return [...previous, result.page];
          }
          const next = [...previous];
          next.splice(index, 1, result.page);
          return next;
        });
        // Also update allProjectPages for the library view
        setAllProjectPages((previous) => {
          const index = previous.findIndex((candidate) => candidate.id === result.page.id);
          if (index === -1) {
            return [...previous, result.page];
          }
          const next = [...previous];
          next.splice(index, 1, result.page);
          return next;
        });
        // Reset history index to show the new upload (latest)
        setPanelHistoryIndex((previous) => {
          const updated = { ...previous };
          delete updated[panelId];
          return updated;
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to upload panel image");
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
      // If width/height look like normalized fractions (0-1), fall back to
      // the default page size so we don't export a 1px canvas.
      const hasNormalizedSize =
        page.width > 0 && page.width <= 1 && page.height > 0 && page.height <= 1;

      const width = Math.round(hasNormalizedSize ? 1988 : page.width || 1988);
      const height = Math.round(hasNormalizedSize ? 3075 : page.height || 3075);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = page.backgroundColor ?? "#ffffff";
      ctx.fillRect(0, 0, width, height);

      const displayCanvas = canvasRef.current;
      const displayWidth = displayCanvas?.clientWidth ?? width;
      const displayHeight = displayCanvas?.clientHeight ?? height;
      const exportScaleX = displayWidth > 0 ? width / displayWidth : 1;
      const exportScaleY = displayHeight > 0 ? height / displayHeight : 1;

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

        // Compute a base scale that fits the entire image inside the panel (letterboxed),
        // then apply the user-controlled renderScale on top so UI and export match.
        const imageAspect = img.width / img.height || 1;
        const panelAspect = panelW / panelH || 1;
        const containScale =
          panelAspect > imageAspect ? panelH / img.height || 1 : panelW / img.width || 1;

        const scale = (panel.renderScale ?? 1) * containScale;
        const offsetX = panel.renderOffsetX ?? 0;
        const offsetY = panel.renderOffsetY ?? 0;
        const rotationRadians = ((panel.rotation ?? 0) * Math.PI) / 180;

        const drawW = img.width * scale;
        const drawH = img.height * scale;

        const centerX = panelX + panelW / 2;
        const centerY = panelY + panelH / 2;

        const offsets = panel.geometry.cornerOffsets;
        const shadowBlur = panel.shadowBlur ?? 0;
        const shadowColor = panel.shadowColor ?? "rgba(0,0,0,0.35)";

        const buildPath = () => {
          ctx.beginPath();
          if (offsets) {
            // Offsets are stored as fractions of the panel's own width/height.
            const off = (c: { x: number; y: number } | undefined) => ({
              x: (c?.x ?? 0) * panelW,
              y: (c?.y ?? 0) * panelH,
            });

            const tl = {
              x: panelX + off(offsets.topLeft).x,
              y: panelY + off(offsets.topLeft).y,
            };
            const tr = {
              x: panelX + panelW + off(offsets.topRight).x,
              y: panelY + off(offsets.topRight).y,
            };
            const br = {
              x: panelX + panelW + off(offsets.bottomRight).x,
              y: panelY + panelH + off(offsets.bottomRight).y,
            };
            const bl = {
              x: panelX + off(offsets.bottomLeft).x,
              y: panelY + panelH + off(offsets.bottomLeft).y,
            };

            ctx.moveTo(tl.x, tl.y);
            ctx.lineTo(tr.x, tr.y);
            ctx.lineTo(br.x, br.y);
            ctx.lineTo(bl.x, bl.y);
            ctx.closePath();
          } else {
            ctx.rect(panelX, panelY, panelW, panelH);
          }
        };

        ctx.save();
        buildPath();

        if (shadowBlur > 0) {
          ctx.save();
          ctx.shadowColor = shadowColor;
          ctx.shadowBlur = shadowBlur;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.fillStyle = shadowColor;
          ctx.fill();
          ctx.restore();
          buildPath();
        }

        ctx.clip();
        ctx.translate(centerX + offsetX * panelW, centerY + offsetY * panelH);
        if (rotationRadians !== 0) {
          ctx.rotate(rotationRadians);
        }
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();

        if (panel.strokeWidth && panel.strokeWidth > 0) {
          ctx.save();
          buildPath();
          ctx.lineWidth = panel.strokeWidth;
          ctx.strokeStyle = panel.strokeColor ?? "#000000";
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw caption boxes
      const captionBoxes = page.captionBoxes ?? [];
      for (const caption of captionBoxes) {
        const capX = caption.geometry.x * width;
        const capY = caption.geometry.y * height;
        const capW = caption.geometry.width * width;
        const capH = caption.geometry.height * height;

        // Generate rough edge points
        const seededRandom = (seed: number) => {
          const x = Math.sin(seed) * 10000;
          return x - Math.floor(x);
        };

        const generateRoughPoints = (
          startX: number, startY: number, endX: number, endY: number,
          segments: number, roughness: number, seed: number, isHorizontal: boolean,
          scale: number
        ): Array<{ x: number; y: number }> => {
          const points: Array<{ x: number; y: number }> = [];
          const dx = (endX - startX) / segments;
          const dy = (endY - startY) / segments;
          const perpX = isHorizontal ? 0 : 1;
          const perpY = isHorizontal ? 1 : 0;
          const maxOffset = 2.5 * roughness * scale;

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

        // No internal padding - use full caption box dimensions
        const left = capX;
        const top = capY;
        const right = capX + capW;
        const bottom = capY + capH;

        // Scale everything based on how much the export canvas differs from the on-screen canvas
        const exportScale = exportScaleX;
        
        const topEdge = generateRoughPoints(left, top, right, top, edgeDetail, roughness, seed, true, exportScale);
        const rightEdge = generateRoughPoints(right, top, right, bottom, edgeDetail, roughness, seed + 100, false, exportScale);
        const bottomEdge = generateRoughPoints(right, bottom, left, bottom, edgeDetail, roughness, seed + 200, true, exportScale);
        const leftEdge = generateRoughPoints(left, bottom, left, top, edgeDetail, roughness, seed + 300, false, exportScale);

        const allPoints = [...topEdge, ...rightEdge.slice(1), ...bottomEdge.slice(1), ...leftEdge.slice(1)];

        const scaledShadowOffset = (caption.shadowOffset ?? 3) * exportScale;

        // Draw shadow
        if (scaledShadowOffset > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(allPoints[0].x + scaledShadowOffset, allPoints[0].y + scaledShadowOffset);
          for (let i = 1; i < allPoints.length; i++) {
            ctx.lineTo(allPoints[i].x + scaledShadowOffset, allPoints[i].y + scaledShadowOffset);
          }
          ctx.closePath();
          ctx.fillStyle = caption.shadowColor ?? "#1a1a1a";
          ctx.globalAlpha = 0.9;
          ctx.fill();
          ctx.restore();
        }

        // Draw main box
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(allPoints[0].x, allPoints[0].y);
        for (let i = 1; i < allPoints.length; i++) {
          ctx.lineTo(allPoints[i].x, allPoints[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = caption.fill ?? "#f5f5f0";
        ctx.fill();
        if (caption.strokeWidth > 0) {
          ctx.lineWidth = caption.strokeWidth * exportScale;
          ctx.strokeStyle = caption.stroke ?? "#1a1a1a";
          ctx.lineJoin = "round";
          ctx.stroke();
        }
        ctx.restore();

        // Draw text (match on-screen appearance exactly)
        ctx.save();
        const baseFontSizePx = (caption.fontSize ?? 0.7) * 16; // rem -> px
        const fontSize = baseFontSizePx * exportScale;
        ctx.font = `${fontSize}px ${caption.fontFamily ?? "Courier New"}`;
        ctx.fillStyle = "#1a1a1a";
        ctx.textBaseline = "top";

        const textPaddingX = 0.6 * 16 * exportScale; // 0.6rem horizontal padding
        const textPaddingY = 0.5 * 16 * exportScale; // 0.5rem vertical padding
        const maxTextWidth = Math.max(1, capW - textPaddingX * 2);
        const maxTextHeight = Math.max(1, capH - textPaddingY * 2);
        
        // Simple text wrapping
        const lines: string[] = [];
        const paragraphs = caption.text.split(/\n/);
        
        for (const paragraph of paragraphs) {
          if (paragraph.trim() === "") {
            lines.push("");
            continue;
          }
          const words = paragraph.split(/\s+/);
          let currentLine = "";

          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxTextWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) lines.push(currentLine);
        }

        const lineHeight = fontSize * 1.3;
        const maxY = capY + textPaddingY + maxTextHeight;
        let textY = capY + textPaddingY;
        for (const line of lines) {
          if (textY > maxY) break;
          const remainingHeight = maxY - textY;
          if (remainingHeight < lineHeight * 0.35) break; // avoid clipping tiny slivers
          ctx.fillText(line, capX + textPaddingX, textY, maxTextWidth);
          textY += lineHeight;
        }
        ctx.restore();
      }

      // ========== UNIFIED SHAPE approach for canvas export ==========
      // For linked bubbles: create ONE combined path (parent + connector + child)
      // For non-linked bubbles: draw normally with their own stroke
      
      const bubbleExportScale = exportScaleX;
      const bubbles = page.bubbles ?? [];
      
      // Collect IDs of bubbles involved in linked relationships
      const linkedBubbleIds = new Set<string>();
      bubbles.forEach((b) => {
        if (b.linkedToId) {
          linkedBubbleIds.add(b.id);
          linkedBubbleIds.add(b.linkedToId);
        }
      });

      // Store text data for all bubbles
      const bubbleTextData: Array<{ bubX: number; bubY: number; bubW: number; bubH: number; bubble: typeof bubbles[0] }> = [];

      // Draw non-linked bubbles first (they have their own strokes)
      for (const bubble of bubbles) {
        const bubX = bubble.geometry.x * width;
        const bubY = bubble.geometry.y * height;
        const bubW = bubble.geometry.width * width;
        const bubH = bubble.geometry.height * height;
        bubbleTextData.push({ bubX, bubY, bubW, bubH, bubble });

        if (linkedBubbleIds.has(bubble.id)) continue; // Skip linked bubbles for now

        const scaleX = bubW / BUBBLE_VIEWBOX_WIDTH;
        const scaleY = bubH / BUBBLE_VIEWBOX_HEIGHT;
        const convertX = (value: number) => bubX + value * scaleX;
        const convertY = (value: number) => bubY + value * scaleY;

        const cxNorm = BUBBLE_VIEWBOX_WIDTH * 0.5;
        const cyNorm = BUBBLE_VIEWBOX_HEIGHT * (0.5 - bubble.tailLength * BUBBLE_TAIL_LIFT);
        const rxNorm = BUBBLE_VIEWBOX_WIDTH * 0.5 - BUBBLE_PADDING * 2;
        const ryNorm = BUBBLE_VIEWBOX_HEIGHT * 0.5 - BUBBLE_PADDING * 2 - BUBBLE_VIEWBOX_HEIGHT * bubble.tailLength * BUBBLE_TAIL_LIFT;

        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = bubble.strokeWidth * bubbleExportScale;
        ctx.strokeStyle = bubble.stroke;
        ctx.fillStyle = bubble.fill;

        if (bubble.type === "thought") {
          // Cloud shape
          const numBumps = 10;
          const points: Array<{ x: number; y: number; bx: number; by: number }> = [];
          for (let i = 0; i < numBumps; i++) {
            const angle = (i / numBumps) * Math.PI * 2;
            const nextAngle = ((i + 1) / numBumps) * Math.PI * 2;
            const midAngle = (angle + nextAngle) / 2;
            const bumpOut = 0.15 * Math.sin(i * 2.3 + 1);
            const bumpFactor = 0.2 + 0.1 * Math.sin(i * 3.7);
            points.push({
              x: convertX(cxNorm + rxNorm * (1 + bumpOut) * Math.cos(angle)),
              y: convertY(cyNorm + ryNorm * (1 + bumpOut) * Math.sin(angle)),
              bx: convertX(cxNorm + rxNorm * (1 + bumpFactor) * Math.cos(midAngle)),
              by: convertY(cyNorm + ryNorm * (1 + bumpFactor) * Math.sin(midAngle)),
            });
          }
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 0; i < points.length; i++) {
            const next = points[(i + 1) % points.length];
            ctx.quadraticCurveTo(points[i].bx, points[i].by, next.x, next.y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Thought circles
          const angleRad = (bubble.tailAngle * Math.PI) / 180;
          const tailLengthNorm = bubble.tailLength * BUBBLE_VIEWBOX_HEIGHT * THOUGHT_TAIL_SCALE * 2.2;
          const startDistNorm = Math.max(rxNorm, ryNorm) * 0.85;
          for (let i = 0; i < 3; i++) {
            const t = (i + 1) / 3;
            const circleX = convertX(cxNorm + (startDistNorm + tailLengthNorm * t) * Math.cos(angleRad));
            const circleY = convertY(cyNorm + (startDistNorm + tailLengthNorm * t) * Math.sin(angleRad));
            const r = Math.max(3, 12 - i * 3);
            ctx.beginPath();
            ctx.ellipse(circleX, circleY, r * scaleX, r * scaleY, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        } else {
          // Speech bubble with tail
          const angleRad = (bubble.tailAngle * Math.PI) / 180;
          const tailSpread = 12;
          const angle1 = angleRad - (tailSpread * Math.PI) / 180;
          const angle2 = angleRad + (tailSpread * Math.PI) / 180;
          const tailLenNorm = bubble.tailLength * BUBBLE_VIEWBOX_HEIGHT * SPEECH_TAIL_SCALE;

          const base1X = convertX(cxNorm + rxNorm * Math.cos(angle1));
          const base1Y = convertY(cyNorm + ryNorm * Math.sin(angle1));
          const tipX = convertX(cxNorm + (rxNorm + tailLenNorm) * Math.cos(angleRad));
          const tipY = convertY(cyNorm + (ryNorm + tailLenNorm) * Math.sin(angleRad));

          ctx.beginPath();
          ctx.moveTo(base1X, base1Y);
          ctx.ellipse(convertX(cxNorm), convertY(cyNorm), rxNorm * scaleX, ryNorm * scaleY, 0, angle1, angle2, true);
          ctx.lineTo(tipX, tipY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // Draw linked bubble connectors using BubbleBoy pattern (quad tails + ellipse outlines/fills)
      // LAYER 1: Outline all tails and linked bubble ellipses
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      
      // Draw tail outlines
      for (const childBubble of bubbles) {
        if (!childBubble.linkedToId) continue;
        const parentBubble = bubbles.find((b) => b.id === childBubble.linkedToId);
        if (!parentBubble) continue;

        const childCx = (childBubble.geometry.x + childBubble.geometry.width / 2) * width;
        const childCy = (childBubble.geometry.y + childBubble.geometry.height / 2) * height;
        const parentCx = (parentBubble.geometry.x + parentBubble.geometry.width / 2) * width;
        const parentCy = (parentBubble.geometry.y + parentBubble.geometry.height / 2) * height;

        const dx = parentCx - childCx;
        const dy = parentCy - childCy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const dirX = dx / dist;
        const dirY = dy / dist;
        const nx = -dirY;
        const ny = dirX;

        const strokeW = (childBubble.strokeWidth ?? 2) * exportScaleX;
        // 75% slimmer connector (25% of original tip widths)
        const TIP_WIDE = strokeW * 1.25;
        const TIP_NARROW = strokeW * 0.625;

        // Endpoints at CENTER of bubbles to hide seams
        const startX = childCx;
        const startY = childCy;
        const endX = parentCx;
        const endY = parentCy;

        // Curved ribbon: bend toward normal at mid-point
        const curviness = dist * 0.15;
        const ctrlX = (startX + endX) * 0.5 + nx * curviness;
        const ctrlY = (startY + endY) * 0.5 + ny * curviness;

        const p1x = startX + nx * TIP_WIDE * 0.5;
        const p1y = startY + ny * TIP_WIDE * 0.5;
        const p2x = endX + nx * TIP_NARROW * 0.5;
        const p2y = endY + ny * TIP_NARROW * 0.5;
        const p3x = endX - nx * TIP_NARROW * 0.5;
        const p3y = endY - ny * TIP_NARROW * 0.5;
        const p4x = startX - nx * TIP_WIDE * 0.5;
        const p4y = startY - ny * TIP_WIDE * 0.5;

        ctx.lineWidth = strokeW;
        ctx.strokeStyle = childBubble.stroke;
        ctx.beginPath();
        ctx.moveTo(p1x, p1y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, p2x, p2y);
        ctx.lineTo(p3x, p3y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, p4x, p4y);
        ctx.closePath();
        ctx.stroke();
      }

      // Draw linked bubble ellipse outlines
      for (const bubble of bubbles) {
        if (!linkedBubbleIds.has(bubble.id)) continue;
        const cx = (bubble.geometry.x + bubble.geometry.width / 2) * width;
        const cy = (bubble.geometry.y + bubble.geometry.height / 2) * height;
        const rx = (bubble.geometry.width / 2) * width * 0.9;
        const ry = (bubble.geometry.height / 2) * height * 0.9;
        const strokeW = (bubble.strokeWidth ?? 2) * exportScaleX;

        ctx.lineWidth = strokeW;
        ctx.strokeStyle = bubble.stroke;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw parent tips so speaker direction remains visible when linked
      for (const bubble of bubbles) {
        const hasChild = bubbles.some((b) => b.linkedToId === bubble.id);
        // Only roots (no parent) should draw tips
        if (!hasChild || bubble.linkedToId) continue;

        const cx = (bubble.geometry.x + bubble.geometry.width / 2) * width;
        const cy = (bubble.geometry.y + bubble.geometry.height / 2) * height;
        // Match ellipse inset so base meets bubble edge cleanly
        const rx = (bubble.geometry.width / 2) * width * 0.9;
        const ry = (bubble.geometry.height / 2) * height * 0.9;
        const rMin = Math.min(rx, ry);

        const tailAngle = (bubble.tailAngle ?? 240) * (Math.PI / 180);
        const spread = 12 * (Math.PI / 180);
        const angle1 = tailAngle - spread;
        const angle2 = tailAngle + spread;

        const base1X = cx + rx * Math.cos(angle1);
        const base1Y = cy + ry * Math.sin(angle1);
        const base2X = cx + rx * Math.cos(angle2);
        const base2Y = cy + ry * Math.sin(angle2);
        const strokeW = (bubble.strokeWidth ?? 2) * exportScaleX;
        const tailLen = rMin * Math.max(0.05, bubble.tailLength ?? 0.3) + strokeW * 0.5;
        const tipX = cx + (rMin + tailLen) * Math.cos(tailAngle);
        const tipY = cy + (rMin + tailLen) * Math.sin(tailAngle);

        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = bubble.stroke;
        ctx.fillStyle = bubble.fill;

        ctx.beginPath();
        ctx.moveTo(base1X, base1Y);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(base2X, base2Y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // LAYER 2: Fill all tails and linked bubble ellipses (covers internal strokes)
      for (const childBubble of bubbles) {
        if (!childBubble.linkedToId) continue;
        const parentBubble = bubbles.find((b) => b.id === childBubble.linkedToId);
        if (!parentBubble) continue;

        const childCx = (childBubble.geometry.x + childBubble.geometry.width / 2) * width;
        const childCy = (childBubble.geometry.y + childBubble.geometry.height / 2) * height;
        const parentCx = (parentBubble.geometry.x + parentBubble.geometry.width / 2) * width;
        const parentCy = (parentBubble.geometry.y + parentBubble.geometry.height / 2) * height;

        const dx = parentCx - childCx;
        const dy = parentCy - childCy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const dirX = dx / dist;
        const dirY = dy / dist;
        const nx = -dirY;
        const ny = dirX;

        const strokeW = (childBubble.strokeWidth ?? 2) * exportScaleX;
        // 75% slimmer connector (25% of original tip widths)
        const TIP_WIDE = strokeW * 1.25;
        const TIP_NARROW = strokeW * 0.625;

        const startX = childCx;
        const startY = childCy;
        const endX = parentCx;
        const endY = parentCy;

        // Curved ribbon: bend toward normal at mid-point
        const curviness = dist * 0.15;
        const ctrlX = (startX + endX) * 0.5 + nx * curviness;
        const ctrlY = (startY + endY) * 0.5 + ny * curviness;

        const p1x = startX + nx * TIP_WIDE * 0.5;
        const p1y = startY + ny * TIP_WIDE * 0.5;
        const p2x = endX + nx * TIP_NARROW * 0.5;
        const p2y = endY + ny * TIP_NARROW * 0.5;
        const p3x = endX - nx * TIP_NARROW * 0.5;
        const p3y = endY - ny * TIP_NARROW * 0.5;
        const p4x = startX - nx * TIP_WIDE * 0.5;
        const p4y = startY - ny * TIP_WIDE * 0.5;

        ctx.fillStyle = childBubble.fill;
        ctx.beginPath();
        ctx.moveTo(p1x, p1y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, p2x, p2y);
        ctx.lineTo(p3x, p3y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, p4x, p4y);
        ctx.closePath();
        ctx.fill();
      }

      // Fill parent tips after ellipses so they sit on top
      for (const bubble of bubbles) {
        const hasChild = bubbles.some((b) => b.linkedToId === bubble.id);
        if (!hasChild) continue;

        const cx = (bubble.geometry.x + bubble.geometry.width / 2) * width;
        const cy = (bubble.geometry.y + bubble.geometry.height / 2) * height;
        // Use full radius for tips so they are not pulled inward
        const rx = (bubble.geometry.width / 2) * width;
        const ry = (bubble.geometry.height / 2) * height;
        const rMin = Math.min(rx, ry);

        const tailAngle = (bubble.tailAngle ?? 240) * (Math.PI / 180);
        const spread = 12 * (Math.PI / 180);
        const angle1 = tailAngle - spread;
        const angle2 = tailAngle + spread;

        const base1X = cx + rx * Math.cos(angle1);
        const base1Y = cy + ry * Math.sin(angle1);
        const base2X = cx + rx * Math.cos(angle2);
        const base2Y = cy + ry * Math.sin(angle2);
        const strokeW = (bubble.strokeWidth ?? 2) * exportScaleX;
        const tailLen = rMin * (bubble.tailLength ?? 0.3) + strokeW * 2;
        const tipX = cx + (rMin + tailLen) * Math.cos(tailAngle);
        const tipY = cy + (rMin + tailLen) * Math.sin(tailAngle);

        ctx.fillStyle = bubble.fill;
        ctx.beginPath();
        ctx.moveTo(base1X, base1Y);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(base2X, base2Y);
        ctx.closePath();
        ctx.fill();
      }

      // Fill linked bubble ellipses
      for (const bubble of bubbles) {
        if (!linkedBubbleIds.has(bubble.id)) continue;
        const cx = (bubble.geometry.x + bubble.geometry.width / 2) * width;
        const cy = (bubble.geometry.y + bubble.geometry.height / 2) * height;
        const rx = (bubble.geometry.width / 2) * width * 0.9;
        const ry = (bubble.geometry.height / 2) * height * 0.9;

        ctx.fillStyle = bubble.fill;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw bubble text
      for (const { bubX, bubY, bubW, bubH, bubble } of bubbleTextData) {
        const baseFontSizePx = (bubble.fontSize ?? 0.85) * 16;
        const bubFontSize = baseFontSizePx * bubbleExportScale;
        ctx.font = `${bubFontSize}px ${bubble.fontFamily ?? "Comic Sans MS, cursive"}`;
        ctx.fillStyle = "#000000";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";

        const textPadding = 0.1 * Math.min(bubW, bubH);
        const maxTextW = bubW - textPadding * 2;
        const textAreaTop = bubY + bubH * 0.1;
        const textAreaBottom = bubY + bubH * (0.7 - bubble.tailLength * 0.2);
        const textAreaHeight = textAreaBottom - textAreaTop;

        const bubbleLines: string[] = [];
        const paragraphs = bubble.text.split(/\n/);
        for (const paragraph of paragraphs) {
          if (paragraph.trim() === "") {
            bubbleLines.push("");
            continue;
          }
          const words = paragraph.split(/\s+/);
          let currentLine = "";
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxTextW && currentLine) {
              bubbleLines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) bubbleLines.push(currentLine);
        }

        const bubLineHeight = bubFontSize * 1.2;
        const totalTextHeight = bubbleLines.length * bubLineHeight;
        let bubTextY = textAreaTop + (textAreaHeight - totalTextHeight) / 2 + bubLineHeight / 2;
        
        for (const line of bubbleLines) {
          if (bubTextY > textAreaBottom) break;
          ctx.fillText(line, bubX + bubW / 2, bubTextY);
          bubTextY += bubLineHeight;
        }
      }

      const safeLabel = (page.label || "page").replace(/[^\w.-]+/g, "-");

      // If output folder is configured, save directly to disk via API
      if (settings.assetRoot && settings.assetRoot.trim()) {
        const base64Data = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
        try {
          const result = await exportPageToFolder({
            pageId: page.id,
            imageData: base64Data,
            outputFolder: settings.assetRoot.trim(),
            filename: safeLabel,
            comicName: settings.projectSlug,
            issueName: page.issueLabel,
            geminiKey: settings.geminiKey,
            projectSlug: settings.projectSlug,
          });
          setStatus("saved");
          // Briefly show success, then reset
          setTimeout(() => setStatus("ready"), 2000);
          console.log(`Exported to: ${result.path}`);
        } catch (exportError) {
          setError(exportError instanceof Error ? exportError.message : "Failed to export page");
          setStatus("error");
        }
        return;
      }

      // Fallback to browser download if no output folder configured
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), "image/png", 1);
      });
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeLabel}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to export page");
      setStatus("error");
    }
  }, [page, settings.assetRoot, settings.geminiKey, settings.projectSlug]);

  const handleExportPsd = useCallback(async () => {
    if (!page) return;

    // PSD export requires an output folder to be configured
    if (!settings.assetRoot || !settings.assetRoot.trim()) {
      setError("Set an output folder in Settings to export PSD files.");
      return;
    }

    try {
      setStatus("saving");
      
      // Calculate export dimensions (same logic as PNG export)
      const hasNormalizedSize =
        page.width > 0 && page.width <= 1 && page.height > 0 && page.height <= 1;
      const width = Math.round(hasNormalizedSize ? 1988 : page.width || 1988);
      const height = Math.round(hasNormalizedSize ? 3075 : page.height || 3075);

      const result = await exportPageToPsd({
        pageId: page.id,
        outputFolder: settings.assetRoot.trim(),
        filename: page.label || "page",
        width,
        height,
        comicName: settings.projectSlug,
        issueName: page.issueLabel,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });

      setStatus("saved");
      setTimeout(() => setStatus("ready"), 2000);
      console.log(`Exported PSD to: ${result.path} (${result.layerCount} layers)`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to export PSD");
      setStatus("error");
    }
  }, [page, settings.assetRoot, settings.geminiKey, settings.projectSlug]);

  const handleRenderSelectedPanel = useCallback(async (model: PanelRenderModel = "nano-banana") => {
    if (!selectedPanel || !selectedPanel.prompt || selectedPanel.prompt.trim().length === 0) {
      setError("Add a prompt for the selected panel before generating an image.");
      return;
    }

    const renderSize =
      PANEL_RENDER_SIZE_OPTIONS.find((option) => option.id === renderSizeId) ?? PANEL_RENDER_SIZE_OPTIONS[0];

    const referenceAssetIds: UUID[] = [];
    let primaryReferenceAssetId: UUID | undefined;
    const addReferenceAsset = (assetId?: UUID | null) => {
      if (!assetId) {
        return;
      }
      if (!referenceAssetIds.includes(assetId)) {
        referenceAssetIds.push(assetId);
      }
      if (!primaryReferenceAssetId) {
        primaryReferenceAssetId = assetId;
      }
    };

    // Gather character reference images
    characterReferences.forEach((reference) => {
      const character = characters.find((candidate) => candidate.id === reference.characterId);
      if (!character) {
        return;
      }
      const slot = reference.slotId
        ? character.slots?.find((entry) => entry.id === reference.slotId)
        : character.slots?.find((entry) => entry.asset);
      addReferenceAsset(slot?.asset?.id as UUID | undefined);
    });

    // Gather location reference images
    locationReferences.forEach((reference) => {
      const location = locations.find((candidate) => candidate.id === reference.locationId);
      if (!location) {
        return;
      }
      let locationAssetId: UUID | undefined;
      if (reference.spotId === "primary") {
        locationAssetId = location.primaryAssetId as UUID | undefined;
      } else if (reference.spotId) {
        const spot = location.spots.find((candidate) => candidate.id === reference.spotId);
        locationAssetId = spot?.referenceAssetId as UUID | undefined;
      } else {
        locationAssetId =
          (location.primaryAssetId as UUID | undefined) ||
          (location.spots.find((spot) => spot.referenceAssetId)?.referenceAssetId as UUID | undefined);
      }
      addReferenceAsset(locationAssetId);
    });

    // Gather item reference images
    itemReferences.forEach((reference) => {
      const item = items.find((candidate) => candidate.id === reference.itemId);
      if (!item) {
        return;
      }
      const primaryAssetId = item.angleAssets.primary?.id as UUID | undefined;
      const alternateAssetId = item.angleAssets.alternate?.id as UUID | undefined;
      addReferenceAsset(primaryAssetId);
      addReferenceAsset(alternateAssetId);
    });

    // Backwards compatibility: include inline selections if no references were added yet.
    if (!primaryReferenceAssetId) {
      const selectedCharacter =
        characterSelection.characterId &&
        characters.find((candidate) => candidate.id === characterSelection.characterId);
      const selectedSlot =
        selectedCharacter && selectedCharacter.slots
          ? selectedCharacter.slots.find((slot) => slot.id === characterSelection.slotId) ??
            selectedCharacter.slots.find((slot) => slot.asset)
          : undefined;
      if (selectedSlot?.asset?.id) {
        addReferenceAsset(selectedSlot.asset.id as UUID);
      }
    }

    if (!primaryReferenceAssetId && locationSelection.locationId) {
      const selectedLocation = locations.find((candidate) => candidate.id === locationSelection.locationId);
      if (selectedLocation) {
        let locationAssetId: UUID | undefined;
        if (locationSelection.spotId === "primary") {
          locationAssetId = selectedLocation.primaryAssetId as UUID | undefined;
        } else if (locationSelection.spotId) {
          const spot = selectedLocation.spots.find((candidate) => candidate.id === locationSelection.spotId);
          locationAssetId = spot?.referenceAssetId as UUID | undefined;
        } else {
          locationAssetId =
            (selectedLocation.primaryAssetId as UUID | undefined) ||
            (selectedLocation.spots.find((spot) => spot.referenceAssetId)?.referenceAssetId as UUID | undefined);
        }
        addReferenceAsset(locationAssetId);
      }
    }

    const effectiveReferenceAssetId = primaryReferenceAssetId ?? referenceAssetIds[0];

    setRenderModelInFlight(model);
    setPanelActionInFlight("render");
    setStatus("generating");
    setError(null);

    try {
      const result = await renderPanelImage({
        panelId: selectedPanel.id,
        prompt: selectedPanel.prompt,
        referenceAssetId: effectiveReferenceAssetId,
        referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
        outputDimensions: {
          width: renderSize.width,
          height: renderSize.height,
        },
        model,
        geminiKey: settings.geminiKey,
        projectSlug: settings.projectSlug,
      });
      setPage(result.page);
      // Reset history index to show the new render (latest)
      setPanelHistoryIndex((previous) => {
        const updated = { ...previous };
        delete updated[selectedPanel.id];
        return updated;
      });
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to generate panel image");
      setStatus("error");
    } finally {
      setRenderModelInFlight(null);
      setPanelActionInFlight(null);
    }
  }, [
    characterReferences,
    characterSelection,
    characters,
    itemReferences,
    items,
    locationReferences,
    locationSelection,
    locations,
    renderSizeId,
    selectedPanel,
    settings.geminiKey,
    settings.projectSlug,
    setRenderModelInFlight,
    setPanelActionInFlight,
  ]);

  const handleEditSelectedPanel = useCallback(
    async (model: PanelRenderModel = "nano-banana") => {
      if (!selectedPanel || !selectedPanel.prompt || selectedPanel.prompt.trim().length === 0) {
        setError("Add a prompt for the selected panel before editing an image.");
        return;
      }

      const activeAssetId = getPanelDisplayAssetId(selectedPanel);
      if (!activeAssetId) {
        setError("Render or upload a panel image before editing it.");
        return;
      }

      setRenderModelInFlight(model);
      setPanelActionInFlight("edit");
      setStatus("generating");
      setError(null);

      try {
        const result = await editPanelImage({
          panelId: selectedPanel.id,
          prompt: selectedPanel.prompt,
          assetId: activeAssetId,
          model,
          geminiKey: settings.geminiKey,
          projectSlug: settings.projectSlug,
        });
        setPage(result.page);
        setPanelHistoryIndex((previous) => {
          const updated = { ...previous };
          delete updated[selectedPanel.id];
          return updated;
        });
        setStatus("saved");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to edit panel image");
        setStatus("error");
      } finally {
        setRenderModelInFlight(null);
        setPanelActionInFlight(null);
      }
    },
    [
      getPanelDisplayAssetId,
      selectedPanel,
      settings.geminiKey,
      settings.projectSlug,
      setRenderModelInFlight,
      setPanelActionInFlight,
    ],
  );

  const handleStrokeWidthChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selectedPanel) return;
      const value = parseFloat(event.target.value);
      updatePanel(selectedPanel.id, { strokeWidth: Number.isNaN(value) ? 0 : value });
    },
    [selectedPanel, updatePanel],
  );

  const handleStrokeColorChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selectedPanel) return;
      updatePanel(selectedPanel.id, { strokeColor: event.target.value });
    },
    [selectedPanel, updatePanel],
  );

  const handleShadowBlurChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selectedPanel) return;
      const value = parseFloat(event.target.value);
      const clamped = Number.isFinite(value) ? clampFraction(value, 0, 200) : 0;
      updatePanel(selectedPanel.id, { shadowBlur: clamped });
    },
    [selectedPanel, updatePanel],
  );

  const handleShadowColorChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selectedPanel) return;
      updatePanel(selectedPanel.id, { shadowColor: event.target.value });
    },
    [selectedPanel, updatePanel],
  );

  const handleRotationChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selectedPanel) return;
      const parsed = parseFloat(event.target.value);
      const clamped = Number.isFinite(parsed) ? Math.min(180, Math.max(-180, parsed)) : 0;
      updatePanel(selectedPanel.id, { rotation: clamped });
    },
    [selectedPanel, updatePanel],
  );

  // Corner offset change - simple and intuitive
  // Values are stored as fractions of panel size, displayed as pixels
  // The panel bounding box does NOT change - only the corner positions within it
  // This means you can freely drag any corner without the numbers jumping around
  const handleCornerOffsetChange = useCallback(
    (
      corner: "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
      axis: "x" | "y",
      valuePx: number, // pixels relative to current panel size
    ) => {
      if (!selectedPanel || !page) return;
      if (!Number.isFinite(valuePx)) return;

      const geometry = selectedPanel.geometry;
      const panelWidthPx = page.width * geometry.width;
      const panelHeightPx = page.height * geometry.height;
      
      const dimension = axis === "x" ? panelWidthPx : panelHeightPx;
      if (!Number.isFinite(dimension) || dimension <= 0) return;

      // Convert pixels to fraction of panel size
      const normalizedDelta = valuePx / dimension;

      const currentOffsets = geometry.cornerOffsets ?? {};
      const currentCorner = currentOffsets[corner] ?? { x: 0, y: 0 };
      const nextCorner = { ...currentCorner, [axis]: normalizedDelta };

      // Store the offset directly without renormalization
      const nextOffsets: NonNullable<PanelGeometry["cornerOffsets"]> = { ...currentOffsets };
      
      if (Math.abs(nextCorner.x) < 0.0001 && Math.abs(nextCorner.y) < 0.0001) {
        delete nextOffsets[corner];
      } else {
        nextOffsets[corner] = nextCorner;
      }

      // Keep cornerOffsets as an empty object (not undefined) to preserve free mode
      // User must explicitly use "Reset to Rectangle" or uncheck the checkbox to exit free mode
      updateGeometry(selectedPanel.id, {
        ...geometry,
        cornerOffsets: nextOffsets,
      });
    },
    [page, selectedPanel, updateGeometry],
  );

  // Compute expanded geometry and clip path for a panel with corner offsets
  // Returns { geometry, clipPoints } where geometry may be expanded to fit all corners
  const computePanelGeometry = (panel: StoryboardPanel) => {
    const offsets = panel.geometry.cornerOffsets;
    
    if (!offsets) {
      return {
        geometry: panel.geometry,
        clipPoints: null,
      };
    }

    // Corner offsets are stored as fractions of panel size
    const tlOff = offsets.topLeft ?? { x: 0, y: 0 };
    const trOff = offsets.topRight ?? { x: 0, y: 0 };
    const brOff = offsets.bottomRight ?? { x: 0, y: 0 };
    const blOff = offsets.bottomLeft ?? { x: 0, y: 0 };

    // Calculate corner positions in local 0-1 space (relative to original panel)
    const corners = {
      tl: { x: 0 + tlOff.x, y: 0 + tlOff.y },
      tr: { x: 1 + trOff.x, y: 0 + trOff.y },
      br: { x: 1 + brOff.x, y: 1 + brOff.y },
      bl: { x: 0 + blOff.x, y: 1 + blOff.y },
    };

    // Find bounding box of all corners
    const minX = Math.min(corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x);
    const maxX = Math.max(corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x);
    const minY = Math.min(corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y);
    const maxY = Math.max(corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y);

    const scaleX = maxX - minX;
    const scaleY = maxY - minY;

    if (scaleX <= 0 || scaleY <= 0) {
      return { geometry: panel.geometry, clipPoints: null };
    }

    // Expand geometry to fit all corners
    const expandedGeometry: PanelGeometry = {
      ...panel.geometry,
      x: panel.geometry.x + panel.geometry.width * minX,
      y: panel.geometry.y + panel.geometry.height * minY,
      width: panel.geometry.width * scaleX,
      height: panel.geometry.height * scaleY,
    };

    // Convert corner positions to percentages within the expanded bounding box
    const clipPoints = {
      tl: { x: ((corners.tl.x - minX) / scaleX) * 100, y: ((corners.tl.y - minY) / scaleY) * 100 },
      tr: { x: ((corners.tr.x - minX) / scaleX) * 100, y: ((corners.tr.y - minY) / scaleY) * 100 },
      br: { x: ((corners.br.x - minX) / scaleX) * 100, y: ((corners.br.y - minY) / scaleY) * 100 },
      bl: { x: ((corners.bl.x - minX) / scaleX) * 100, y: ((corners.bl.y - minY) / scaleY) * 100 },
    };

    return { geometry: expandedGeometry, clipPoints };
  };

  const renderPanelStyle = (panel: StoryboardPanel) => {
    const { geometry, clipPoints } = computePanelGeometry(panel);

    const style: React.CSSProperties = {
      left: `${geometry.x * 100}%`,
      top: `${geometry.y * 100}%`,
      width: `${geometry.width * 100}%`,
      height: `${geometry.height * 100}%`,
    };

    const shadowBlur = panel.shadowBlur ?? 0;
    const shadowColor = panel.shadowColor ?? "rgba(0, 0, 0, 0.35)";

    if (clipPoints) {
      style.clipPath = `polygon(${clipPoints.tl.x}% ${clipPoints.tl.y}%, ${clipPoints.tr.x}% ${clipPoints.tr.y}%, ${clipPoints.br.x}% ${clipPoints.br.y}%, ${clipPoints.bl.x}% ${clipPoints.bl.y}%)`;
    } else if (panel.strokeWidth) {
       // Scale border width to match how it will appear in the export
       const exportWidth = page?.width || 1988;
       const strokeScale = canvasDisplayWidth > 0 ? canvasDisplayWidth / exportWidth : 1;
       const scaledStrokeWidth = panel.strokeWidth * strokeScale;
       style.borderWidth = `${scaledStrokeWidth}px`;
       style.borderColor = panel.strokeColor;
       style.borderStyle = "solid";
    }

    if (shadowBlur > 0) {
      style.filter = `drop-shadow(0 0 ${shadowBlur}px ${shadowColor})`;
    }

    return style;
  };

  const isFreeMode = Boolean(selectedPanel?.geometry.cornerOffsets);

  // allPages combines ALL project pages (from all issues) with the current page for the library
  const allPages = useMemo(() => {
    const map = new Map<UUID, StoryboardPage>();
    // Use allProjectPages (all issues) for the library, not pages (which is filtered by issue)
    allProjectPages.forEach((candidate) => map.set(candidate.id, candidate));
    // Also include the current page in case it has unsaved changes
    if (page) {
      map.set(page.id, page);
    }
    return Array.from(map.values()).sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  }, [page, allProjectPages]);

  const pageLookup = useMemo(() => new Map(allPages.map((candidate) => [candidate.id, candidate])), [allPages]);

  const projectLibraryPanels = useMemo(() => {
    type ProjectLibraryEntry = {
      panel: StoryboardPanel;
      pageId: UUID;
      pageLabel: string;
      pageOrder: number;
      panelOrder: number;
      updatedAt?: string;
    };

    const entries = new Map<UUID, ProjectLibraryEntry>();

    const registerPage = (candidate: StoryboardPage | null | undefined, indexFallback: number) => {
      if (!candidate) return;
      const panelList = candidate.panels ?? [];
      panelList.forEach((panel, panelIndex) => {
        if (!panel.renderAssetId) return;
        entries.set(panel.id, {
          panel,
          pageId: candidate.id,
          pageLabel: candidate.label || `Page ${indexFallback + 1}`,
          pageOrder: indexFallback,
          panelOrder: panel.order ?? panelIndex,
          updatedAt: panel.updatedAt ?? candidate.updatedAt ?? undefined,
        });
      });
    };

    allPages.forEach((candidate, index) => registerPage(candidate, index));

    const parseTimestamp = (value?: string) => {
      if (!value) return 0;
      const timestamp = Date.parse(value);
      return Number.isNaN(timestamp) ? 0 : timestamp;
    };

    return Array.from(entries.values()).sort((a, b) => {
      const timeDelta = parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt);
      if (timeDelta !== 0) {
        return timeDelta;
      }
      if (a.pageOrder !== b.pageOrder) {
        return a.pageOrder - b.pageOrder;
      }
      return a.panelOrder - b.panelOrder;
    });
  }, [allPages]);

  // Collect replaced/unused images from all panels
  const replacedImages = useMemo(() => {
    type ReplacedImageEntry = {
      assetId: UUID;
      panelId: UUID;
      panelLabel: string;
      pageLabel: string;
    };

    const entries: ReplacedImageEntry[] = [];

    allPages.forEach((pageItem) => {
      const pageLabel = pageItem.label || "Page";
      (pageItem.panels ?? []).forEach((panel) => {
        const replaced = panel.replacedAssetIds ?? [];
        replaced.forEach((assetId) => {
          entries.push({
            assetId,
            panelId: panel.id,
            panelLabel: panel.label || `Panel ${(panel.order ?? 0) + 1}`,
            pageLabel,
          });
        });
      });
    });

    return entries;
  }, [allPages]);

  const handleProjectLibraryTargetChange = useCallback(
    (panelId: UUID, updates: { pageId?: UUID | ""; panelId?: UUID | "" }) => {
      setProjectLibraryTargets((previous) => {
        const current = previous[panelId] ?? { pageId: "", panelId: "" };
        const next = {
          pageId: updates.pageId !== undefined ? updates.pageId : current.pageId,
          panelId: updates.panelId !== undefined ? updates.panelId : current.panelId,
        };
        return {
          ...previous,
          [panelId]: next,
        };
      });
    },
    [],
  );

  return (
    <div className="pane pane-storyboard">
      <div className="pane-header">
        <h2>
          Storyboard Planner
          {settings.selectedIssue && (
            <span className="issue-badge">{settings.selectedIssue}</span>
          )}
        </h2>
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
            Panel Edit
          </button>
          <button
            type="button"
            className={subTab === "project-library" ? "subtab is-active" : "subtab"}
            onClick={() => setSubTab("project-library")}
          >
            Library
          </button>
        </div>
      </div>
      {!settings.selectedIssue && (
        <p className="helper-text" style={{ color: "rgba(255, 180, 100, 0.85)" }}>
          💡 Select an issue from the header to view its storyboard. Each issue has its own set of pages.
        </p>
      )}
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
                <div className="layout-page-meta">
                  <label htmlFor="storyboard-page-picker">Page</label>
                  <select
                    id="storyboard-page-picker"
                    value={page?.id ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value) {
                        void handleSelectPage(value as UUID);
                      }
                    }}
                    disabled={!page || status === "loading"}
                  >
                    {pages
                      .slice()
                      .sort((a, b) => a.label.localeCompare(b.label))
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                  </select>
                </div>
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
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void handleExportPsd()}
                  disabled={!page || status === "loading" || status === "saving" || status === "generating" || !settings.assetRoot}
                  title={settings.assetRoot ? "Export as layered PSD" : "Set output folder in Settings first"}
                >
                  Export PSD
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
                className="ghost"
                onClick={handleCreateCaptionBox}
                disabled={status === "loading" || status === "saving" || status === "generating" || !page}
              >
                Add Caption
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => handleCreateBubble("speech")}
                disabled={status === "loading" || status === "saving" || status === "generating" || !page}
              >
                Speech Bubble
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => handleCreateBubble("thought")}
                disabled={status === "loading" || status === "saving" || status === "generating" || !page}
              >
                Thought Bubble
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void handleCreatePage()}
                disabled={status === "saving" || status === "generating"}
              >
                New Page
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void handleDeletePage()}
                disabled={!page || pages.length <= 1 || status === "saving" || status === "generating"}
                title={pages.length <= 1 ? "Cannot delete the last page" : "Delete this page"}
              >
                Delete Page
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleSave}
                disabled={!page || (!hasChanges && status !== "saving") || status === "generating"}
              >
                {status === "saving" ? "Saving..." : hasChanges ? "Save Now" : "Saved"}
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
              page.panels.map((panel) => {
                const style = renderPanelStyle(panel);
                const offsets = panel.geometry.cornerOffsets;

                return (
                <div
                  key={panel.id}
                  className={selectedPanelId === panel.id ? "storyboard-panel is-selected" : "storyboard-panel"}
                  style={style}
                  onPointerDown={editingPanelId === panel.id ? undefined : beginMove(panel.id)}
                  onDoubleClick={() => {
                    setEditingPanelId(panel.id);
                    setSelectedPanelId(panel.id);
                  }}
                >
                  {(() => {
                    // For selected panel, use history-aware display; for others use current render
                    const displayAssetId = selectedPanelId === panel.id
                      ? getPanelDisplayAssetId(panel)
                      : panel.renderAssetId;
                    return displayAssetId ? (
                      <img
                        src={assetHref(displayAssetId)}
                        alt={panel.label || "Panel render"}
                        className="storyboard-panel-image"
                        style={{
                          transform: `translate(${(panel.renderOffsetX ?? 0) * 100}%, ${(panel.renderOffsetY ?? 0) * 100}%) scale(${panel.renderScale ?? 1}) rotate(${panel.rotation ?? 0}deg)`,
                          transformOrigin: "50% 50%",
                          pointerEvents: editingPanelId === panel.id ? "auto" : "none",
                          cursor: editingPanelId === panel.id ? "grab" : "default",
                        }}
                        onPointerDown={editingPanelId === panel.id ? beginImagePan(panel.id) : undefined}
                      />
                    ) : null;
                  })()}
                  
                  {(() => {
                    const { clipPoints: cp } = computePanelGeometry(panel);
                    if (!cp || !panel.strokeWidth || panel.strokeWidth <= 0) return null;
                    // Scale stroke width to match how it will appear in the export.
                    // Export uses page.width (or 1988) pixels, so we scale proportionally.
                    const exportWidth = page?.width || 1988;
                    const strokeScale = canvasDisplayWidth > 0 ? canvasDisplayWidth / exportWidth : 1;
                    const scaledStrokeWidth = panel.strokeWidth * strokeScale;
                    return (
                      <svg 
                        className="panel-stroke-overlay" 
                        viewBox="0 0 100 100" 
                        preserveAspectRatio="none"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          pointerEvents: "none",
                          overflow: "visible"
                        }}
                      >
                        <polygon
                          points={`${cp.tl.x},${cp.tl.y} ${cp.tr.x},${cp.tr.y} ${cp.br.x},${cp.br.y} ${cp.bl.x},${cp.bl.y}`}
                          fill="none"
                          stroke={panel.strokeColor ?? "#000000"}
                          vectorEffect="non-scaling-stroke"
                          strokeWidth={scaledStrokeWidth}
                        />
                      </svg>
                    );
                  })()}

                  <span className="panel-label">{panel.label || "Untitled panel"}</span>
                  <span className="panel-order">#{panel.order + 1}</span>
                  <div className="panel-handle handle-nw" onPointerDown={beginResize(panel.id, "nw")} aria-hidden />
                  <div className="panel-handle handle-ne" onPointerDown={beginResize(panel.id, "ne")} aria-hidden />
                  <div className="panel-handle handle-sw" onPointerDown={beginResize(panel.id, "sw")} aria-hidden />
                  <div className="panel-handle handle-se" onPointerDown={beginResize(panel.id, "se")} aria-hidden />
                </div>
              );})
            }
            {/* Floating zoom controls - rendered outside panel to avoid overflow:hidden clipping */}
            {editingPanelId && page && (() => {
              const editingPanel = page.panels.find(p => p.id === editingPanelId);
              if (!editingPanel) return null;
              const { geometry } = computePanelGeometry(editingPanel);
              // Position controls above panel if in lower half of canvas, otherwise below
              const isLowerHalf = geometry.y + geometry.height > 0.65;
              return (
                <div
                  className={`panel-zoom-controls ${isLowerHalf ? 'above' : ''}`}
                  style={{
                    left: `${(geometry.x + geometry.width / 2) * 100}%`,
                    top: isLowerHalf
                      ? `${geometry.y * 100}%`
                      : `${(geometry.y + geometry.height) * 100}%`,
                  }}
                >
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
                      movePanelLayer(editingPanelId, "down");
                    }}
                    title="Send panel backward"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      movePanelLayer(editingPanelId, "up");
                    }}
                    title="Bring panel forward"
                  >
                    ↑
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
                      handleResetCrop();
                    }}
                  >
                    Reset
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
              );
            })()}
            {/* Caption boxes */}
            {page &&
              status !== "loading" &&
              (page.captionBoxes ?? []).map((caption) => (
                <div
                  key={caption.id}
                  className={`storyboard-caption ${selectedCaptionId === caption.id ? "is-selected" : ""}`}
                  style={{
                    position: "absolute",
                    left: `${caption.geometry.x * 100}%`,
                    top: `${caption.geometry.y * 100}%`,
                    width: `${caption.geometry.width * 100}%`,
                    height: `${caption.geometry.height * 100}%`,
                    zIndex: caption.order + 100,
                    cursor: "move",
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedCaptionId(caption.id);
                    setSelectedPanelId(null);
                    // Start drag
                    interactionRef.current = {
                      panelId: caption.id,
                      mode: "move",
                      origin: caption.geometry,
                      pointerStartX: e.clientX,
                      pointerStartY: e.clientY,
                      isCaptionBox: true,
                    };
                  }}
                  onDoubleClick={() => {
                    // Regenerate edges
                    updateCaptionBox(caption.id, { seed: Math.floor(Math.random() * 10000) });
                  }}
                >
                  <CaptionBox
                    fill={caption.fill}
                    stroke={caption.stroke}
                    strokeWidth={caption.strokeWidth}
                    shadowOffset={caption.shadowOffset}
                    shadowColor={caption.shadowColor}
                    roughness={caption.roughness}
                    seed={caption.seed}
                    fontFamily={caption.fontFamily}
                    fontSize={caption.fontSize}
                    minWidth={30}
                    minHeight={20}
                  >
                    <span style={{ whiteSpace: "pre-wrap" }}>{caption.text}</span>
                  </CaptionBox>
                  {selectedCaptionId === caption.id && (
                    <>
                      <div className="panel-handle handle-nw" onPointerDown={(e) => {
                        e.stopPropagation();
                        interactionRef.current = {
                          panelId: caption.id,
                          mode: "resize",
                          origin: caption.geometry,
                          pointerStartX: e.clientX,
                          pointerStartY: e.clientY,
                          corner: "nw",
                          isCaptionBox: true,
                        };
                      }} aria-hidden />
                      <div className="panel-handle handle-ne" onPointerDown={(e) => {
                        e.stopPropagation();
                        interactionRef.current = {
                          panelId: caption.id,
                          mode: "resize",
                          origin: caption.geometry,
                          pointerStartX: e.clientX,
                          pointerStartY: e.clientY,
                          corner: "ne",
                          isCaptionBox: true,
                        };
                      }} aria-hidden />
                      <div className="panel-handle handle-sw" onPointerDown={(e) => {
                        e.stopPropagation();
                        interactionRef.current = {
                          panelId: caption.id,
                          mode: "resize",
                          origin: caption.geometry,
                          pointerStartX: e.clientX,
                          pointerStartY: e.clientY,
                          corner: "sw",
                          isCaptionBox: true,
                        };
                      }} aria-hidden />
                      <div className="panel-handle handle-se" onPointerDown={(e) => {
                        e.stopPropagation();
                        interactionRef.current = {
                          panelId: caption.id,
                          mode: "resize",
                          origin: caption.geometry,
                          pointerStartX: e.clientX,
                          pointerStartY: e.clientY,
                          corner: "se",
                          isCaptionBox: true,
                        };
                      }} aria-hidden />
                    </>
                  )}
                </div>
              ))}
            {/* Linked bubble connectors - BubbleBoy pattern: outline layer (strokes), fill layer (no strokes) */}
            {page && status !== "loading" && (() => {
              const linked = (page.bubbles ?? []).filter((b) => b.linkedToId);
              if (linked.length === 0) return null;

              const linkedIds = new Set<string>();
              const parentIds = new Set<string>();
              linked.forEach((b) => {
                linkedIds.add(b.id);
                if (b.linkedToId) {
                  linkedIds.add(b.linkedToId);
                  parentIds.add(b.linkedToId);
                }
              });

              const tails: Array<{ d: string; stroke: string; strokeWidth: number; fill: string; key: string }> = [];
              const parentTips: Array<{ d: string; stroke: string; strokeWidth: number; fill: string; key: string }> = [];
              const ellipses: Array<{ cx: number; cy: number; rx: number; ry: number; fill: string; stroke: string; strokeWidth: number; key: string }> = [];

              // Build tails (connector quads) in viewBox 100 space
              for (const child of linked) {
                const parent = (page.bubbles ?? []).find((b) => b.id === child.linkedToId);
                if (!parent) continue;

                const childCx = (child.geometry.x + child.geometry.width / 2) * 100;
                const childCy = (child.geometry.y + child.geometry.height / 2) * 100;
                const parentCx = (parent.geometry.x + parent.geometry.width / 2) * 100;
                const parentCy = (parent.geometry.y + parent.geometry.height / 2) * 100;

                const childRx = (child.geometry.width / 2) * 100;
                const childRy = (child.geometry.height / 2) * 100;
                const parentRx = (parent.geometry.width / 2) * 100;
                const parentRy = (parent.geometry.height / 2) * 100;

                const dx = parentCx - childCx;
                const dy = parentCy - childCy;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const dirX = dx / dist;
                const dirY = dy / dist;
                const nx = -dirY;
                const ny = dirX;

        const strokeW = child.strokeWidth ?? 2;
        // 75% slimmer connector (25% of original tip widths)
        const TIP_WIDE = strokeW * 1.25;
        const TIP_NARROW = strokeW * 0.625;

                // Move endpoints to CENTER of bubbles to completely hide seams
                const startX = childCx;
                const startY = childCy;
                const endX = parentCx;
                const endY = parentCy;

        // Curved ribbon: bend toward normal at mid-point
        const curviness = dist * 0.15;
        const ctrlX = (startX + endX) * 0.5 + nx * curviness;
        const ctrlY = (startY + endY) * 0.5 + ny * curviness;

        const p1x = startX + nx * TIP_WIDE * 0.5;
        const p1y = startY + ny * TIP_WIDE * 0.5;
        const p2x = endX + nx * TIP_NARROW * 0.5;
        const p2y = endY + ny * TIP_NARROW * 0.5;
        const p3x = endX - nx * TIP_NARROW * 0.5;
        const p3y = endY - ny * TIP_NARROW * 0.5;
        const p4x = startX - nx * TIP_WIDE * 0.5;
        const p4y = startY - ny * TIP_WIDE * 0.5;

        const d = `M ${p1x} ${p1y} Q ${ctrlX} ${ctrlY} ${p2x} ${p2y} L ${p3x} ${p3y} Q ${ctrlX} ${ctrlY} ${p4x} ${p4y} Z`;
                tails.push({ d, stroke: child.stroke, strokeWidth: strokeW, fill: child.fill, key: `tail-${child.id}` });
              }

              // Parent tips (keep speaker pointer on parent bubbles)
              (page.bubbles ?? [])
                .filter((b) => parentIds.has(b.id))
                .forEach((b) => {
                  // Only draw tip on true parent (has child but no parent)
                  if (b.linkedToId) return;
                  const cx = (b.geometry.x + b.geometry.width / 2) * 100;
                  const cy = (b.geometry.y + b.geometry.height / 2) * 100;
                  // Match ellipse inset so base meets bubble edge cleanly
                  const rx = (b.geometry.width / 2) * 100 * 0.9;
                  const ry = (b.geometry.height / 2) * 100 * 0.9;
                  const rMin = Math.min(rx, ry);

                  const tailAngle = (b.tailAngle ?? 240) * (Math.PI / 180);
                  const spread = 12 * (Math.PI / 180);
                  const angle1 = tailAngle - spread;
                  const angle2 = tailAngle + spread;

                  const base1X = cx + rx * Math.cos(angle1);
                  const base1Y = cy + ry * Math.sin(angle1);
                  const base2X = cx + rx * Math.cos(angle2);
                  const base2Y = cy + ry * Math.sin(angle2);
                  const strokeW = b.strokeWidth ?? 2;
                  const tailLen = rMin * Math.max(0.05, b.tailLength ?? 0.3) + strokeW * 0.5;
                  const tipX = cx + (rMin + tailLen) * Math.cos(tailAngle);
                  const tipY = cy + (rMin + tailLen) * Math.sin(tailAngle);

                  const d = `M ${base1X} ${base1Y} L ${tipX} ${tipY} L ${base2X} ${base2Y} Z`;
                  parentTips.push({
                    d,
                    stroke: b.stroke,
                    strokeWidth: strokeW,
                    fill: b.fill,
                    key: `ptip-${b.id}`,
                  });
                });

              // Bubble ellipses for linked bubbles (slightly inset to sit under outline)
              (page.bubbles ?? [])
                .filter((b) => linkedIds.has(b.id))
                .forEach((b) => {
                  ellipses.push({
                    key: `ellipse-${b.id}`,
                    cx: (b.geometry.x + b.geometry.width / 2) * 100,
                    cy: (b.geometry.y + b.geometry.height / 2) * 100,
                    rx: (b.geometry.width / 2) * 100 * 0.9,
                    ry: (b.geometry.height / 2) * 100 * 0.9,
                    fill: b.fill,
                    stroke: b.stroke,
                    strokeWidth: b.strokeWidth ?? 2,
                  });
                });

              // Stroke settings: take from first tail or default
              const strokeColor = tails[0]?.stroke ?? "#000000";
              const strokeWidth = tails[0]?.strokeWidth ?? 2;

              return (
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    // Place overlay beneath bubble content/text so text stays visible
                    zIndex: 120,
                    overflow: "visible",
                  }}
                >
                  {/* Outline layer */}
                  <g stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" fill="none">
                    {tails.map((t) => (
                      <path key={`ol-${t.key}`} d={t.d} vectorEffect="non-scaling-stroke" />
                    ))}
                    {ellipses.map((b) => (
                      <ellipse key={`ol-${b.key}`} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} vectorEffect="non-scaling-stroke" />
                    ))}
                    {parentTips.map((t) => (
                      <path key={`ol-${t.key}`} d={t.d} vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>

                  {/* Fill layer */}
                  {tails.map((t) => (
                    <path key={`fill-${t.key}`} d={t.d} fill={t.fill} stroke="none" />
                  ))}
                  {ellipses.map((b) => (
                    <ellipse key={`fill-${b.key}`} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill={b.fill} stroke="none" />
                  ))}
                  {parentTips.map((t) => (
                    <path key={`fill-${t.key}`} d={t.d} fill={t.fill} stroke="none" />
                  ))}
                </svg>
              );
            })()}

            {/* Speech and thought bubbles */}
            {page &&
              status !== "loading" &&
              (() => {
                // Compute which bubbles are involved in linked relationships
                const linkedBubbleIds = new Set<string>();
                (page.bubbles ?? []).forEach((b) => {
                  if (b.linkedToId) {
                    linkedBubbleIds.add(b.id);
                    linkedBubbleIds.add(b.linkedToId);
                  }
                });
                return (page.bubbles ?? []).map((bubble) => (
                <div
                  key={bubble.id}
                  className={`storyboard-bubble storyboard-bubble-${bubble.type} ${selectedBubbleId === bubble.id ? "is-selected" : ""}`}
                  style={{
                    position: "absolute",
                    left: `${bubble.geometry.x * 100}%`,
                    top: `${bubble.geometry.y * 100}%`,
                    width: `${bubble.geometry.width * 100}%`,
                    height: `${bubble.geometry.height * 100}%`,
                    zIndex: bubble.order + 150,
                    cursor: "move",
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedBubbleId(bubble.id);
                    setSelectedPanelId(null);
                    setSelectedCaptionId(null);
                    interactionRef.current = {
                      panelId: bubble.id,
                      mode: "move",
                      origin: bubble.geometry,
                      pointerStartX: e.clientX,
                      pointerStartY: e.clientY,
                      isBubble: true,
                    };
                  }}
                >
                  <SpeechBubble
                    type={bubble.type}
                    fill={bubble.fill}
                    stroke={bubble.stroke}
                    strokeWidth={bubble.strokeWidth}
                    tailAngle={bubble.tailAngle}
                    tailLength={bubble.tailLength}
                    fontFamily={bubble.fontFamily}
                    fontSize={bubble.fontSize}
                    hideShape={linkedBubbleIds.has(bubble.id)}
                  >
                    <span style={{ whiteSpace: "pre-wrap" }}>{bubble.text}</span>
                  </SpeechBubble>
                  {selectedBubbleId === bubble.id && (
                    <>
                      <div className="panel-handle handle-nw" onPointerDown={(e) => {
                        e.stopPropagation();
                        interactionRef.current = {
                          panelId: bubble.id,
                          mode: "resize",
                          origin: bubble.geometry,
                          pointerStartX: e.clientX,
                          pointerStartY: e.clientY,
                          corner: "nw",
                          isBubble: true,
                        };
                      }} aria-hidden />
                      <div className="panel-handle handle-ne" onPointerDown={(e) => {
                        e.stopPropagation();
                        interactionRef.current = {
                          panelId: bubble.id,
                          mode: "resize",
                          origin: bubble.geometry,
                          pointerStartX: e.clientX,
                          pointerStartY: e.clientY,
                          corner: "ne",
                          isBubble: true,
                        };
                      }} aria-hidden />
                      <div className="panel-handle handle-sw" onPointerDown={(e) => {
                        e.stopPropagation();
                        interactionRef.current = {
                          panelId: bubble.id,
                          mode: "resize",
                          origin: bubble.geometry,
                          pointerStartX: e.clientX,
                          pointerStartY: e.clientY,
                          corner: "sw",
                          isBubble: true,
                        };
                      }} aria-hidden />
                      <div className="panel-handle handle-se" onPointerDown={(e) => {
                        e.stopPropagation();
                        interactionRef.current = {
                          panelId: bubble.id,
                          mode: "resize",
                          origin: bubble.geometry,
                          pointerStartX: e.clientX,
                          pointerStartY: e.clientY,
                          corner: "se",
                          isBubble: true,
                        };
                      }} aria-hidden />
                    </>
                  )}
                </div>
              ));
              })()}

          </div>
        </div>
        <form className="storyboard-form" onSubmit={(event) => event.preventDefault()}>
          <div className="field collapsible">
            <button
              type="button"
              className="collapsible-header"
              onClick={() =>
                setCollapsedSections((previous) => ({ ...previous, references: !previous.references }))
              }
            >
              <span>Prompt Builder & References</span>
              <span aria-hidden="true">{collapsedSections.references ? "▸" : "▾"}</span>
            </button>
            {!collapsedSections.references && (
              <>
                <p className="helper-text">
                  Pick references to seed the panel prompt. Bracketed names like <code>[Rabbit-front]</code> are
                  auto-filled; write your description around them.
                </p>
                <div className="field">
                  <div className="reference-row">
                    <div className="field reference-field">
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
                    <div className="field reference-field">
                      <label htmlFor="storyboard-character-view">Character view</label>
                      <div className="reference-action">
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
                        <button
                          type="button"
                          className="ghost"
                          onClick={handleAddCharacterReference}
                          disabled={!characterSelection.characterId}
                        >
                          Add view
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="helper-text">Add specific character angles to reuse them in prompts.</p>
                  {characterReferences.length > 0 && (
                    <ul className="reference-list">
                      {characterReferences.map((reference) => {
                        const label = resolveCharacterReferenceLabel(reference);
                        return (
                          <li key={reference.id} className="reference-chip">
                            <span>{label}</span>
                            <button
                              type="button"
                              className="reference-remove"
                              onClick={() => handleRemoveCharacterReference(reference.id)}
                              aria-label={`Remove ${label}`}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="field">
                  <div className="reference-row">
                    <div className="field reference-field">
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
                    <div className="field reference-field">
                      <label htmlFor="storyboard-location-view">Location view</label>
                      <div className="reference-action">
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
                        <button
                          type="button"
                          className="ghost"
                          onClick={handleAddLocationReference}
                          disabled={!locationSelection.locationId}
                        >
                          Add view
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="helper-text">Stack multiple environment angles to describe scene changes.</p>
                  {locationReferences.length > 0 && (
                    <ul className="reference-list">
                      {locationReferences.map((reference) => {
                        const label = resolveLocationReferenceLabel(reference);
                        return (
                          <li key={reference.id} className="reference-chip">
                            <span>{label}</span>
                            <button
                              type="button"
                              className="reference-remove"
                              onClick={() => handleRemoveLocationReference(reference.id)}
                              aria-label={`Remove ${label}`}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="storyboard-items">Items</label>
                  <div className="reference-action">
                    <select id="storyboard-items" value={pendingItemId} onChange={handlePendingItemChange}>
                      <option value="">-- Select item --</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ghost"
                      onClick={handleAddItemReference}
                      disabled={!pendingItemId}
                    >
                      Add item
                    </button>
                  </div>
                  {itemReferences.length > 0 && (
                    <ul className="reference-list">
                      {itemReferences.map((reference) => {
                        const label = resolveItemReferenceLabel(reference);
                        return (
                          <li key={reference.id} className="reference-chip">
                            <span>{label}</span>
                            <button
                              type="button"
                              className="reference-remove"
                              onClick={() => handleRemoveItemReference(reference.id)}
                              aria-label={`Remove ${label}`}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
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
              </>
            )}
          </div>
          <div className="field collapsible">
            <button
              type="button"
              className="collapsible-header"
              onClick={() => setCollapsedSections((previous) => ({ ...previous, page: !previous.page }))}
            >
              <span>Page settings</span>
              <span aria-hidden="true">{collapsedSections.page ? "▸" : "▾"}</span>
            </button>
            {!collapsedSections.page && (
              <>
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
                  <label htmlFor="page-issue">Issue</label>
                  <select
                    id="page-issue"
                    value={page?.issueLabel ?? "__unassigned__"}
                    onChange={(event) => {
                      const value = event.target.value;
                      void handlePageIssueChange(value === "__unassigned__" ? null : value);
                    }}
                    disabled={!page || updatingPageIssue}
                  >
                    <option value="__unassigned__">Unassigned</option>
                    {availableIssues.map((issue) => (
                      <option key={issue} value={issue}>
                        {issue}
                      </option>
                    ))}
                  </select>
                  {updatingPageIssue && <span className="helper-text">Updating...</span>}
                </div>
              </>
            )}
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
              <div className="field collapsible">
                <button
                  type="button"
                  className="collapsible-header"
                  onClick={() =>
                    setCollapsedSections((previous) => ({ ...previous, panel: !previous.panel }))
                  }
                >
                  <span>Panel layout & details</span>
                  <span aria-hidden="true">{collapsedSections.panel ? "▸" : "▾"}</span>
                </button>
                {!collapsedSections.panel && (
                  <>
                    <div className="field">
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={isFreeMode}
                          onChange={(e) => {
                            // Toggle free mode: if turning on, init empty offsets. If turning off, clear them.
                            updateGeometry(selectedPanel.id, {
                              ...selectedPanel.geometry,
                              cornerOffsets: e.target.checked ? {} : undefined,
                            });
                          }}
                        />
                        Free Panel Shape
                      </label>
                    </div>
                    
                    {isFreeMode && page && (
                      <div className="free-transform-grid">
                        <p className="free-transform-hint">
                          Offset each corner in pixels. X: + right, − left. Y: + up, − down.
                        </p>
                        {["topLeft", "topRight", "bottomLeft", "bottomRight"].map((cornerKey) => {
                          const corner = cornerKey as keyof NonNullable<PanelGeometry["cornerOffsets"]>;
                          const current = selectedPanel.geometry.cornerOffsets?.[corner] ?? { x: 0, y: 0 };

                          // Show offsets in pixels relative to current panel size
                          // Y is inverted for display: + = up, - = down
                          const panelWidthPx = page.width * selectedPanel.geometry.width;
                          const panelHeightPx = page.height * selectedPanel.geometry.height;
                          const pxX = Math.round(current.x * panelWidthPx);
                          const pxY = Math.round(-current.y * panelHeightPx); // Invert for display

                          return (
                            <div key={corner} className="corner-controls">
                              <strong>{corner.replace(/([A-Z])/g, " $1").trim()}</strong>
                              <div className="field multi compact">
                                <label>
                                  X
                                  <input
                                    type="number"
                                    value={pxX}
                                    onChange={(e) => {
                                      const next = Number(e.target.value);
                                      if (!Number.isFinite(next)) return;
                                      handleCornerOffsetChange(corner, "x", next);
                                    }}
                                  />
                                </label>
                                <label>
                                  Y
                                  <input
                                    type="number"
                                    value={pxY}
                                    onChange={(e) => {
                                      const next = Number(e.target.value);
                                      if (!Number.isFinite(next)) return;
                                      // Invert back when storing: user types +, we store -
                                      handleCornerOffsetChange(corner, "y", -next);
                                    }}
                                  />
                                </label>
                              </div>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          className="ghost"
                          style={{ gridColumn: "1 / -1", marginTop: "0.5rem" }}
                          onClick={() => {
                            if (!selectedPanel) return;
                            updateGeometry(selectedPanel.id, {
                              ...selectedPanel.geometry,
                              cornerOffsets: undefined,
                            });
                          }}
                        >
                          Reset to Rectangle
                        </button>
                      </div>
                    )}

                    {!isFreeMode && (
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
                    </>
                    )}
                    <div className="field multi">
                      <div className="field">
                        <label htmlFor="panel-stroke-width">Stroke width (px)</label>
                        <input
                          id="panel-stroke-width"
                          type="number"
                          min="0"
                          max="100"
                          value={selectedPanel.strokeWidth ?? 0}
                          onChange={handleStrokeWidthChange}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="panel-stroke-color">Stroke color</label>
                        <input
                          id="panel-stroke-color"
                          type="color"
                          value={selectedPanel.strokeColor ?? "#000000"}
                          onChange={handleStrokeColorChange}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="panel-shadow-blur">Drop shadow</label>
                        <input
                          id="panel-shadow-blur"
                          type="range"
                          min="0"
                          max="60"
                          step="1"
                          value={selectedPanel.shadowBlur ?? 0}
                          onChange={handleShadowBlurChange}
                          aria-valuemin={0}
                          aria-valuemax={60}
                          aria-valuenow={selectedPanel.shadowBlur ?? 0}
                        />
                        <input
                          type="color"
                          value={selectedPanel.shadowColor ?? "#000000"}
                          onChange={handleShadowColorChange}
                          aria-label="Shadow color"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="panel-rotation">Rotation</label>
                        <input
                          id="panel-rotation"
                          type="range"
                          min="-180"
                          max="180"
                          step="1"
                          value={selectedPanel.rotation ?? 0}
                          onChange={handleRotationChange}
                          aria-valuemin={-180}
                          aria-valuemax={180}
                          aria-valuenow={selectedPanel.rotation ?? 0}
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
                  </>
                )}
              </div>
              <div className="field collapsible">
                <button
                  type="button"
                  className="collapsible-header"
                  onClick={() =>
                    setCollapsedSections((previous) => ({ ...previous, generation: !previous.generation }))
                  }
                >
                  <span>Prompt & generation</span>
                  <span aria-hidden="true">{collapsedSections.generation ? "▸" : "▾"}</span>
                </button>
                {!collapsedSections.generation && (
                  <>
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
                      <label>Generate panel image</label>
                      <div className="panel-render-controls">
                        <div className="panel-orientation-toggle" role="group" aria-label="Render orientation">
                          <button
                            type="button"
                            className={renderOrientation === "horizontal" ? "is-active" : ""}
                            onClick={() => handleRenderOrientationChange("horizontal")}
                            disabled={renderModelInFlight !== null}
                            aria-pressed={renderOrientation === "horizontal"}
                          >
                            Horizontal
                          </button>
                          <button
                            type="button"
                            className={renderOrientation === "vertical" ? "is-active" : ""}
                            onClick={() => handleRenderOrientationChange("vertical")}
                            disabled={renderModelInFlight !== null}
                            aria-pressed={renderOrientation === "vertical"}
                          >
                            Vertical
                          </button>
                        </div>
                        <div className="panel-render-size-picker">
                          <label htmlFor="panel-render-size">Render size</label>
                          <select
                            id="panel-render-size"
                            value={renderSizeId}
                            onChange={handleRenderSizeChange}
                            disabled={renderModelInFlight !== null}
                          >
                            {renderSizeOptionsForOrientation.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="panel-generation-buttons">
                        <button
                          type="button"
                          className="primary"
                          onClick={() => handleRenderSelectedPanel("nano-banana")}
                          disabled={renderButtonDisabled}
                        >
                          {renderButtonLabel("nano-banana")}
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => handleRenderSelectedPanel("nano-banana-pro")}
                          disabled={renderButtonDisabled}
                        >
                          {renderButtonLabel("nano-banana-pro")}
                        </button>
                      </div>
                      <div className="panel-edit-buttons">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => handleEditSelectedPanel("nano-banana")}
                          disabled={editButtonDisabled}
                        >
                          {editButtonLabel("nano-banana")}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => handleEditSelectedPanel("nano-banana-pro")}
                          disabled={editButtonDisabled}
                        >
                          {editButtonLabel("nano-banana-pro")}
                        </button>
                      </div>
                      <div className="panel-history-buttons">
                        <button
                          type="button"
                          className="secondary"
                          onClick={handlePanelUndo}
                          disabled={!canUndo || status === "generating"}
                          title="Undo - go to previous render"
                        >
                          ← Undo
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={handlePanelRedo}
                          disabled={!canRedo || status === "generating"}
                          title="Redo - go to next render"
                        >
                          Redo →
                        </button>
                      </div>
                      {historyInfo && historyInfo.total > 1 && (
                        <p className="helper-text history-indicator">
                          Viewing render {historyInfo.current} of {historyInfo.total}
                          {!historyInfo.isLatest && " (older version)"}
                        </p>
                      )}
                      <p className="helper-text">Nano Banana is the default; Nano Banana Pro leans into fidelity.</p>
                    </div>
                    {getPanelDisplayAssetId(selectedPanel) && (
                      <div className="field">
                        <label>
                          {historyInfo && !historyInfo.isLatest ? "Previous render" : "Latest render"}
                        </label>
                        <div className="asset-preview">
                          <img
                            src={assetHref(getPanelDisplayAssetId(selectedPanel)!)}
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
                        onClick={duplicateSelectedPanel}
                        disabled={!page || !selectedPanel || status === "saving" || status === "generating"}
                        title="Duplicate this panel"
                      >
                        Duplicate Panel
                      </button>
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
                )}
              </div>
            </>
          ) : (
            <p className="helper-text">Select a panel on the canvas or from the list to edit its metadata.</p>
          )}

          {/* Caption Box Editor */}
          {selectedCaption && (
            <div className="field collapsible caption-editor">
              <button
                type="button"
                className="collapsible-header"
                onClick={() =>
                  setCollapsedSections((previous) => ({ ...previous, caption: !previous.caption }))
                }
              >
                <span>Caption Box</span>
                <span aria-hidden="true">{collapsedSections.caption ? "▸" : "▾"}</span>
              </button>
              {!collapsedSections.caption && (
                <>
                  <div className="field">
                    <label htmlFor="caption-text">Caption text</label>
                    <textarea
                      id="caption-text"
                      rows={3}
                      value={selectedCaption.text}
                      onChange={(e) => updateCaptionBox(selectedCaption.id, { text: e.target.value })}
                      placeholder="Enter caption text..."
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="caption-font">Font</label>
                    <FontSelector
                      id="caption-font"
                      value={selectedCaption.fontFamily ?? "Courier New"}
                      onChange={(font) => updateCaptionBox(selectedCaption.id, { fontFamily: font })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="caption-font-size">Font size (rem)</label>
                    <input
                      id="caption-font-size"
                      type="number"
                      min={0.4}
                      max={2}
                      step={0.1}
                      value={selectedCaption.fontSize ?? 0.7}
                      onChange={(e) => updateCaptionBox(selectedCaption.id, { fontSize: parseFloat(e.target.value) || 0.7 })}
                    />
                  </div>
                  <div className="field multi compact">
                    <div className="field">
                      <label htmlFor="caption-fill">Fill color</label>
                      <input
                        id="caption-fill"
                        type="color"
                        value={selectedCaption.fill}
                        onChange={(e) => updateCaptionBox(selectedCaption.id, { fill: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="caption-stroke">Stroke color</label>
                      <input
                        id="caption-stroke"
                        type="color"
                        value={selectedCaption.stroke}
                        onChange={(e) => updateCaptionBox(selectedCaption.id, { stroke: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="field multi compact">
                    <div className="field">
                      <label htmlFor="caption-shadow">Shadow color</label>
                      <input
                        id="caption-shadow"
                        type="color"
                        value={selectedCaption.shadowColor}
                        onChange={(e) => updateCaptionBox(selectedCaption.id, { shadowColor: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="caption-stroke-width">Stroke width</label>
                      <input
                        id="caption-stroke-width"
                        type="number"
                        min={0}
                        max={10}
                        value={selectedCaption.strokeWidth}
                        onChange={(e) => updateCaptionBox(selectedCaption.id, { strokeWidth: parseFloat(e.target.value) || 2 })}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="caption-roughness">Edge roughness</label>
                    <input
                      id="caption-roughness"
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={selectedCaption.roughness}
                      onChange={(e) => updateCaptionBox(selectedCaption.id, { roughness: parseFloat(e.target.value) })}
                    />
                    <p className="helper-text">Double-click the caption on canvas to regenerate edges.</p>
                  </div>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => updateCaptionBox(selectedCaption.id, { seed: Math.floor(Math.random() * 10000) })}
                    >
                      Regenerate Edges
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleDeleteCaptionBox(selectedCaption.id)}
                    >
                      Delete Caption
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Bubble Editor */}
          {selectedBubble && (
            <div className="field collapsible bubble-editor">
              <button
                type="button"
                className="collapsible-header"
                onClick={() =>
                  setCollapsedSections((previous) => ({ ...previous, bubble: !previous.bubble }))
                }
              >
                <span>{selectedBubble.type === "speech" ? "Speech" : "Thought"} Bubble</span>
                <span aria-hidden="true">{collapsedSections.bubble ? "▸" : "▾"}</span>
              </button>
              {!collapsedSections.bubble && (
                <>
                  <div className="field">
                    <label htmlFor="bubble-text">Bubble text</label>
                    <textarea
                      id="bubble-text"
                      rows={3}
                      value={selectedBubble.text}
                      onChange={(e) => updateBubble(selectedBubble.id, { text: e.target.value })}
                      placeholder="Enter bubble text..."
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="bubble-font">Font</label>
                    <FontSelector
                      id="bubble-font"
                      value={selectedBubble.fontFamily ?? "Comic Sans MS, cursive"}
                      onChange={(font) => updateBubble(selectedBubble.id, { fontFamily: font })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="bubble-font-size">Font size (rem)</label>
                    <input
                      id="bubble-font-size"
                      type="number"
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={selectedBubble.fontSize ?? 0.85}
                      onChange={(e) => updateBubble(selectedBubble.id, { fontSize: parseFloat(e.target.value) || 0.85 })}
                    />
                  </div>
                  <div className="field multi compact">
                    <div className="field">
                      <label htmlFor="bubble-fill">Fill color</label>
                      <input
                        id="bubble-fill"
                        type="color"
                        value={selectedBubble.fill}
                        onChange={(e) => updateBubble(selectedBubble.id, { fill: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="bubble-stroke">Stroke color</label>
                      <input
                        id="bubble-stroke"
                        type="color"
                        value={selectedBubble.stroke}
                        onChange={(e) => updateBubble(selectedBubble.id, { stroke: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="bubble-tail-angle">Tail direction (degrees)</label>
                    <input
                      id="bubble-tail-angle"
                      type="range"
                      min={0}
                      max={360}
                      step={15}
                      value={selectedBubble.tailAngle}
                      onChange={(e) => updateBubble(selectedBubble.id, { tailAngle: parseFloat(e.target.value) })}
                    />
                    <span className="helper-text">{selectedBubble.tailAngle}° (0=right, 90=down, 180=left, 270=up)</span>
                  </div>
                  <div className="field">
                    <label htmlFor="bubble-tail-length">Tail length</label>
                    <input
                      id="bubble-tail-length"
                      type="range"
                      min={0.1}
                      max={0.5}
                      step={0.05}
                      value={selectedBubble.tailLength}
                      onChange={(e) => updateBubble(selectedBubble.id, { tailLength: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={handleCreateLinkedBubble}
                      title="Add a linked bubble for chained dialogue"
                    >
                      + Linked Bubble
                    </button>
                    {selectedBubble.linkedToId && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          updateBubble(selectedBubble.id, { linkedCurveFlip: !selectedBubble.linkedCurveFlip })
                        }
                        title="Flip connector arc direction"
                      >
                        Flip Connector
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleDeleteBubble(selectedBubble.id)}
                    >
                      Delete Bubble
                    </button>
                  </div>
                  {selectedBubble.linkedToId && (
                    <p className="helper-text" style={{ marginTop: "0.5rem", fontSize: "0.75rem", opacity: 0.7 }}>
                      🔗 Linked to another bubble
                    </p>
                  )}
                </>
              )}
            </div>
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
                  {panel.renderAssetId ? "Replace" : "Upload"}
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
      {subTab === "project-library" && (
        <div className="project-library">
          <div className="project-library-header">
            <h3>Project Library</h3>
            <p className="helper-text">
              {projectLibraryPanels.length === 0
                ? "No renders yet. Generate panel images to populate the library."
                : `${projectLibraryPanels.length} render${projectLibraryPanels.length === 1 ? "" : "s"} available.`}
            </p>
          </div>
          {projectLibraryPanels.length === 0 ? (
            <div className="storyboard-empty">Create or render panels to see them here.</div>
          ) : (
            <div className="storyboard-library">
              {projectLibraryPanels.map(({ panel, pageLabel, pageId }) => {
                const storedTarget = projectLibraryTargets[panel.id];
                let selectedPageId: UUID | "" = storedTarget?.pageId ?? pageId;
                if (selectedPageId && !pageLookup.has(selectedPageId)) {
                  selectedPageId = "";
                }
                const selectedPage = selectedPageId ? pageLookup.get(selectedPageId) ?? null : null;
                const panelOptions = selectedPage?.panels ?? [];
                let selectedPanelId: UUID | "" = storedTarget?.panelId ?? panel.id;
                if (selectedPanelId && !panelOptions.some((candidate) => candidate.id === selectedPanelId)) {
                  selectedPanelId = "";
                }
                const canUpload = Boolean(selectedPanelId);
                const uploading = selectedPanelId ? panelLibraryUploading[selectedPanelId] : false;

                return (
                  <div key={panel.id} className="library-card">
                    <div className="library-thumb">
                      {panel.renderAssetId ? (
                        <img src={assetHref(panel.renderAssetId)} alt={panel.label || "Panel render"} />
                      ) : (
                        <div className="library-thumb-empty">Render missing</div>
                      )}
                    </div>
                    <div className="library-meta">
                      <strong>{panel.label || "Untitled panel"}</strong>
                      <span className="helper-text">
                        {pageLabel}
                        {typeof panel.order === "number" ? ` · Panel #${panel.order + 1}` : ""}
                      </span>
                    </div>
                    <div className="library-target-selects">
                      <label>
                        Page
                        <select
                          value={selectedPageId}
                          onChange={(event) => {
                            const value = event.target.value as UUID | "";
                            handleProjectLibraryTargetChange(panel.id, { pageId: value, panelId: "" });
                          }}
                        >
                          <option value="">Select page...</option>
                          {allPages.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.label || "Untitled page"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Panel
                        <select
                          value={selectedPanelId}
                          onChange={(event) =>
                            handleProjectLibraryTargetChange(panel.id, {
                              panelId: (event.target.value as UUID) || "",
                            })
                          }
                          disabled={!selectedPageId}
                        >
                          <option value="">Select panel...</option>
                          {panelOptions.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.label || `Panel ${candidate.order + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="library-actions">
                      {panel.renderAssetId && (
                        <a
                          href={assetHref(panel.renderAssetId)}
                          download={`${pageLabel.replace(/\s+/g, "-").toLowerCase()}-${panel.order ?? 0}.png`}
                          className="ghost"
                        >
                          Download
                        </a>
                      )}
                      <label
                        className={canUpload ? "upload" : "upload is-disabled"}
                        aria-disabled={!canUpload}
                        title={canUpload ? undefined : "Select a destination panel to enable upload"}
                      >
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          disabled={!canUpload || uploading}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (!selectedPanelId) {
                              setError("Choose a page and panel before uploading a replacement image.");
                              event.target.value = "";
                              return;
                            }
                            void handlePanelAssetUpload(selectedPanelId as UUID, file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Replaced/Unused Images Section */}
          {replacedImages.length > 0 && (
            <>
              <div className="project-library-header" style={{ marginTop: "1.5rem" }}>
                <h3>Replaced Images</h3>
                <p className="helper-text">
                  {replacedImages.length} image{replacedImages.length === 1 ? "" : "s"} from previous renders.
                  These were replaced when you generated new images.
                </p>
              </div>
              <div className="storyboard-library">
                {replacedImages.map(({ assetId, panelLabel, pageLabel }) => (
                  <div key={assetId} className="library-card library-card-replaced">
                    <div className="library-thumb">
                      <img src={assetHref(assetId)} alt="Previous render" />
                    </div>
                    <div className="library-meta">
                      <strong>{panelLabel}</strong>
                      <span className="helper-text">{pageLabel} · Replaced</span>
                    </div>
                    <div className="library-actions">
                      <a
                        href={assetHref(assetId)}
                        download={`replaced-${assetId.slice(0, 8)}.png`}
                        className="ghost"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
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
  const [systemPromptDraft, setSystemPromptDraft] = useState("");
  const [systemPromptState, setSystemPromptState] = useState<UploadState>({ status: "idle" });

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

  // Sync system prompt draft with selected project
  useEffect(() => {
    setSystemPromptDraft(selectedProject?.systemPrompt ?? "");
  }, [selectedProject?.id, selectedProject?.systemPrompt]);

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

  const handleSystemPromptSave = async () => {
    if (!selectedProject) return;
    setSystemPromptState({ status: "uploading", message: "Saving system prompt..." });
    try {
      await api.updateProject(selectedProject.id, {
        systemPrompt: systemPromptDraft.trim() || undefined,
      });
      await onRefreshProjects();
      setSystemPromptState({ status: "success", message: "System prompt saved" });
    } catch (error) {
      setSystemPromptState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to save system prompt",
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
        <h3>System Prompt</h3>
        {selectedProject ? (
          <>
            <p className="helper-text">
              This prompt is automatically prepended to all panel generation requests for <strong>{selectedProject.name}</strong>.
              Use it for style consistency (e.g., "In a cyberpunk comic book style").
            </p>
            <div className="field">
              <label htmlFor="system-prompt">Panel generation prefix</label>
              <textarea
                id="system-prompt"
                rows={4}
                value={systemPromptDraft}
                onChange={(event) => setSystemPromptDraft(event.target.value)}
                placeholder="In a cyberpunk comic book style with neon highlights and dramatic shadows..."
              />
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="primary"
                onClick={handleSystemPromptSave}
                disabled={systemPromptState.status === "uploading"}
              >
                {systemPromptState.status === "uploading" ? "Saving..." : "Save System Prompt"}
              </button>
            </div>
            {systemPromptState.message && (
              <p className={`upload-status status-${systemPromptState.status}`} aria-live="polite">
                {systemPromptState.message}
              </p>
            )}
          </>
        ) : (
          <p className="helper-text">Select a project to set a system prompt for panel generation.</p>
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


