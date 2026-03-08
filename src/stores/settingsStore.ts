import { create } from "zustand";
import type { AppSettings } from "../types/settings";
import { getSettings, updateSettings as updateSettingsCmd } from "../lib/tauri-commands";

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
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
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  loadSettings: async () => {
    try {
      const settings = await getSettings();
      set({ settings, loaded: true });
    } catch (e) {
      console.error("Failed to load settings:", e);
      set({ loaded: true });
    }
  },

  updateSettings: async (partial) => {
    const merged = { ...get().settings, ...partial };
    set({ settings: merged });
    try {
      await updateSettingsCmd(merged);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  },
}));
