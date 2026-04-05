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

  it("setSessionLogsEnabled updates local state and auto-saves to store", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.setSessionLogsEnabled(false);
    });

    // Local state updated
    expect(result.current.sessionLogsEnabled).toBe(false);
    // Zustand store also updated immediately (auto-save)
    expect(useSettingsStore.getState().settings.sessionLogsEnabled).toBe(false);
  });

  it("setSessionLogsRetentionDays updates local state and auto-saves to store", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.setSessionLogsRetentionDays(7);
    });

    // Local state updated
    expect(result.current.sessionLogsRetentionDays).toBe(7);
    // Zustand store also updated immediately (auto-save)
    expect(useSettingsStore.getState().settings.sessionLogsRetentionDays).toBe(7);
  });

  it("session logs auto-save persists even if modal is cancelled", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    // Toggle session logs off (auto-saves immediately)
    act(() => {
      result.current.setSessionLogsEnabled(false);
    });

    // Cancel the modal (discards other unsaved changes)
    act(() => {
      result.current.handleCancel();
    });

    // Session logs change should still be persisted
    expect(useSettingsStore.getState().settings.sessionLogsEnabled).toBe(false);
  });

  // ── Self-Drive fields ──

  it("returns Self-Drive state fields", () => {
    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current).toHaveProperty("selfDriveProvider");
    expect(result.current).toHaveProperty("selfDriveModel");
    expect(result.current).toHaveProperty("selfDriveMaxFixAttempts");
    expect(result.current).toHaveProperty("selfDriveRunBuildCheck");
    expect(result.current).toHaveProperty("selfDriveRunTests");
    expect(result.current).toHaveProperty("selfDriveAutoCommit");
    expect(result.current).toHaveProperty("setSelfDriveProvider");
    expect(result.current).toHaveProperty("setSelfDriveModel");
    expect(result.current).toHaveProperty("setSelfDriveMaxFixAttempts");
    expect(result.current).toHaveProperty("setSelfDriveRunBuildCheck");
    expect(result.current).toHaveProperty("setSelfDriveRunTests");
    expect(result.current).toHaveProperty("setSelfDriveAutoCommit");
  });

  it("Self-Drive fields have correct defaults", () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current.selfDriveProvider).toBe("anthropic");
    expect(result.current.selfDriveModel).toBe("claude-haiku-4-5");
    expect(result.current.selfDriveMaxFixAttempts).toBe(3);
    expect(result.current.selfDriveRunBuildCheck).toBe(true);
    expect(result.current.selfDriveRunTests).toBe(true);
    expect(result.current.selfDriveAutoCommit).toBe(false);
  });

  it("syncs Self-Drive fields from store on modal open", async () => {
    await useSettingsStore.getState().updateSettings({
      selfDriveProvider: "gemini",
      selfDriveModel: "gemini-2.5-flash",
      selfDriveMaxFixAttempts: 5,
      selfDriveRunBuildCheck: false,
      selfDriveRunTests: false,
      selfDriveAutoCommit: true,
    });

    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current.selfDriveProvider).toBe("gemini");
    expect(result.current.selfDriveModel).toBe("gemini-2.5-flash");
    expect(result.current.selfDriveMaxFixAttempts).toBe(5);
    expect(result.current.selfDriveRunBuildCheck).toBe(false);
    expect(result.current.selfDriveRunTests).toBe(false);
    expect(result.current.selfDriveAutoCommit).toBe(true);
  });

  it("handleSave persists Self-Drive fields to store", async () => {
    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());

    act(() => {
      result.current.setSelfDriveProvider("openai");
      result.current.setSelfDriveModel("gpt-4.1");
      result.current.setSelfDriveMaxFixAttempts(7);
      result.current.setSelfDriveAutoCommit(true);
    });

    act(() => {
      result.current.handleSave();
    });

    const { settings } = useSettingsStore.getState();
    expect(settings.selfDriveProvider).toBe("openai");
    expect(settings.selfDriveModel).toBe("gpt-4.1");
    expect(settings.selfDriveMaxFixAttempts).toBe(7);
    expect(settings.selfDriveAutoCommit).toBe(true);
  });

  // ── Super-Bro fields ──

  it("returns Super-Bro state fields", () => {
    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current).toHaveProperty("superBroEnabled");
    expect(result.current).toHaveProperty("superBroProvider");
    expect(result.current).toHaveProperty("superBroModel");
    expect(result.current).toHaveProperty("setSuperBroEnabled");
    expect(result.current).toHaveProperty("setSuperBroProvider");
    expect(result.current).toHaveProperty("setSuperBroModel");
  });

  it("syncs Super-Bro fields from store on modal open", async () => {
    await useSettingsStore.getState().updateSettings({
      superBroEnabled: false,
      superBroProvider: "gemini",
      superBroModel: "gemini-2.5-flash-lite",
    });

    act(() => {
      useUiStore.setState({ showSettingsModal: true });
    });

    const { result } = renderHook(() => useSettingsFormState());
    expect(result.current.superBroEnabled).toBe(false);
    expect(result.current.superBroProvider).toBe("gemini");
    expect(result.current.superBroModel).toBe("gemini-2.5-flash-lite");
  });
});
