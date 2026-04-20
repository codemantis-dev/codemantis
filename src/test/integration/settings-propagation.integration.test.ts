/**
 * Integration test: Settings Propagation
 *
 * Tests that settings changes in the REAL settingsStore propagate correctly:
 * persisting via Tauri command, applying theme/fontSize to the DOM, loading
 * from Tauri backend, merging partial updates, and font size adjustment.
 *
 * Only the Tauri IPC boundary and toastStore are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import type { AppSettings } from "../../types/settings";

// Hoisted mocks for Tauri commands so we can control return values
const { mockGetSettings, mockUpdateSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn<() => Promise<Partial<AppSettings>>>(),
  mockUpdateSettings: vi.fn<(settings: AppSettings) => Promise<void>>(),
}));

// Mock ONLY the Tauri IPC boundary
vi.mock("../../lib/tauri-commands", () => ({
  getSettings: mockGetSettings,
  updateSettings: mockUpdateSettings,
  syncSessionMode: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

// Mock toastStore for toast assertions
vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

// Mock error-handler (used by updateSettings catch block)
vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

import { useSettingsStore } from "../../stores/settingsStore";
import { showToast } from "../../stores/toastStore";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Returns a complete settings object with sensible defaults for tests. */
function makeSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    theme: "sand",
    fontSize: 13,
    sendShortcut: "enter",
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
    previewConsoleAutoOpen: true,
    previewLastUrls: {},
    taskBoardPlanningModel: "gemini-3-flash-preview",
    taskBoardMaxTokens: 64000,
    taskBoardMaxRetries: 3,
    taskBoardAutoStartNext: true,
    taskBoardAutoOpenSlideOver: true,
    triviaEnabled: false,
    defaultContextWindow: 200000,
    autoOpenFiles: false,
    claudeBinaryOverride: null,
    onboardingCompleted: false,
    apiKeyBannerDismissed: false,
    lastCloneDirectory: null,
    sessionLogsEnabled: false,
    sessionLogsRetentionDays: 30,
    superBroEnabled: false,
    superBroProvider: "auto",
    superBroModel: "auto",
    selfDriveProvider: "anthropic",
    selfDriveModel: "claude-haiku-4-5",
    selfDriveMaxFixAttempts: 3,
    selfDriveRunBuildCheck: true,
    selfDriveRunTests: true,
