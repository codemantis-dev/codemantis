import type { AIProvider } from "./assistant-provider";
import { getDefaultModelPricing } from "./assistant-provider";
import type { AgentId } from "./agent-events";
import type { TaskCategory } from "./task-category";

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

  /** Maximum number of open coding-agent session tabs allowed at once
   * (default 20, clamped to 1–100). Enforced in the frontend session
   * lifecycle (useClaudeSession). */
  maxCodingAgentSessions: number;

  // Session Logs
  sessionLogsEnabled: boolean;
  sessionLogsRetentionDays: number;

  /** Capture the raw Codex JSON-RPC wire (both directions) to a per-session
   * NDJSON file under the app data dir, for troubleshooting compaction stalls
   * and other protocol issues. */
  codexDebugLoggingEnabled: boolean;

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

  /**
   * Phase 0b capability handshake. When ON (default), SpecWriter asks the
   * user to confirm ambiguous or high-leverage capabilities (BrowserMCP,
   * Supabase service-role, LLM keys) before writing a spec, then live-fires
   * each confirmation. When OFF, SpecWriter relies on probe inference alone
   * and records ambiguous capabilities as `claimed-unverified` for
   * verify-mode to handle. The Phase 0a passive probe and Phase 0c live-fire
   * for probe-certain items always run regardless of this toggle.
   *
   * See plan: ~/.claude/plans/analyse-this-why-refactored-yao.md
   */
  selfDriveConfirmCapabilities: boolean;

  /**
   * Default thinking-effort the Claude CLI is launched with for new sessions.
   * Baked into the inline `--settings` blob (see `build_session_settings_json`
   * in src-tauri/src/claude/process.rs) so it overrides the user's
   * ~/.claude/settings.json. `null` = inherit the CLI's own config.
   *
   * The set of valid values is whatever the CLI exposes in
   * `initialize.response.models[].supportedEffortLevels` — this is per-model
   * and changes between CLI versions (Sonnet has 4 levels, Default has 5
   * incl. xhigh, Haiku has none). DO NOT hardcode the list anywhere — read
   * it from `sessionCapabilities` and validate against it.
   */
  defaultThinkingEffort: string | null;

  /**
   * v1.5.0 Phase 1 — per-task agent routing. Sparse map: a category
   * absent from this object means "use the primary agent" (the global
   * default picked in Settings → Agents, stored as `selectedAgentId`
   * in the UI store). Existing installs deserialize this as `{}` so
   * behaviour is unchanged until the user opts in.
   *
   * The resolver (`src/lib/agent-resolver.ts`) is the single consumer —
   * never read this map directly from spawn callsites.
   */
  defaultAgentByTask: Partial<Record<TaskCategory, AgentId>>;

  /**
   * v1.5.0 Phase 3 — set once the user has acknowledged the
   * `/second-opinion` privacy disclosure (recent chat content is sent
   * to the other local CLI). Mirrors `apiKeyBannerDismissed`.
   */
  secondOpinionPrivacyAcknowledged: boolean;

  /**
   * Recall (project-and-cross-project memory layer) config.
   * Optional for backward compat with `settings.json` files written
   * before v1; absent means "use defaults" (which means `enabled:
   * false`, so Recall is dormant until opt-in).
   *
   * The full shape lives in `src/types/recall.ts` —
   * `import type { RecallConfig } from "./recall"`.
   */
  recall?: import("./recall").RecallConfig;

  /**
   * Duo-Coding defaults & policy (mentor/primary collaborative mode).
   * Optional for backward compat; absent means "use defaults" (`enabled:
   * false`, so Duo-Coding is dormant until opt-in). Mirrors the Rust
   * `DuoCodingConfig` (`src-tauri/src/commands/settings.rs`). The per-run
   * agent pairing lives in `DuoConfig` (`src/types/duo.ts`), not here.
   */
  duo?: DuoCodingSettings;
}

export interface DuoCodingSettings {
  enabled: boolean;
  /** "pause" (default) | "mentorWins" | "primaryWins". */
  tieBreakPolicy: "pause" | "mentorWins" | "primaryWins";
  maxDialogueRounds: number;
  severeDriftNudgeEnabled: boolean;
  severeDriftSensitivity: "conservative" | "balanced" | "aggressive";
  analystEnabled: boolean;
  analystProvider: string;
  analystModel: string;
  budgetUsdCap: number | null;
  budgetTokenCap: number | null;
}

/** Default Duo-Coding config (enabled), matching Rust `DuoCodingConfig::default()`. */
export const DEFAULT_DUO_SETTINGS: DuoCodingSettings = {
  enabled: true,
  tieBreakPolicy: "pause",
  maxDialogueRounds: 3,
  severeDriftNudgeEnabled: true,
  severeDriftSensitivity: "conservative",
  analystEnabled: true,
  analystProvider: "gemini",
  analystModel: "gemini-2.5-flash-lite",
  budgetUsdCap: null,
  budgetTokenCap: null,
};

export { getDefaultModelPricing };

export const DEFAULT_CHANGELOG_PROMPT = `Summarize this coding session turn as a changelog entry. Return JSON only, markdown ONLY in the description field (5-6 sentences).
Make sure to briefly describe in general, what was changed, the most important topics.
Add the most important changes done.

Mandatory JSON format response format: {"headline":"max 80 chars","description":"5-6 sentences in markdown","category":"feature|bugfix|refactor|docs|config|test"}`;
