export interface Session {
  id: string;
  name: string;
  project_path: string;
  status: SessionStatus;
  created_at: string;
  model: string | null;
  icon_index: number;
  cli_session_id?: string | null;
}

export type SessionStatus =
  | "starting"
  | "connected"
  | "idle"
  | "closed"
  /**
   * Restored from a violent shutdown. The tab and stored transcript are visible
   * but no Claude CLI process is attached; the user clicks Resume on the in-chat
   * banner to spawn a fresh CLI via `--resume` (existing resumeFromHistory path).
   */
  | "paused-recovered";

export type SessionMode =
  | "normal"
  | "auto-accept"
  | "plan"
  | "auto"
  | "dont-ask"
  | "bypass-permissions";

/**
 * The CLI emits whatever effort label the active model supports
 * (see `supportedEffortLevels` per model in the `initialize` capability
 * response — Default has 5 levels incl. `xhigh`, Sonnet has 4 without it,
 * Haiku has none). The set is per-model and changes between CLI versions.
 * We treat it as an opaque CLI-provided string and validate at the UI
 * boundary against the live capabilities — never against a hardcoded list.
 */
export type ThinkingEffort = string;


export interface TurnStats {
  durationMs: number | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  durationApiMs?: number | null;
  numTurns?: number | null;
  stopReason?: string | null;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  activityIds: string[];
  isStreaming: boolean;
  turnStats?: TurnStats;
  restartable?: boolean;
  retryable?: boolean;
  thinkingContent?: string;
  isRestored?: boolean;
  isSelfDrive?: boolean;
  selfDriveEvent?: {
    action: string;
    summary: string;
    confidence: string;
    sessionIndex: number;
    phase: string;
    /**
     * When set, render as a BlockerCard: shows the blocker kind,
     * options the user can pick, and a free-text fallback. Picking
     * an option calls selfDriveStore.userResolveBlocker(...).
     */
    blocker?: {
      id: string;
      kind: string;
      summary: string;
      optionsOffered: string[];
      resolutionCriteria: string;
      status: "open" | "user-decided" | "verifying" | "resolved" | "abandoned";
    };
  };
}

export interface SessionStats {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  turnCount: number;
  apiCallCount: number;  // incremented on each usage_update (per API call within a turn)
}

export interface PersistedSession {
  id: string;
  name: string;
  project_path: string;
  status: string;
  created_at: string;
  model: string | null;
  icon_index: number;
  cli_session_id: string | null;
  closed_at: string | null;
}

export interface SessionHistoryEntry {
  session_id: string;
  name: string;
  project_path: string;
  model: string | null;
  closed_at: string;
  cli_session_id: string;
  icon_index: number;
  recent_headlines: string[];
  has_stored_messages: boolean;
}

export interface SessionMessagePayload {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  thinkingContent: string | null;
  sortOrder: number;
}

export interface SessionMessageSearchResult {
  sessionId: string;
  sessionName: string;
  messageId: string;
  role: string;
  contentSnippet: string;
  timestamp: string;
}
