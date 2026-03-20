import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore } from "./settingsStore";

// Mock Tauri commands
vi.mock("../lib/tauri-commands", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}));

function resetStore(): void {
  useSettingsStore.setState({
    settings: {
      theme: "midnight",
      fontSize: 13,
      sendShortcut: "cmd+enter",
      terminalShell: null,
      terminalFontSize: 13,
      quickCommands: [],
      apiKeys: {},
      modelPricing: {},
      changelogEnabled: false,
      changelogProvider: "gemini",
      changelogModel: "gemini-2.5-flash-lite",
      changelogPrompt: "",
      assistantShortcuts: [],
      assistantDefaultProvider: "claude-code",
      assistantDefaultModel: {},
      previewDefaultWidth: 1024,
      previewDefaultHeight: 768,
      previewAutoStart: false,
      previewCustomDevCommand: null,
      triviaEnabled: true,
      defaultContextWindow: 200000,
      autoOpenFiles: false,
      claudeBinaryOverride: null,
      onboardingCompleted: false,
      previewConsoleAutoOpen: true,
      taskBoardPlanningModel: "gemini-2.5-flash",
      taskBoardMaxTokens: 32768,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
    },
    loaded: false,
  });
}

describe("settingsStore", () => {
  beforeEach(resetStore);

  it("has sensible defaults", () => {
    const { settings } = useSettingsStore.getState();
    expect(settings.theme).toBe("midnight");
    expect(settings.fontSize).toBe(13);
    expect(settings.sendShortcut).toBe("cmd+enter");
    expect(settings.changelogEnabled).toBe(false);
    expect(settings.triviaEnabled).toBe(true);
    expect(settings.autoOpenFiles).toBe(false);
  });

  it("starts with loaded=false", () => {
    expect(useSettingsStore.getState().loaded).toBe(false);
  });

  it("updateSettings merges partial updates into existing settings", async () => {
    await useSettingsStore.getState().updateSettings({ fontSize: 16 });
    const { settings } = useSettingsStore.getState();
    expect(settings.fontSize).toBe(16);
    // Other settings unchanged
    expect(settings.theme).toBe("midnight");
    expect(settings.sendShortcut).toBe("cmd+enter");
  });

  it("updateSettings handles multiple fields at once", async () => {
    await useSettingsStore.getState().updateSettings({
      fontSize: 15,
      autoOpenFiles: true,
      triviaEnabled: false,
    });
    const { settings } = useSettingsStore.getState();
    expect(settings.fontSize).toBe(15);
    expect(settings.autoOpenFiles).toBe(true);
    expect(settings.triviaEnabled).toBe(false);
  });

  it("updateSettings preserves apiKeys when updating other fields", async () => {
    // Set up initial apiKeys
    await useSettingsStore.getState().updateSettings({
      apiKeys: { openai: "sk-test" },
    });
    // Update unrelated field
    await useSettingsStore.getState().updateSettings({ fontSize: 18 });
    const { settings } = useSettingsStore.getState();
    expect(settings.apiKeys).toEqual({ openai: "sk-test" });
    expect(settings.fontSize).toBe(18);
  });

  it("updateSettings updates theme", async () => {
    await useSettingsStore.getState().updateSettings({ theme: "ocean" });
    expect(useSettingsStore.getState().settings.theme).toBe("ocean");
  });
});
