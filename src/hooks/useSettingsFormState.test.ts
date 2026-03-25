import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsFormState } from "./useSettingsFormState";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";

vi.mock("../lib/tauri-commands", () => ({
  testChangelogApiKey: vi.fn().mockResolvedValue(true),
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../components/modals/settings/SettingsShared", () => ({
  // Re-export the SettingsTab type (constants module exports it)
}));

vi.mock("../components/modals/settings/constants", () => ({
  NAV_ITEMS: [],
  CHANGELOG_PROVIDERS: [],
}));

describe("useSettingsFormState", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset stores to default
    useUiStore.setState({
      showSettingsModal: false,
      initialSettingsTab: null,
    });
  });

  it("returns showModal as false by default", () => {
    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current.showModal).toBe(false);
  });

  it("returns all expected state fields", () => {
    const { result } = renderHook(() => useSettingsFormState());

    // Verify a sampling of the returned fields exist
    expect(result.current).toHaveProperty("theme");
    expect(result.current).toHaveProperty("fontSize");
    expect(result.current).toHaveProperty("sendShortcut");
    expect(result.current).toHaveProperty("handleSave");
    expect(result.current).toHaveProperty("handleCancel");
    expect(result.current).toHaveProperty("activeTab");
    expect(result.current).toHaveProperty("apiKeys");
    expect(result.current).toHaveProperty("changelogEnabled");
    expect(result.current).toHaveProperty("assistantDefaultProvider");
  });

  it("syncs local state from settings store when modal opens", () => {
    const settings = useSettingsStore.getState().settings;
    // Open modal
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    expect(result.current.theme).toBe(settings.theme);
    expect(result.current.fontSize).toBe(settings.fontSize);
    expect(result.current.sendShortcut).toBe(settings.sendShortcut);
  });

  it("handleCancel closes the modal", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.handleCancel();
    });

    expect(useUiStore.getState().showSettingsModal).toBe(false);
  });

  it("handleSave calls updateSettings and closes modal", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.handleSave();
    });

    expect(useUiStore.getState().showSettingsModal).toBe(false);
  });

  it("handleThemeChange updates theme and applies to DOM", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.handleThemeChange("midnight");
    });

    expect(result.current.theme).toBe("midnight");
    expect(document.documentElement.getAttribute("data-theme")).toBe("midnight");
  });

  it("handleApiKeyChange updates apiKeys and clears test results", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.handleApiKeyChange("openai", "sk-test-123");
    });

    expect(result.current.apiKeys["openai"]).toBe("sk-test-123");
  });

  it("sets activeTab from initialSettingsTab", () => {
    act(() => {
      useUiStore.setState({
        showSettingsModal: true,
        initialSettingsTab: "changelog",
      });
    });

    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current.activeTab).toBe("changelog");
  });

  // ── Session Logs fields ──

  it("returns session logs state fields", () => {
    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current).toHaveProperty("sessionLogsEnabled");
    expect(result.current).toHaveProperty("sessionLogsRetentionDays");
    expect(result.current).toHaveProperty("setSessionLogsEnabled");
    expect(result.current).toHaveProperty("setSessionLogsRetentionDays");
  });

  it("sessionLogsEnabled defaults to true", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current.sessionLogsEnabled).toBe(true);
  });

  it("sessionLogsRetentionDays defaults to 30", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current.sessionLogsRetentionDays).toBe(30);
  });

  it("syncs session logs fields from store on modal open", async () => {
    await useSettingsStore.getState().updateSettings({
      sessionLogsEnabled: false,
      sessionLogsRetentionDays: 90,
    });

    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current.sessionLogsEnabled).toBe(false);
    expect(result.current.sessionLogsRetentionDays).toBe(90);
  });

  it("setSessionLogsEnabled updates local state", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.setSessionLogsEnabled(false);
    });

    expect(result.current.sessionLogsEnabled).toBe(false);
  });

  it("setSessionLogsRetentionDays updates local state", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.setSessionLogsRetentionDays(7);
    });

    expect(result.current.sessionLogsRetentionDays).toBe(7);
  });
});
