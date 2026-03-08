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
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  activityIds: string[];
  isStreaming: boolean;
  turnStats?: TurnStats;
}

export interface SessionStats {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  turnCount: number;
}

export interface PersistedSession {
  id: string;
  name: string;
  project_path: string;
  status: string;
  created_at: string;
  model: string | null;
  icon_index: number;
}
