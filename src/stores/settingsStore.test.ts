import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { getSettings } from "../lib/tauri-commands";
import type { AppSettings } from "../types/settings";

// Mock Tauri commands
vi.mock("../lib/tauri-commands", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}));

const mockGetSettings = vi.mocked(getSettings);

/** Simulate incomplete backend data (fields omitted on purpose to test default-filling) */
function partialSettings(overrides: Partial<AppSettings>): AppSettings {
  return overrides as AppSettings;
}

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
      apiKeyBannerDismissed: false,
      lastCloneDirectory: null,
      previewConsoleAutoOpen: true,
      previewLastUrls: {},
      taskBoardPlanningModel: "gemini-3.5-flash",
      taskBoardMaxTokens: 64000,
      taskBoardMaxRetries: 3,
      taskBoardAutoStartNext: true,
      taskBoardAutoOpenSlideOver: true,
      sessionLogsEnabled: true,
      sessionLogsRetentionDays: 30,
      superBroEnabled: true,
      superBroProvider: "auto",
      superBroModel: "auto",
      selfDriveProvider: "anthropic",
      selfDriveModel: "claude-haiku-4-5",
      selfDriveMaxFixAttempts: 3,
      selfDriveRunBuildCheck: true,
      selfDriveRunTests: true,
selfDriveAutoCommit: false,
      selfDriveEnableRecheckLoop: true,
      selfDriveConfirmCapabilities: true,
      defaultThinkingEffort: null,
      defaultAgentByTask: {},
      secondOpinionPrivacyAcknowledged: false,
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

  // ── loadSettings ──

  describe("loadSettings", () => {
    it("sets loaded=true after loading", async () => {
      mockGetSettings.mockResolvedValueOnce(partialSettings({
        theme: "sand",
        fontSize: 13,
      }));

      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().loaded).toBe(true);
    });

    it("applies persisted values from backend", async () => {
      mockGetSettings.mockResolvedValueOnce(partialSettings({
        theme: "ocean",
        fontSize: 16,
        sendShortcut: "cmd+enter",
        selfDriveProvider: "gemini",
        selfDriveModel: "gemini-2.5-flash",
      }));

      await useSettingsStore.getState().loadSettings();
      const { settings } = useSettingsStore.getState();
      expect(settings.theme).toBe("ocean");
      expect(settings.fontSize).toBe(16);
      expect(settings.selfDriveProvider).toBe("gemini");
      expect(settings.selfDriveModel).toBe("gemini-2.5-flash");
    });

    it("fills in defaults for fields missing from persisted settings", async () => {
      // Simulate loading settings saved by an older version that had no
      // Self-Drive, Super-Bro, or Session Logs fields
      mockGetSettings.mockResolvedValueOnce(partialSettings({
        theme: "midnight",
        fontSize: 14,
        sendShortcut: "enter",
        terminalShell: null,
        terminalFontSize: 13,
        quickCommands: [],
        apiKeys: { openai: "sk-test" },
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
        previewConsoleAutoOpen: true,
        previewLastUrls: {},
        triviaEnabled: true,
        defaultContextWindow: 200000,
        autoOpenFiles: false,
        claudeBinaryOverride: null,
        onboardingCompleted: true,
        apiKeyBannerDismissed: false,
        lastCloneDirectory: null,
        // Deliberately omitting: superBro*, selfDrive*, sessionLogs*, taskBoard*
      }));

      await useSettingsStore.getState().loadSettings();
      const { settings } = useSettingsStore.getState();

      // Persisted values preserved
      expect(settings.theme).toBe("midnight");
      expect(settings.fontSize).toBe(14);
      expect(settings.apiKeys).toEqual({ openai: "sk-test" });
      expect(settings.onboardingCompleted).toBe(true);

      // Self-Drive fields filled from defaults
      expect(settings.selfDriveProvider).toBe("anthropic");
      expect(settings.selfDriveModel).toBe("claude-haiku-4-5");
      expect(settings.selfDriveMaxFixAttempts).toBe(3);
      expect(settings.selfDriveRunBuildCheck).toBe(true);
      expect(settings.selfDriveRunTests).toBe(true);
      expect(settings.selfDriveAutoCommit).toBe(false);

      // Super-Bro fields filled from defaults
      expect(settings.superBroEnabled).toBe(true);
      expect(settings.superBroProvider).toBe("auto");
      expect(settings.superBroModel).toBe("auto");

      // Session Logs fields filled from defaults
      expect(settings.sessionLogsEnabled).toBe(true);
      expect(settings.sessionLogsRetentionDays).toBe(30);

      // Task Board fields filled from defaults
      expect(settings.taskBoardPlanningModel).toBe("gemini-3.5-flash");
      expect(settings.taskBoardMaxTokens).toBe(64000);
      expect(settings.taskBoardMaxRetries).toBe(3);
      expect(settings.taskBoardAutoStartNext).toBe(true);
      expect(settings.taskBoardAutoOpenSlideOver).toBe(true);
    });

    it("fills in defaults when backend returns empty object", async () => {
      mockGetSettings.mockResolvedValueOnce(partialSettings({}));

      await useSettingsStore.getState().loadSettings();
      const { settings } = useSettingsStore.getState();

      // Every field should equal its default
      expect(settings.selfDriveProvider).toBe("anthropic");
      expect(settings.selfDriveModel).toBe("claude-haiku-4-5");
      expect(settings.superBroEnabled).toBe(true);
      expect(settings.sessionLogsEnabled).toBe(true);
      expect(settings.theme).toBe("sand"); // normalizeTheme converts undefined → "sand"
      expect(settings.fontSize).toBe(13);
    });

    it("persisted values override defaults when both exist", async () => {
      mockGetSettings.mockResolvedValueOnce(partialSettings({
        selfDriveProvider: "openai",
        selfDriveModel: "gpt-5.4-mini",
        selfDriveMaxFixAttempts: 5,
        selfDriveRunBuildCheck: false,
        selfDriveRunTests: false,
selfDriveAutoCommit: true,
        selfDriveEnableRecheckLoop: true,
        selfDriveConfirmCapabilities: true,
        defaultThinkingEffort: null,
        defaultAgentByTask: {},
        secondOpinionPrivacyAcknowledged: false,
        superBroEnabled: false,
        superBroProvider: "gemini",
        superBroModel: "gemini-2.5-flash-lite",
      }));

      await useSettingsStore.getState().loadSettings();
      const { settings } = useSettingsStore.getState();

      expect(settings.selfDriveProvider).toBe("openai");
      expect(settings.selfDriveModel).toBe("gpt-5.4-mini");
      expect(settings.selfDriveMaxFixAttempts).toBe(5);
      expect(settings.selfDriveRunBuildCheck).toBe(false);
      expect(settings.selfDriveRunTests).toBe(false);
      expect(settings.selfDriveAutoCommit).toBe(true);
      expect(settings.superBroEnabled).toBe(false);
      expect(settings.superBroProvider).toBe("gemini");
      expect(settings.superBroModel).toBe("gemini-2.5-flash-lite");
    });

    it("normalizes invalid theme values when loading", async () => {
      mockGetSettings.mockResolvedValueOnce(partialSettings({
        theme: "dark" as AppSettings["theme"], // legacy value not in THEMES list
      }));

      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().settings.theme).toBe("sand");
    });

    it("sets loaded=true even when getSettings throws", async () => {
      mockGetSettings.mockRejectedValueOnce(new Error("Backend not ready"));

      await useSettingsStore.getState().loadSettings();
      expect(useSettingsStore.getState().loaded).toBe(true);
    });
  });
});
