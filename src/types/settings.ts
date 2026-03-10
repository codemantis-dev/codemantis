export interface QuickCommand {
  label: string;
  command: string;
}

export interface AssistantShortcut {
  id: string;
  name: string;
  prompt: string;
}

export type ThemeId = "midnight" | "ocean" | "ember" | "dawn" | "sand" | "arctic";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  isDark: boolean;
}

export const THEMES: ThemeOption[] = [
  { id: "midnight", label: "Midnight", isDark: true },
  { id: "ocean", label: "Ocean", isDark: true },
  { id: "ember", label: "Ember", isDark: true },
  { id: "dawn", label: "Dawn", isDark: false },
  { id: "sand", label: "Sand", isDark: false },
  { id: "arctic", label: "Arctic", isDark: false },
];

export type ChangelogProvider = "gemini" | "openai" | "anthropic";

export interface AppSettings {
  theme: ThemeId;
  fontSize: number;
  sendShortcut: string;
  terminalShell: string | null;
  terminalFontSize: number;
  quickCommands: QuickCommand[];
  changelogEnabled: boolean;
  changelogProvider: ChangelogProvider;
  changelogModel: string;
  changelogApiKeys: Record<string, string>;
  changelogPrompt: string;
  assistantShortcuts: AssistantShortcut[];
}

export const CHANGELOG_MODELS: Record<ChangelogProvider, { id: string; label: string }[]> = {
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-5-nano", label: "GPT-5 Nano" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

export const DEFAULT_CHANGELOG_PROMPT = `Summarize this coding session turn as a changelog entry. Return JSON only, no markdown.

JSON format: {"headline":"max 80 chars","description":"1-2 sentences","category":"feature|bugfix|refactor|docs|config|test"}`;
