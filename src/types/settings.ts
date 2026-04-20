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

export type ChangelogProvider = "gemini" | "openai" | "anthropic" | "openrouter";

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

  // Preview
  previewDefaultWidth: number;
  previewDefaultHeight: number;
  previewAutoStart: boolean;
  previewCustomDevCommand: string | null;
  previewConsoleAutoOpen: boolean;
  previewLastUrls: Record<string, string>;

  // Task Board
  taskBoardPlanningModel: string;
  taskBoardMaxTokens: number;
  taskBoardMaxRetries: number;
  taskBoardAutoStartNext: boolean;
  taskBoardAutoOpenSlideOver: boolean;

  // Trivia
  triviaEnabled: boolean;

  // File viewer
  autoOpenFiles: boolean;

  // Context window
  defaultContextWindow: number;

  // Claude binary override (user-selected path)
  claudeBinaryOverride: string | null;

  // Onboarding
  onboardingCompleted: boolean;

  // API key banner
  apiKeyBannerDismissed: boolean;

  // Clone from GitHub
  lastCloneDirectory: string | null;

  // Session Logs
  sessionLogsEnabled: boolean;
  sessionLogsRetentionDays: number;

  // Super-Bro
  superBroEnabled: boolean;
  superBroProvider: string;
  superBroModel: string;

  // Self-Drive
  selfDriveProvider: string;
  selfDriveModel: string;
  selfDriveMaxFixAttempts: number;
  selfDriveRunBuildCheck: boolean;
  selfDriveRunTests: boolean;
  selfDriveAutoCommit: boolean;
  /**
   * Opt-in to the orchestrator's `request_recheck` loop. When enabled
   * (default), the orchestrator can ask Claude Code to re-state evidence
   * for specific verify items before pausing, up to 2 rounds per session.
   * Disable if the loop ever runs away or the user wants to review every
   * verification pause manually.
   */
  selfDriveEnableRecheckLoop: boolean;
}

export { getDefaultModelPricing };

export const DEFAULT_CHANGELOG_PROMPT = `Summarize this coding session turn as a changelog entry. Return JSON only, markdown ONLY in the description field (5-6 sentences).
Make sure to briefly describe in general, what was changed, the most important topics.
Add the most important changes done.

Mandatory JSON format response format: {"headline":"max 80 chars","description":"5-6 sentences in markdown","category":"feature|bugfix|refactor|docs|config|test"}`;
