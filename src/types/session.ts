import type { AgentId } from "./agent-events";

export interface Session {
  id: string;
  /**
   * Which adapter owns this session. Added in Phase 2 S1; the backend
   * always stamps a value (defaults to "claude_code" on legacy DB rows).
   * The field is optional on the type so v1.2.0-era fixtures + tests
   * compile unchanged — readers should default `?? "claude_code"`.
   */
  agent_id?: AgentId;
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

/**
 * Kinds of prompts Self-Drive injects directly (not orchestrator-emitted).
 * Used to tag chat messages so the orchestrator can distinguish
 * worker-initiated turns from system-gated ones.
 */
export type SelfDriveInjectionKind =
  | "test-gate"      // pnpm test between sessions after advance
  | "test-dispatch"  // orchestrator emitted action:"test" (handleTest)
  | "commit-gate"    // auto-commit between sessions
  | "build-check"    // pnpm tsc --noEmit after build/fix
  | "recovery"       // recovery-verification prompt
  | "parity-recovery" // cross-system action parity recovery
  | "capability-check"; // Phase 0b SpecWriter capability handshake


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
  /**
   * Marks a chat message that Self-Drive itself injected (test gate, commit
   * gate, recovery prompt, etc.) — distinct from a verify/build/fix prompt
   * the orchestrator emitted in response to Claude's work. The orchestrator
   * uses this to skip ACTIVITY-EVIDENCE detectors on the worker's reply,
   * because the worker didn't author the prompt being responded to.
   */
  selfDriveInjection?: SelfDriveInjectionKind;
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
      /** Phase D.1 — surfaced in the BlockerCard. */
      orchestratorReasoning?: string;
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
