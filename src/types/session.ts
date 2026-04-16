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

export type SessionStatus = "starting" | "connected" | "idle" | "closed";

export type SessionMode = "normal" | "auto-accept" | "plan";

export type ThinkingEffort = "high" | "medium" | "low";


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
