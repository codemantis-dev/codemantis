/**
 * Which coding-agent CLI produced an event. Phase 2 added `codex`.
 * The field remains optional on event payloads (still `agent_id?` on each
 * variant) for Phase 1 wire-format back-compat; the frontend handlers
 * that need to branch on it (e.g. the protected-path detector in
 * `event-handlers/chat.ts`) treat `undefined` as `"claude_code"`.
 *
 * Wire format matches the Rust `agents::AgentId` snake_case serde repr.
 */
export type AgentId = "claude_code" | "codex";

export type FrontendEvent =
  | SessionInitEvent
  | TextDeltaEvent
  | TextCompleteEvent
  | ToolUseStartEvent
  | ToolResultEvent
  | TurnCompleteEvent
  | ProcessErrorEvent
  | ProcessExitedEvent
  | ProtectedPathDenyEvent
  | CliSessionIdEvent
  | CompactingStatusEvent
  | CompactCompleteEvent
  | ToolProgressEvent
  | RateLimitWarningEvent
  | UsageUpdateEvent
  | InterruptResultEvent
  | ModelChangedEvent
  | CapabilitiesDiscoveredEvent
  | AgentPreparingEvent
  | SubAgentStartedEvent
  | SubAgentProgressEvent
  | SubAgentCompleteEvent
  | TaskNotificationEvent
  | TaskUpdatedEvent
  | ThinkingDeltaEvent
  | ThinkingCompleteEvent;

export interface SessionInitEvent {
  type: "session_init";
  agent_id?: AgentId;
  session_id: string;
  model: string | null;
  thinking_effort?: string | null;
}

export interface TextDeltaEvent {
  type: "text_delta";
  agent_id?: AgentId;
  session_id: string;
  text: string;
}

export interface TextCompleteEvent {
  type: "text_complete";
  agent_id?: AgentId;
  session_id: string;
  full_text: string;
}

export interface ToolUseStartEvent {
  type: "tool_use_start";
  agent_id?: AgentId;
  session_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  agent_id?: AgentId;
  session_id: string;
  tool_use_id: string;
  content: string | null;
  is_error: boolean;
}

export interface TurnCompleteEvent {
  type: "turn_complete";
  agent_id?: AgentId;
  session_id: string;
  duration_ms: number | null;
  usage: UsageInfo | null;
  cost_usd: number | null;
  duration_api_ms?: number | null;
  num_turns?: number | null;
  stop_reason?: string | null;
  /** Why the turn ended: "completed", "aborted_streaming" (interrupt), etc. Added in CLI v2.1.101. */
  terminal_reason?: string | null;
  model_name?: string | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
}

export interface ProcessErrorEvent {
  type: "process_error";
  agent_id?: AgentId;
  session_id: string;
  error: string;
}

export interface ProcessExitedEvent {
  type: "process_exited";
  agent_id?: AgentId;
  session_id: string;
  exit_code: number | null;
  stderr_tail: string | null;
  elapsed_ms: number;
}

/** A tool call the CLI denied internally via its protected-path guardrail
 * (writes to `.claude/`, `.git/`, `.vscode/` even with `--dangerously-skip-permissions`,
 * per CLI 2.1.78+). The CLI does not emit a `control_request`, so the host
 * cannot ask the user first; this event lets the frontend surface a clear
 * explanation instead of letting the agent stall. */
export interface ProtectedPathDenyEvent {
  type: "protected_path_deny";
  agent_id?: AgentId;
  session_id: string;
  denials: ProtectedPathDenial[];
}

export interface ProtectedPathDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

export interface CliSessionIdEvent {
  type: "cli_session_id";
  agent_id?: AgentId;
  session_id: string;
  cli_session_id: string;
}

export interface UsageInfo {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  service_tier?: string | null;
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null;
  /** Per-iteration token breakdown, added in CLI v2.1.97+. */
  iterations?: UsageIteration[] | null;
}

export interface UsageIteration {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  type?: string | null;
}

export interface CompactingStatusEvent {
  type: "compacting_status";
  agent_id?: AgentId;
  session_id: string;
  is_compacting: boolean;
}

