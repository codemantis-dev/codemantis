/**
 * Typed factory functions for FrontendEvent test fixtures.
 * Use these instead of inline objects to get type safety and reduce boilerplate.
 */
import type { FrontendEvent, UsageInfo } from "../../types/claude-events";

const DEFAULT_SESSION_ID = "test-session-1";

// --- Chat events ---

export function createSessionInitEvent(
  overrides: Partial<{ session_id: string; model: string; thinking_effort: string }> = {}
): FrontendEvent {
  return {
    type: "session_init",
    session_id: overrides.session_id ?? DEFAULT_SESSION_ID,
    model: overrides.model ?? "claude-sonnet-4-20250514",
    ...overrides,
  } as FrontendEvent;
}

export function createTextDeltaEvent(
  text: string,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "text_delta",
    session_id: sessionId,
    text,
  } as FrontendEvent;
}

export function createTextCompleteEvent(
  fullText: string,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "text_complete",
    session_id: sessionId,
    full_text: fullText,
  } as FrontendEvent;
}

export function createThinkingDeltaEvent(
  thinking: string,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "thinking_delta",
    session_id: sessionId,
    thinking,
  } as FrontendEvent;
}

export function createThinkingCompleteEvent(
  fullThinking: string,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "thinking_complete",
    session_id: sessionId,
    full_thinking: fullThinking,
  } as FrontendEvent;
}

export function createTurnCompleteEvent(
  overrides: Partial<{
    session_id: string;
    duration_ms: number;
    usage: UsageInfo;
    cost_usd: number;
    model_name: string;
    context_window: number;
    max_output_tokens: number;
    num_turns: number;
    stop_reason: string;
    duration_api_ms: number;
  }> = {}
): FrontendEvent {
  return {
    type: "turn_complete",
    session_id: overrides.session_id ?? DEFAULT_SESSION_ID,
    duration_ms: overrides.duration_ms ?? 5000,
    usage: overrides.usage ?? {
      input_tokens: 5000,
      output_tokens: 2000,
    },
    cost_usd: overrides.cost_usd ?? 0.05,
    ...overrides,
  } as FrontendEvent;
}

// --- Activity events ---

export function createToolUseStartEvent(
  toolName: string,
  toolInput: Record<string, unknown> = {},
  overrides: Partial<{ session_id: string; tool_use_id: string }> = {}
): FrontendEvent {
  return {
    type: "tool_use_start",
    session_id: overrides.session_id ?? DEFAULT_SESSION_ID,
    tool_use_id: overrides.tool_use_id ?? `tool-${Date.now()}`,
    tool_name: toolName,
    tool_input: toolInput,
  } as FrontendEvent;
}

export function createToolResultEvent(
  toolUseId: string,
  content: string = "",
  isError: boolean = false,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "tool_result",
    session_id: sessionId,
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  } as FrontendEvent;
}

export function createToolProgressEvent(
  toolUseId: string,
  toolName: string,
  elapsedSeconds: number,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "tool_progress",
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_name: toolName,
    elapsed_seconds: elapsedSeconds,
  } as FrontendEvent;
}

// --- Sub-agent events ---

export function createAgentPreparingEvent(
  toolUseId: string,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "agent_preparing",
    session_id: sessionId,
    tool_use_id: toolUseId,
  } as FrontendEvent;
}

export function createSubAgentStartedEvent(
  toolUseId: string,
  description: string,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "subagent_started",
    session_id: sessionId,
    tool_use_id: toolUseId,
    description,
    subagent_type: "general-purpose",
  } as FrontendEvent;
}

export function createSubAgentCompleteEvent(
  toolUseId: string,
  sessionId: string = DEFAULT_SESSION_ID,
  toolCount?: number,
  tokenCount?: number
): FrontendEvent {
  return {
    type: "subagent_complete",
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_count: toolCount,
    token_count: tokenCount,
  } as FrontendEvent;
}

// --- System events ---

export function createProcessErrorEvent(
  error: string,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "process_error",
    session_id: sessionId,
    error,
  } as FrontendEvent;
}

