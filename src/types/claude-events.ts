export type FrontendEvent =
  | SessionInitEvent
  | TextDeltaEvent
  | TextCompleteEvent
  | ToolUseStartEvent
  | ToolResultEvent
  | TurnCompleteEvent
  | ProcessErrorEvent
  | ProcessExitedEvent
  | CliSessionIdEvent
  | CompactingStatusEvent
  | CompactCompleteEvent
  | ToolProgressEvent
  | RateLimitWarningEvent
  | UsageUpdateEvent;

export interface SessionInitEvent {
  type: "session_init";
  session_id: string;
  model: string | null;
  thinking_effort?: string | null;
}

export interface TextDeltaEvent {
  type: "text_delta";
  session_id: string;
  text: string;
}

export interface TextCompleteEvent {
  type: "text_complete";
  session_id: string;
  full_text: string;
}

export interface ToolUseStartEvent {
  type: "tool_use_start";
  session_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  session_id: string;
  tool_use_id: string;
  content: string | null;
  is_error: boolean;
}

export interface TurnCompleteEvent {
  type: "turn_complete";
  session_id: string;
  duration_ms: number | null;
  usage: UsageInfo | null;
  cost_usd: number | null;
}

export interface ProcessErrorEvent {
  type: "process_error";
  session_id: string;
  error: string;
}

export interface ProcessExitedEvent {
  type: "process_exited";
  session_id: string;
  exit_code: number | null;
  stderr_tail: string | null;
  elapsed_ms: number;
}

export interface CliSessionIdEvent {
  type: "cli_session_id";
  session_id: string;
  cli_session_id: string;
}

export interface UsageInfo {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

export interface CompactingStatusEvent {
  type: "compacting_status";
  session_id: string;
  is_compacting: boolean;
}

export interface CompactCompleteEvent {
  type: "compact_complete";
  session_id: string;
  trigger: string;
  pre_tokens: number | null;
}

export interface ToolProgressEvent {
  type: "tool_progress";
  session_id: string;
  tool_use_id: string;
  tool_name: string;
  elapsed_seconds: number;
}

export interface RateLimitWarningEvent {
  type: "rate_limit_warning";
  session_id: string;
  utilization: number;
  resets_at: number | null;
}

/** Per-API-call usage emitted from assistant events (fires after each tool round-trip). */
export interface UsageUpdateEvent {
  type: "usage_update";
  session_id: string;
  usage: UsageInfo;
}

/** Emitted globally by the approval HTTP server (not per-session). */
export interface ToolApprovalRequestEvent {
  requestId: string;
  forgeSessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}
