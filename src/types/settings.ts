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

export interface ModelPricing {
  input: number;  // cost per 1M input tokens in USD
  output: number; // cost per 1M output tokens in USD
}

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
  changelogModelPricing: Record<string, ModelPricing>;
  changelogPrompt: string;
  assistantShortcuts: AssistantShortcut[];
}

export const CHANGELOG_MODELS: Record<ChangelogProvider, { id: string; label: string; defaultPricing: ModelPricing }[]> = {
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1", defaultPricing: { input: 2.0, output: 8.0 } },
    { id: "gpt-5-nano", label: "GPT-5 Nano", defaultPricing: { input: 0.5, output: 2.0 } },
    { id: "gpt-5-mini", label: "GPT-5 Mini", defaultPricing: { input: 1.0, output: 4.0 } },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", defaultPricing: { input: 0.0, output: 0.0 } },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", defaultPricing: { input: 0.15, output: 0.60 } },
  ],
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", defaultPricing: { input: 3.0, output: 15.0 } },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", defaultPricing: { input: 0.80, output: 4.0 } },
  ],
};

/** Build default pricing map from CHANGELOG_MODELS. */
export function getDefaultModelPricing(): Record<string, ModelPricing> {
  const pricing: Record<string, ModelPricing> = {};
  for (const models of Object.values(CHANGELOG_MODELS)) {
    for (const m of models) {
      pricing[m.id] = m.defaultPricing;
    }
  }
  return pricing;
}

export const DEFAULT_CHANGELOG_PROMPT = `Summarize this coding session turn as a changelog entry. Return JSON only, no markdown.

JSON format: {"headline":"max 80 chars","description":"1-2 sentences","category":"feature|bugfix|refactor|docs|config|test"}`;
