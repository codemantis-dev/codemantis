import type { AIProvider } from "./assistant-provider";
import { getDefaultModelPricing } from "./assistant-provider";

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

export interface ModelPricing {
  input: number;  // cost per 1M input tokens in USD
  output: number; // cost per 1M output tokens in USD
}

export type ChangelogProvider = "gemini" | "openai" | "anthropic";

export interface AppSettings {
  theme: ThemeId;
  fontSize: number;
  sendShortcut: string;
  terminalShell: string | null;
  terminalFontSize: number;
  quickCommands: QuickCommand[];

  // Shared AI provider settings
  apiKeys: Record<string, string>;
  modelPricing: Record<string, ModelPricing>;

  // Changelog-specific settings
  changelogEnabled: boolean;
  changelogProvider: ChangelogProvider;
  changelogModel: string;
  changelogPrompt: string;

  // Assistant settings
  assistantShortcuts: AssistantShortcut[];
  assistantDefaultProvider: AIProvider;
  assistantDefaultModel: Record<string, string>;

  // Trivia
  triviaEnabled: boolean;

  // Onboarding
  onboardingCompleted: boolean;
}

export { getDefaultModelPricing };

export const DEFAULT_CHANGELOG_PROMPT = `Summarize this coding session turn as a changelog entry. Return JSON only, no markdown.

JSON format: {"headline":"max 80 chars","description":"1-2 sentences","category":"feature|bugfix|refactor|docs|config|test"}`;
