import { create } from "zustand";
import type { AppSettings, ThemeId } from "../types/settings";
import { THEMES, DEFAULT_CHANGELOG_PROMPT, getDefaultModelPricing } from "../types/settings";
import { getSettings, updateSettings as updateSettingsCmd } from "../lib/tauri-commands";
import { showToast } from "./toastStore";
import { handleError } from "../lib/error-handler";

function normalizeTheme(theme: string): ThemeId {
  if (THEMES.some((t) => t.id === theme)) return theme as ThemeId;
  return "sand"; // fallback for legacy "dark" or unknown values
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme);
}

function applyFontSize(size: number): void {
  document.documentElement.style.setProperty("--font-size-base", `${size}px`);
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
  adjustFontSize: (delta: number) => void;
  resetFontSize: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "sand",
  fontSize: 13,
  sendShortcut: "cmd+enter",
  terminalShell: null,
  terminalFontSize: 13,
  quickCommands: [
    { label: "Build", command: "pnpm build" },
    { label: "Test", command: "pnpm test" },
    { label: "Lint", command: "pnpm lint" },
    { label: "Dev", command: "pnpm dev" },
  ],
  apiKeys: {},
  modelPricing: getDefaultModelPricing(),
  changelogEnabled: false,
  changelogProvider: "gemini",
  changelogModel: "gemini-2.5-flash-lite",
  changelogPrompt: DEFAULT_CHANGELOG_PROMPT,
  assistantShortcuts: [],
  assistantDefaultProvider: "claude-code",
  assistantDefaultModel: {},
  previewDefaultWidth: 1024,
  previewDefaultHeight: 768,
  previewAutoStart: false,
  previewCustomDevCommand: null,
  previewConsoleAutoOpen: true,
  taskBoardPlanningModel: "gemini-3.1-flash-lite-preview",
  taskBoardMaxTokens: 64000,
  taskBoardMaxRetries: 3,
  taskBoardAutoStartNext: true,
  taskBoardAutoOpenSlideOver: true,
  triviaEnabled: false,
  defaultContextWindow: 1000000,
  autoOpenFiles: false,
  claudeBinaryOverride: null,
  onboardingCompleted: false,
  apiKeyBannerDismissed: false,
  lastCloneDirectory: null,
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  loadSettings: async () => {
    try {
      const settings = await getSettings();
      settings.theme = normalizeTheme(settings.theme);
      applyTheme(settings.theme);
      applyFontSize(settings.fontSize ?? 13);
      set({ settings, loaded: true });
    } catch (e) {
      console.error("Failed to load settings:", e);
      set({ loaded: true });
    }
  },

  updateSettings: async (partial) => {
    const merged = { ...get().settings, ...partial };
    if (partial.theme) {
      applyTheme(partial.theme);
    }
    if (partial.fontSize !== undefined) {
      applyFontSize(partial.fontSize);
    }
    set({ settings: merged });
    try {
      await updateSettingsCmd(merged);
    } catch (e) {
      handleError("Failed to save settings", e);
    }
  },

  adjustFontSize: (delta: number) => {
    const { settings, updateSettings } = get();
    const newFontSize = Math.max(10, Math.min(20, settings.fontSize + delta));
    const newTermFontSize = Math.max(10, Math.min(20, settings.terminalFontSize + delta));
    if (newFontSize === settings.fontSize && newTermFontSize === settings.terminalFontSize) return;
    updateSettings({ fontSize: newFontSize, terminalFontSize: newTermFontSize });
    showToast(`Font size: ${newFontSize}px`, "info");
  },

  resetFontSize: () => {
    const { updateSettings } = get();
    updateSettings({ fontSize: 13, terminalFontSize: 13 });
    showToast("Font size reset to 13px", "info");
  },
}));
