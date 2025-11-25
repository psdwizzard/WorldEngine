import { useCallback, useEffect, useMemo, useState } from "react";

export type WorkspaceSettings = {
  geminiKey: string;
  assetRoot: string;
  defaultResolution: "768" | "1024" | "1536";
  projectId?: string;
  projectSlug?: string;
  defaultPageBackgroundColor?: string;
  selectedIssue?: string;
  /** Custom issues created by the user (persisted across sessions) */
  customIssues?: string[];
};

type SettingsStatus = "idle" | "dirty" | "saving" | "saved";

const STORAGE_KEY = "worldengine.settings";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  geminiKey: "",
  assetRoot: "",
  defaultResolution: "1024",
  projectId: undefined,
  projectSlug: "",
  defaultPageBackgroundColor: undefined,
};

function readSettings(): WorkspaceSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(raw) as Partial<WorkspaceSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    } satisfies WorkspaceSettings;
  } catch (error) {
    console.error("settings:read_failed", error);
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: WorkspaceSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useSettings() {
  const [settings, setSettings] = useState<WorkspaceSettings>(() => readSettings());
  const [status, setStatus] = useState<SettingsStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  const saveSettings = useCallback((next: WorkspaceSettings) => {
    setStatus("saving");
    setSettings(next);
    writeSettings(next);
    setLastSavedAt(Date.now());
    setStatus("saved");
  }, []);

  const updateSetting = useCallback(<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value } as WorkspaceSettings;
      setStatus("dirty");
      writeSettings(updated);
      return updated;
    });
  }, []);

  useEffect(() => {
    if (status !== "saved") return;

    const timeout = window.setTimeout(() => {
      setStatus("idle");
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [status]);

  return useMemo(
    () => ({
      settings,
      status,
      lastSavedAt,
      setStatus,
      saveSettings,
      updateSetting,
      reset: () => {
        setSettings(DEFAULT_SETTINGS);
        writeSettings(DEFAULT_SETTINGS);
        setStatus("idle");
        setLastSavedAt(Date.now());
      },
    }),
    [lastSavedAt, saveSettings, settings, status, updateSetting],
  );
}