export function createProcessExitedEvent(
  exitCode: number,
  stderrTail: string = "",
  sessionId: string = DEFAULT_SESSION_ID,
  elapsedMs: number = 1000
): FrontendEvent {
  return {
    type: "process_exited",
    session_id: sessionId,
    exit_code: exitCode,
    stderr_tail: stderrTail,
    elapsed_ms: elapsedMs,
  } as FrontendEvent;
}

export function createCliSessionIdEvent(
  cliSessionId: string,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "cli_session_id",
    session_id: sessionId,
    cli_session_id: cliSessionId,
  } as FrontendEvent;
}

export function createCompactingStatusEvent(
  isCompacting: boolean,
  sessionId: string = DEFAULT_SESSION_ID,
  compactResult?: string
): FrontendEvent {
  return {
    type: "compacting_status",
    session_id: sessionId,
    is_compacting: isCompacting,
    ...(compactResult !== undefined ? { compact_result: compactResult } : {}),
  } as FrontendEvent;
}

export function createUsageUpdateEvent(
  usage: UsageInfo,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "usage_update",
    session_id: sessionId,
    usage,
  } as FrontendEvent;
}

export function createCompactCompleteEvent(
  opts: { trigger?: string; preTokens?: number | null; postTokens?: number | null } = {},
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "compact_complete",
    session_id: sessionId,
    trigger: opts.trigger ?? "manual",
    pre_tokens: opts.preTokens ?? null,
    post_tokens: opts.postTokens ?? null,
  } as FrontendEvent;
}

export function createRateLimitWarningEvent(
  utilization: number,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "rate_limit_warning",
    session_id: sessionId,
    utilization,
    resets_at: Date.now() + 60000,
  } as FrontendEvent;
}

export function createModelChangedEvent(
  model: string,
  success: boolean = true,
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent {
  return {
    type: "model_changed",
    session_id: sessionId,
    model,
    success,
  } as FrontendEvent;
}

// --- Pre-built event sequences ---

/** Simple text-only turn: init → delta → complete → turn_complete */
export function createSimpleTurnSequence(sessionId: string = DEFAULT_SESSION_ID): FrontendEvent[] {
  return [
    createTextDeltaEvent("Hello, ", sessionId),
    createTextDeltaEvent("world!", sessionId),
    createTextCompleteEvent("Hello, world!", sessionId),
    createTurnCompleteEvent({ session_id: sessionId }),
  ];
}

/** Tool use turn: delta → tool_use → tool_result → delta → turn_complete */
export function createToolUseTurnSequence(
  toolName: string = "Write",
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent[] {
  const toolId = "tool-1";
  return [
    createTextDeltaEvent("Let me write that file.", sessionId),
    createTextCompleteEvent("Let me write that file.", sessionId),
    createToolUseStartEvent(toolName, { file_path: "src/main.ts", content: "export {}" }, { session_id: sessionId, tool_use_id: toolId }),
    createToolResultEvent(toolId, "File written successfully", false, sessionId),
    createTextDeltaEvent("Done!", sessionId),
    createTextCompleteEvent("Done!", sessionId),
    createTurnCompleteEvent({ session_id: sessionId }),
  ];
}

/** Error turn: delta → process_error */
export function createErrorTurnSequence(
  error: string = "Connection lost",
  sessionId: string = DEFAULT_SESSION_ID
): FrontendEvent[] {
  return [
    createTextDeltaEvent("I'll help with—", sessionId),
    createProcessErrorEvent(error, sessionId),
  ];
}

/** Rate limit turn: process_exited with rate limit stderr */
export function createRateLimitTurnSequence(sessionId: string = DEFAULT_SESSION_ID): FrontendEvent[] {
  return [
    createTextDeltaEvent("Working on it...", sessionId),
    createProcessExitedEvent(1, "Error: 429 rate limit exceeded", sessionId),
  ];
}

export const TEST_SESSION_ID = DEFAULT_SESSION_ID;
