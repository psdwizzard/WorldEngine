import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSettings } from "./useSettings";

describe("useSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("provides default settings when storage is empty", () => {
    const { result } = renderHook(() => useSettings());

    expect(result.current.settings).toMatchObject({
      geminiKey: "",
      assetRoot: "",
      defaultResolution: "1024",
    });
    expect(result.current.status).toBe("idle");
  });

  it("saves settings to localStorage on request", () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSetting("geminiKey", "test-key");
      result.current.updateSetting("assetRoot", "c:/tmp/assets");
      result.current.updateSetting("defaultResolution", "768");
    });

    expect(result.current.status).toBe("dirty");

    act(() => {
      result.current.saveSettings({ ...result.current.settings });
    });

    expect(JSON.parse(window.localStorage.getItem("worldengine.settings") ?? "{}")).toMatchObject({
      geminiKey: "test-key",
      assetRoot: "c:/tmp/assets",
      defaultResolution: "768",
    });
    expect(result.current.status).toBe("saved");
  });
});