selfDriveAutoCommit: false,
    selfDriveEnableRecheckLoop: true,
    ...overrides,
  } as AppSettings;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Settings Propagation (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    mockUpdateSettings.mockResolvedValue(undefined);
  });

  // ─── Persist via Tauri ─────────────────────────────────────────────────

  it("updateSettings persists via Tauri command", async () => {
    // Pre-load the store with baseline settings
    useSettingsStore.setState({ settings: makeSettings(), loaded: true });

    await useSettingsStore.getState().updateSettings({ triviaEnabled: true });

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    const savedSettings = mockUpdateSettings.mock.calls[0][0] as AppSettings;
    expect(savedSettings.triviaEnabled).toBe(true);
    // Other settings remain intact
    expect(savedSettings.theme).toBe("sand");
    expect(savedSettings.fontSize).toBe(13);
  });

  // ─── Theme application ─────────────────────────────────────────────────

  it("changing theme applies to document.documentElement", async () => {
    useSettingsStore.setState({ settings: makeSettings(), loaded: true });

    await useSettingsStore.getState().updateSettings({ theme: "midnight" });

    expect(document.documentElement.getAttribute("data-theme")).toBe("midnight");
    expect(useSettingsStore.getState().settings.theme).toBe("midnight");
  });

  // ─── Font size application ─────────────────────────────────────────────

  it("changing fontSize applies to document.documentElement", async () => {
    useSettingsStore.setState({ settings: makeSettings(), loaded: true });

    await useSettingsStore.getState().updateSettings({ fontSize: 16 });

    const cssVar = document.documentElement.style.getPropertyValue("--font-size-base");
    expect(cssVar).toBe("16px");
    expect(useSettingsStore.getState().settings.fontSize).toBe(16);
  });

  // ─── loadSettings ──────────────────────────────────────────────────────

  it("settings.loaded is set to true after loadSettings", async () => {
    expect(useSettingsStore.getState().loaded).toBe(false);

    mockGetSettings.mockResolvedValue(makeSettings());
    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  // ─── adjustFontSize ────────────────────────────────────────────────────

  it("adjustFontSize increments/decrements correctly", async () => {
    useSettingsStore.setState({ settings: makeSettings({ fontSize: 13, terminalFontSize: 13 }), loaded: true });

    // Increment
    useSettingsStore.getState().adjustFontSize(1);

    // Wait for the async updateSettings inside adjustFontSize
    await vi.waitFor(() => {
      expect(useSettingsStore.getState().settings.fontSize).toBe(14);
    });
    expect(useSettingsStore.getState().settings.terminalFontSize).toBe(14);
    expect(showToast).toHaveBeenCalledWith("Font size: 14px", "info");

    // Decrement by 2
    useSettingsStore.getState().adjustFontSize(-2);
    await vi.waitFor(() => {
      expect(useSettingsStore.getState().settings.fontSize).toBe(12);
    });
    expect(useSettingsStore.getState().settings.terminalFontSize).toBe(12);
  });

  // ─── adjustFontSize clamping ───────────────────────────────────────────

  it("adjustFontSize clamps at min=10 and max=20", async () => {
    // At minimum
    useSettingsStore.setState({ settings: makeSettings({ fontSize: 10, terminalFontSize: 10 }), loaded: true });
    useSettingsStore.getState().adjustFontSize(-5);

    // Should be a no-op since already at min
    expect(useSettingsStore.getState().settings.fontSize).toBe(10);

    // At maximum
    useSettingsStore.setState({ settings: makeSettings({ fontSize: 20, terminalFontSize: 20 }), loaded: true });
    useSettingsStore.getState().adjustFontSize(5);

    // Should be a no-op since already at max
    expect(useSettingsStore.getState().settings.fontSize).toBe(20);
  });

  // ─── resetFontSize ─────────────────────────────────────────────────────

  it("resetFontSize restores default", async () => {
    useSettingsStore.setState({ settings: makeSettings({ fontSize: 18, terminalFontSize: 18 }), loaded: true });

    useSettingsStore.getState().resetFontSize();

    await vi.waitFor(() => {
      expect(useSettingsStore.getState().settings.fontSize).toBe(13);
    });
    expect(useSettingsStore.getState().settings.terminalFontSize).toBe(13);
    expect(showToast).toHaveBeenCalledWith("Font size reset to 13px", "info");
  });

  // ─── loadSettings reads + applies ──────────────────────────────────────

  it("loadSettings reads from Tauri and applies theme", async () => {
    mockGetSettings.mockResolvedValue(makeSettings({ theme: "ocean", fontSize: 15 }));

    await useSettingsStore.getState().loadSettings();

    const state = useSettingsStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.settings.theme).toBe("ocean");
    expect(state.settings.fontSize).toBe(15);

    // DOM side-effects
    expect(document.documentElement.getAttribute("data-theme")).toBe("ocean");
    const cssVar = document.documentElement.style.getPropertyValue("--font-size-base");
    expect(cssVar).toBe("15px");
  });

  // ─── Partial merge ─────────────────────────────────────────────────────

  it("updateSettings merges partial updates", async () => {
    useSettingsStore.setState({ settings: makeSettings({ triviaEnabled: false, autoOpenFiles: false }), loaded: true });

    // Update only triviaEnabled
    await useSettingsStore.getState().updateSettings({ triviaEnabled: true });

    const settings = useSettingsStore.getState().settings;
    expect(settings.triviaEnabled).toBe(true);
    // Other fields remain unchanged
    expect(settings.autoOpenFiles).toBe(false);
    expect(settings.theme).toBe("sand");
    expect(settings.fontSize).toBe(13);

    // Update another field
    await useSettingsStore.getState().updateSettings({ autoOpenFiles: true });

    const updated = useSettingsStore.getState().settings;
    expect(updated.autoOpenFiles).toBe(true);
    // Previously updated field still holds
    expect(updated.triviaEnabled).toBe(true);
  });
});
