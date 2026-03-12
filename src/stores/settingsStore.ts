import { create } from "zustand";
import type { AppSettings, ThemeId } from "../types/settings";
import { THEMES, DEFAULT_CHANGELOG_PROMPT, getDefaultModelPricing } from "../types/settings";
import { getSettings, updateSettings as updateSettingsCmd } from "../lib/tauri-commands";

function normalizeTheme(theme: string): ThemeId {
  if (THEMES.some((t) => t.id === theme)) return theme as ThemeId;
  return "midnight"; // fallback for legacy "dark" or unknown values
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme);
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "midnight",
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
  triviaEnabled: true,
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  loadSettings: async () => {
    try {
      const settings = await getSettings();
      settings.theme = normalizeTheme(settings.theme);
      applyTheme(settings.theme);
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
    set({ settings: merged });
    try {
      await updateSettingsCmd(merged);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  },
}));