export interface CompactCompleteEvent {
  type: "compact_complete";
  agent_id?: AgentId;
  session_id: string;
  trigger: string;
  pre_tokens: number | null;
}

export interface ToolProgressEvent {
  type: "tool_progress";
  agent_id?: AgentId;
  session_id: string;
  tool_use_id: string;
  tool_name: string;
  elapsed_seconds: number;
}

export interface RateLimitWarningEvent {
  type: "rate_limit_warning";
  agent_id?: AgentId;
  session_id: string;
  utilization: number;
  resets_at: number | null;
  rate_limit_type?: string | null;
  overage_status?: string | null;
  is_using_overage?: boolean | null;
}

/** Per-API-call usage emitted from message_delta events (authoritative final token counts). */
export interface UsageUpdateEvent {
  type: "usage_update";
  agent_id?: AgentId;
  session_id: string;
  usage: UsageInfo;
}

export interface InterruptResultEvent {
  type: "interrupt_result";
  agent_id?: AgentId;
  session_id: string;
  success: boolean;
  error: string | null;
}

export interface ModelChangedEvent {
  type: "model_changed";
  agent_id?: AgentId;
  session_id: string;
  model: string;
  success: boolean;
  error: string | null;
}

export interface CapabilitiesDiscoveredEvent {
  type: "capabilities_discovered";
  agent_id?: AgentId;
  session_id: string;
  models: CliModelInfo[];
  commands: CliSlashCommand[];
  agents: CliAgentInfo[];
  account: CliAccountInfo | null;
  output_styles: string[];
}

export interface CliModelInfo {
  value: string;
  displayName: string;
  description: string;
  /** True for the model the CLI would pick if no explicit selection is sent.
   * Used by ModelSelector to show a resolved label (e.g. "GPT-5.5") instead
   * of a "Model ▼" placeholder before the user has clicked anything. */
  isDefault?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
  supportsAutoMode?: boolean;
}

export interface CliSlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface CliAgentInfo {
  name: string;
  description: string;
  model?: string;
}

export interface CliAccountInfo {
  email: string;
  organization: string;
  subscriptionType: string;
}

export interface AgentPreparingEvent {
  type: "agent_preparing";
  agent_id?: AgentId;
  session_id: string;
  tool_use_id: string;
}

export interface SubAgentStartedEvent {
  type: "subagent_started";
  agent_id?: AgentId;
  session_id: string;
  tool_use_id: string;
  description: string;
  subagent_type: string;
}

export interface SubAgentProgressEvent {
  type: "subagent_progress";
  agent_id?: AgentId;
  session_id: string;
  tool_use_id: string;
  tool_count: number | null;
  token_count: number | null;
  current_activity: string | null;
}

export interface SubAgentCompleteEvent {
  type: "subagent_complete";
  agent_id?: AgentId;
  session_id: string;
  tool_use_id: string;
  tool_count: number | null;
  token_count: number | null;
}

/**
 * Background-task completion from CLI v2.1.119+. Replaces `subagent_complete`
 * against the CLI's first-class tasks registry. `tool_use_id` links back to
 * the spawning Agent tool when available.
 */
export interface TaskNotificationEvent {
  type: "task_notification";
  agent_id?: AgentId;
  session_id: string;
  tool_use_id: string;
  task_id: string;
  status: string;
  summary: string | null;
  output_file: string | null;
  usage: UsageInfo | null;
}

/**
 * Incremental task-state patch from CLI v2.1.119+. Patch shape is not yet
 * characterised; forwarded as opaque JSON for future interpretation.
 */
export interface TaskUpdatedEvent {
  type: "task_updated";
  agent_id?: AgentId;
  session_id: string;
  task_id: string;
  patch: unknown;
}

export interface ThinkingDeltaEvent {
  type: "thinking_delta";
  agent_id?: AgentId;
  session_id: string;
  thinking: string;
}

export interface ThinkingCompleteEvent {
  type: "thinking_complete";
  agent_id?: AgentId;
  session_id: string;
  full_thinking: string;
}

/** Emitted globally by the approval HTTP server (not per-session). */
export interface ToolApprovalRequestEvent {
  requestId: string;
  forgeSessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}
