import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session, PersistedSession, SessionHistoryEntry, SessionMessagePayload, SessionMessageSearchResult } from "../types/session";
import type { FileNode } from "../types/file-tree";
import type { AgentId, FrontendEvent, ToolApprovalRequestEvent } from "../types/agent-events";
import type { AppSettings } from "../types/settings";
import type { ChangelogEntry, ProjectChangelogEntry } from "../types/changelog";
import type { GitStatusInfo, GitCommit, GitDiffResult } from "../types/git";
import type {
  BranchGraph,
  BranchRef,
  UpstreamStatus,
  ConflictState,
  GitOpResult,
  SwitchPreview,
  DeletePreview,
  MergePreview,
  PushPreview,
  UndoToken,
} from "../types/branch-graph";
import type { SlashCommand, ExpandedSkill, OneshotResult } from "../types/slash-commands";
import type { McpServerConfig } from "../types/mcp";
import type { ApiLogEntry, ApiCostSummary } from "../types/api-logs";
import type {
  DuoRunRow,
  DuoEventRow,
  DuoSnapshotRow,
  DuoAnalystReport,
  DuoSnapshotEvent,
} from "../types/duo";
import type { TemplateEntry, ScaffoldResult, ScaffoldProgressEvent, VerifyResult, PrerequisiteCheck, PrerequisiteResult, InstallPrerequisiteResult, ProjectAnalysis } from "../types/project-templates";
import type {
  CapabilityStatus,
  DetectionHit,
  ExtractionRequest,
  ExtractionResult,
  InstallResult,
  Manifest,
  PreflightStatus,
} from "../types/preflight";

// --- Startup ---

/**
 * Compatibility verdict for the installed Claude Code CLI. Emitted by the
 * Rust backend's `cli_version::CliSupport` enum. The `kind` discriminator
 * follows the camelCase rename in serde.
 */
export type CliSupport =
  | { kind: "supported" }
  | { kind: "outdated"; reason: string }
  | { kind: "unknown"; reason: string }
  | { kind: "notInstalled" };

export interface ClaudeStatus {
  installed: boolean;
  /** Raw `claude --version` stdout, kept for display. */
  version: string | null;
  /** Canonical x.y.z parsed from the raw string. */
  parsed_version: string | null;
  /** npm-registry "latest" tag at detection time. */
  latest_version: string | null;
  /** Floor below which CodeMantis considers the CLI outdated. */
  min_supported_version: string | null;
  support: CliSupport;
  authenticated: boolean;
  binary_path: string | null;
}

export async function checkClaudeStatus(): Promise<ClaudeStatus> {
  return invoke<ClaudeStatus>("check_claude_status");
}

/** v1.5.0 Phase 1 — per-agent session count over the last `days` days.
 * Powers the Settings → Agents cost-transparency panel. CLI sessions
 * are subscription-billed so this is a count, not a dollar figure. */
export interface AgentUsageEntry {
  agentId: string;
  sessionCount: number;
}

export async function agentUsageBreakdown(days: number): Promise<AgentUsageEntry[]> {
  return invoke<AgentUsageEntry[]>("agent_usage_breakdown", { days });
}

export async function setClaudeBinaryOverride(path: string): Promise<ClaudeStatus> {
  return invoke<ClaudeStatus>("set_claude_binary_override", { path });
}

/**
 * Codex install + auth status (v1.3.1). Returns installed=false when
 * the binary isn't on PATH; returns authenticated=false when it is but
 * `codex login` hasn't been run.
 */
export interface CodexStatus {
  installed: boolean;
  version: string | null;
  parsed_version: string | null;
  binary_path: string | null;
  authenticated: boolean;
}

export async function checkCodexStatus(): Promise<CodexStatus> {
  return invoke<CodexStatus>("check_codex_status");
}

/** Result of an in-app CLI install/update (mirrors Rust `InstallResult`). */
export interface CliInstallResult {
  success: boolean;
  exitCode: number | null;
  message: string;
}

/** One streamed line of install output (mirrors Rust `CliSetupProgressPayload`). */
export interface CliSetupProgress {
  agent: AgentId;
  line: string;
  stream: "stdout" | "stderr";
}

/**
 * Install or update a coding-agent CLI using its official npm-free native
 * installer (no Node/npm required) — the fix for non-developer macOS users who
 * don't have npm. Streams progress via {@link listenCliSetupProgress}; the
 * caller should re-run `checkClaudeStatus` / `checkCodexStatus` afterwards.
 */
export async function installOrUpdateCli(
  agent: AgentId,
  channel?: string,
): Promise<CliInstallResult> {
  return invoke<CliInstallResult>("install_or_update_cli", { agent, channel });
}

/** Subscribe to live install/update output lines. Remember to call the returned
 * unlisten fn on unmount. */
export function listenCliSetupProgress(
  handler: (progress: CliSetupProgress) => void,
): Promise<UnlistenFn> {
  return listen<CliSetupProgress>("cli-setup:progress", (e) => handler(e.payload));
}

// `isLegacyClaudePathActive` (Phase 1 v1.2.0 rollback indicator) removed in
// v1.3.0 / Phase 2 S8 — the v1.2.0 soak surfaced no adapter regressions.

// --- Lifecycle ---

/**
 * Replies to the Rust wake-observer's periodic health-check. Returns the
 * post-increment counter value. See `src-tauri/src/lifecycle/wake_observer.rs`.
 */
export async function wakePong(): Promise<number> {
  return invoke<number>("wake_pong");
}

// --- Session ---

export async function createSession(
  projectPath: string,
  name?: string,
  resumeCliSessionId?: string,
  /** Optional Phase 2 agent picker. Omit to keep the v1.2.0 default (`claude_code`). */
  agentId?: AgentId,
): Promise<Session> {
  return invoke<Session>("create_session", {
    projectPath,
    name,
    resumeCliSessionId,
    agentId,
  });
}

export async function pauseSessionProcess(sessionId: string): Promise<void> {
  return invoke("pause_session_process", { sessionId });
}

export async function resumeSessionProcess(
  sessionId: string,
  cliSessionId?: string | null
): Promise<void> {
  return invoke("resume_session_process", { sessionId, cliSessionId });
}

export async function checkProcessAlive(sessionId: string): Promise<boolean> {
  return invoke("check_process_alive", { sessionId });
}

// --- Codex management (config / MCP / account) via app-server JSON-RPC ---
// Returns are raw JSON Values — callers parse defensively (the Codex
// `config` object is open-ended). On a binary missing a method the backend
// surfaces an error; the panel falls back to codexOpenConfigToml.

export async function codexReadConfig(
  sessionId: string,
  includeLayers = false
): Promise<unknown> {
  return invoke("codex_read_config", { sessionId, includeLayers });
}

export async function codexWriteConfigValue(
  sessionId: string,
  keyPath: string,
  value: unknown,
  mergeStrategy: "replace" | "upsert",
  expectedVersion?: string | null
): Promise<unknown> {
  return invoke("codex_write_config_value", {
    sessionId,
    keyPath,
    value,
    mergeStrategy,
    expectedVersion,
  });
}

export async function codexListMcpStatus(sessionId: string): Promise<unknown> {
  return invoke("codex_list_mcp_status", { sessionId });
}

export async function codexReloadMcp(sessionId: string): Promise<unknown> {
  return invoke("codex_reload_mcp", { sessionId });
}

export async function codexAccount(sessionId: string): Promise<unknown> {
  return invoke("codex_account", { sessionId });
}

export async function codexLogin(
  sessionId: string,
  loginType?: unknown
): Promise<unknown> {
  return invoke("codex_login", { sessionId, loginType });
}

export async function codexLogout(sessionId: string): Promise<unknown> {
  return invoke("codex_logout", { sessionId });
}

export async function codexOpenConfigToml(): Promise<void> {
  return invoke("codex_open_config_toml");
}

// --- SpecWriter CLI Sessions ---

export async function createSpecwriterSession(
  projectPath: string,
  model: string,
  systemPrompt: string,
  /** Phase 2 §10.1: capability dispatch. Codex uses ephemeral AGENTS.override.md. */
  agentId?: AgentId,
): Promise<string> {
  return invoke<string>("create_specwriter_session", {
    projectPath,
    model,
    systemPrompt,
    agentId,
  });
}

export async function closeSpecwriterSession(sessionId: string): Promise<void> {
  return invoke("close_specwriter_session", { sessionId });
}

export async function sendMessage(
  sessionId: string,
  prompt: string
): Promise<void> {
  return invoke("send_message", { sessionId, prompt });
}

export async function setSessionMode(
  sessionId: string,
  mode: string
): Promise<void> {
  return invoke("set_session_mode", { sessionId, mode });
}

export async function syncSessionMode(
  sessionId: string,
  mode: string
): Promise<void> {
  return invoke("sync_session_mode", { sessionId, mode });
}

/**
 * Codex policy (sandbox × approval), spec §6.1. Frontend Policy pill
 * calls this instead of `setSessionMode` on Codex sessions.
 * Wire format is kebab-case to match Rust's serde repr.
 */
export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApproval = "never" | "on-request" | "untrusted";
export interface CodexSessionPolicy {
  sandbox: CodexSandbox;
  approval: CodexApproval;
  network_access: boolean;
}

export async function setCodexPolicy(
  sessionId: string,
  policy: CodexSessionPolicy
): Promise<void> {
  return invoke("set_codex_policy", { sessionId, policy });
}

/**
 * Toggle CodeMantis-native Codex "plan mode". Takes effect on the next
 * `turn/start` (read-only sandbox + planning preamble). Codex-only — Claude
 * uses `setSessionMode("plan")`. See the backend `set_codex_plan_mode`.
 */
export async function setCodexPlanMode(
  sessionId: string,
  enabled: boolean
): Promise<void> {
  return invoke("set_codex_plan_mode", { sessionId, enabled });
}

/**
 * Sentinel returned by `reset_codex_thread` when the session has no live
 * app-server. The caller falls back to a full session restart.
 */
export const RESET_THREAD_NO_LIVE_PROCESS = "NO_LIVE_PROCESS";

/**
 * Start a fresh Codex thread on the session's existing live app-server,
 * abandoning the current (un-compactable) context. Returns the new thread id.
 * The "Recover session" action after a failed compaction. Rejects with
 * `RESET_THREAD_NO_LIVE_PROCESS` when the process is gone. Codex-only.
 */
export async function resetCodexThread(sessionId: string): Promise<string> {
  return invoke<string>("reset_codex_thread", { sessionId });
}

/**
 * Summarize a conversation transcript into a plain-text recap to prime a fresh
 * Codex thread after a failed compaction. Rejects with `"NO_API_KEY"` when no
 * summarizer API key is configured (caller falls back to a local recap).
 */
export async function summarizeConversationForRecap(
  sessionId: string,
  transcript: string
): Promise<string> {
  return invoke<string>("summarize_conversation_for_recap", { sessionId, transcript });
}

/**
 * Mark a Codex session as having hit the compaction deadlock (upstream OpenAI
 * bug). A later Resume reads this to route to a fresh thread + carried context.
 */
export async function markCodexCompactionFailed(sessionId: string): Promise<void> {
  return invoke("mark_codex_compaction_failed", { sessionId });
}

/** Whether a session previously hit the Codex compaction deadlock. */
export async function isCodexCompactionFailed(sessionId: string): Promise<boolean> {
  return invoke<boolean>("is_codex_compaction_failed", { sessionId });
}

export async function resolveToolApproval(
  requestId: string,
  approved: boolean,
  reason?: string
): Promise<void> {
  return invoke("resolve_tool_approval", { requestId, approved, reason });
}

/**
 * Deliver an AskUserQuestion answer. CLI 2.1.126 ignores the PreToolUse
 * hook's reason for AskUserQuestion (always synthesises a denial), so the
 * Rust side resolves the hook AND injects `answer` as a normal user message
 * — that's the only path that actually surfaces the answer to Claude.
 */
export async function submitQuestionAnswer(
  sessionId: string,
  requestId: string,
  answer: string,
  /** Codex-only structured payload (v1.4.1 Phase A.5). When the
   * PendingQuestion came from Codex's `item/tool/requestUserInput`, the
   * QuestionModal collects per-question answers and passes them as a
   * map `{ [questionId]: string[] }`. The Rust side wraps each into
   * `{ answers: string[] }` and routes via `respond_to_approval`. Omit
   * for Claude AskUserQuestion sessions — the existing chat-message
   * injection path runs unchanged. */
  structuredAnswers?: Record<string, string[]>
): Promise<void> {
  return invoke("submit_question_answer", {
    sessionId,
    requestId,
    answer,
    structuredAnswers,
  });
}

export async function closeSession(sessionId: string): Promise<void> {
  return invoke("close_session", { sessionId });
}

export async function getSession(sessionId: string): Promise<Session> {
  return invoke<Session>("get_session", { sessionId });
}

export async function listSessions(): Promise<Session[]> {
  return invoke<Session[]>("list_sessions");
}

export async function renameSession(
  sessionId: string,
  newName: string
): Promise<void> {
  return invoke("rename_session", { sessionId, newName });
}

export async function listPersistedSessions(): Promise<PersistedSession[]> {
  return invoke<PersistedSession[]>("list_persisted_sessions");
}

export async function deletePersistedSession(
  sessionId: string
): Promise<void> {
  return invoke("delete_persisted_session", { sessionId });
}

export async function interruptSession(sessionId: string): Promise<void> {
  return invoke("interrupt_session", { sessionId });
}

export async function setSessionModel(sessionId: string, model: string): Promise<void> {
  return invoke("set_session_model", { sessionId, model });
}

/** Update reasoning effort on a live session.
 * Codex applies on the next turn (mutex update + EffortChanged emit);
 * Claude's `--effort` is spawn-time only, so the EffortSelector handles
 * Claude via pause+resume and only calls this for Codex sessions. */
export async function setSessionEffort(sessionId: string, effort: string): Promise<void> {
  return invoke("set_session_effort", { sessionId, effort });
}

export async function initializeSession(sessionId: string): Promise<void> {
  return invoke("initialize_session", { sessionId });
}

export async function listSessionHistory(
  projectPath: string
): Promise<SessionHistoryEntry[]> {
  return invoke<SessionHistoryEntry[]>("list_session_history", { projectPath });
}

export async function listRecentSessions(
  limit: number
): Promise<SessionHistoryEntry[]> {
  return invoke<SessionHistoryEntry[]>("list_recent_sessions", { limit });
}

/**
 * Returns the sessions whose `was_open` flag is still set in SQLite — meaning
 * the previous shutdown did not run the graceful drain. The frontend uses
 * these on launch to redraw paused-recovered tabs. Empty array == clean exit.
 */
export async function listCrashedSessions(): Promise<SessionHistoryEntry[]> {
  return invoke<SessionHistoryEntry[]>("list_crashed_sessions");
}

/**
 * Clears `was_open` for the given session IDs. Called once after the frontend
 * has rendered the paused-recovered tabs so we don't re-list the same crash on
 * subsequent launches.
 */
export async function acknowledgeCrashedSessions(
  sessionIds: string[]
): Promise<void> {
  return invoke("acknowledge_crashed_sessions", { sessionIds });
}

/**
 * Read-once: returns `true` when the previous frontend was reloaded by the
 * Rust wake observer (its last-resort `WebviewWindow::reload()` path) rather
 * than by a real cold start. The Rust backend (and per-session CLI subprocesses)
 * is still alive in this case, so the boot path should re-attach via
 * {@link listLiveSessions} instead of routing every session through the
 * Resume list. Clears the flag on read — `false` from then on for this boot.
 */
export async function consumeWakeRecoveryFlag(): Promise<boolean> {
  return invoke<boolean>("consume_wake_recovery_flag");
}

/**
 * Returns the `Session`s whose CLI subprocess is still alive in
 * `AppState.processes`. Used post-wake-recovery-reload so the frontend can
 * re-attach session-keyed event listeners (`claude-chat-<id>` / `codex-chat-<id>`)
 * without re-spawning the CLI via `--resume`. Sessions whose process has
 * died in the meantime are filtered out — they'll surface via
 * {@link listCrashedSessions} instead.
 */
export async function listLiveSessions(): Promise<Session[]> {
  return invoke<Session[]>("list_live_sessions");
}

export async function saveSessionMessages(
  sessionId: string,
  messages: SessionMessagePayload[]
): Promise<void> {
  return invoke("save_session_messages", { sessionId, messages });
}

/**
 * Snapshot-tick reconciliation: promote a session whose tab is gone from the
 * workspace (so its in-memory status is "Closed") but whose row on disk is
 * still in a non-terminal state. Resolves to `true` if a row was actually
 * promoted, `false` if it was already closed/errored. Safe to call repeatedly.
 */
export async function markSessionClosedIfStale(
  sessionId: string,
  closedAt: string
): Promise<boolean> {
  return invoke<boolean>("mark_session_closed_if_stale", { sessionId, closedAt });
}

export async function loadSessionMessages(
  sessionId: string
): Promise<SessionMessagePayload[]> {
  return invoke<SessionMessagePayload[]>("load_session_messages", { sessionId });
}

export async function searchSessionMessages(
  projectPath: string,
  query: string
): Promise<SessionMessageSearchResult[]> {
  return invoke<SessionMessageSearchResult[]>("search_session_messages", { projectPath, query });
}

// --- Help ---

export async function readUserGuide(): Promise<string> {
  return invoke<string>("read_user_guide");
}

// --- Files ---

export async function readFileTree(rootPath: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("read_file_tree", { rootPath });
}

export async function readFileContent(filePath: string): Promise<string> {
  return invoke<string>("read_file_content", { filePath });
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
  return invoke("write_file_content", { filePath, content });
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  return invoke("rename_file", { oldPath, newPath });
}

export async function deleteFile(filePath: string): Promise<void> {
  return invoke("delete_file", { filePath });
}

export async function duplicateFile(filePath: string): Promise<string> {
  return invoke<string>("duplicate_file", { filePath });
}

export async function createFile(filePath: string): Promise<void> {
  return invoke("create_file", { filePath });
}

export async function createDirectory(dirPath: string): Promise<void> {
  return invoke("create_directory", { dirPath });
}

// --- Attachments ---

export interface AttachmentInfo {
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  is_image: boolean;
}

export async function readFileBytes(
  filePath: string
): Promise<number[]> {
  return invoke<number[]>("read_file_bytes", { filePath });
}

export async function saveClipboardImage(
  projectPath: string,
  imageData: number[],
  filename: string
): Promise<AttachmentInfo> {
  return invoke<AttachmentInfo>("save_clipboard_image", {
    projectPath,
    imageData,
    filename,
  });
}

export async function getFileInfo(filePath: string): Promise<AttachmentInfo> {
  return invoke<AttachmentInfo>("get_file_info", { filePath });
}

export async function cleanupOldAttachments(
  projectPath: string,
  maxAgeDays: number
): Promise<number> {
  return invoke<number>("cleanup_old_attachments", { projectPath, maxAgeDays });
}

// --- Terminal ---

export interface TerminalInfo {
  id: string;
  session_id: string;
  name: string;
}

export async function createTerminal(
  sessionId: string,
  cwd: string,
  shell?: string,
  name?: string,
  args?: string[]
): Promise<TerminalInfo> {
  return invoke<TerminalInfo>("create_terminal", {
    sessionId,
    cwd,
    shell,
    name,
    args,
  });
}

export async function sendTerminalInput(
  terminalId: string,
  data: string
): Promise<void> {
  return invoke("send_terminal_input", { terminalId, data });
}

export async function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke("resize_terminal", { terminalId, cols, rows });
}

export async function closeTerminal(terminalId: string): Promise<void> {
  return invoke("close_terminal", { terminalId });
}

export async function listTerminals(sessionId: string): Promise<string[]> {
  return invoke<string[]>("list_terminals", { sessionId });
}

export function listenTerminalOutput(
  terminalId: string,
  callback: (data: string) => void
): Promise<UnlistenFn> {
  return listen<string>(`terminal-output-${terminalId}`, (e) =>
    callback(e.payload)
  );
}

// --- Settings ---

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function updateSettings(settings: AppSettings): Promise<void> {
  return invoke("update_settings", { settings });
}

// --- Changelog ---

export async function generateChangelogEntry(
  sessionId: string,
  userPrompt: string,
  assistantSummary: string,
  toolsUsed: string[],
  sessionMode: string
): Promise<ChangelogEntry> {
  return invoke<ChangelogEntry>("generate_changelog_entry", {
    sessionId,
    userPrompt,
    assistantSummary,
    toolsUsed,
    sessionMode,
  });
}

export async function getChangelogEntries(
  sessionId: string
): Promise<ChangelogEntry[]> {
  return invoke<ChangelogEntry[]>("get_changelog_entries", { sessionId });
}

export async function getProjectChangelogEntries(
  projectPath: string
): Promise<ProjectChangelogEntry[]> {
  return invoke<ProjectChangelogEntry[]>("get_project_changelog_entries", { projectPath });
}

export async function deleteChangelogEntry(entryId: string): Promise<void> {
  return invoke("delete_changelog_entry", { entryId });
}

export async function testChangelogApiKey(
  provider: string,
  apiKey: string,
  model: string
): Promise<boolean> {
  return invoke<boolean>("test_changelog_api_key", { provider, apiKey, model });
}

// --- OpenRouter ---

export interface OpenRouterModelResult {
  id: string;
  name: string;
  isFree: boolean;
  inputModalities: string[];
  outputModalities: string[];
  contextLength: number;
  pricingInput: number;
  pricingOutput: number;
}

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModelResult[]> {
  return invoke<OpenRouterModelResult[]>("fetch_openrouter_models", { apiKey });
}

export async function testOpenRouterKey(apiKey: string): Promise<boolean> {
  return invoke<boolean>("test_openrouter_key", { apiKey });
}

// --- API Logs ---

export async function getApiLogs(): Promise<ApiLogEntry[]> {
  return invoke<ApiLogEntry[]>("get_api_logs");
}

export async function getApiCostSummary(): Promise<ApiCostSummary> {
  return invoke<ApiCostSummary>("get_api_cost_summary");
}

export async function cleanupApiLogs(maxAgeDays: number): Promise<number> {
  return invoke<number>("cleanup_api_logs", { maxAgeDays });
}

// --- Assistant Chat (API providers) ---

export interface AssistantStreamEvent {
  type: "delta" | "done" | "error" | "cancelled";
  text?: string;
  content?: string;
  inputTokens?: number;
  outputTokens?: number;
  message?: string;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mime_type: string; data: string }
  | { type: "document"; mime_type: string; data: string };

export async function sendAssistantChat(params: {
  assistantId: string;
  provider: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: string; content: string | ContentPart[] }[];
  maxTokens?: number;
}): Promise<void> {
  return invoke("send_assistant_chat", params);
}

export async function listenAssistantStream(
  assistantId: string,
  handler: (event: AssistantStreamEvent) => void,
): Promise<UnlistenFn> {
  return listen<AssistantStreamEvent>(`assistant-stream-${assistantId}`, (e) => handler(e.payload));
}

export async function cancelAssistantChat(assistantId: string): Promise<void> {
  return invoke("cancel_assistant_chat", { assistantId });
}

// --- Git ---

export async function getGitStatus(projectPath: string): Promise<GitStatusInfo> {
  return invoke<GitStatusInfo>("get_git_status", { projectPath });
}

export async function getGitLog(projectPath: string, maxCommits: number): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("get_git_log", { projectPath, maxCommits });
}

export async function getGitDiff(projectPath: string): Promise<GitDiffResult> {
  return invoke<GitDiffResult>("get_git_diff", { projectPath });
}

// --- Branch Map (rich git graph + branch ops) ---

export async function getBranchGraph(
  projectPath: string,
  maxCommits: number,
): Promise<BranchGraph> {
  return invoke<BranchGraph>("get_branch_graph", { projectPath, maxCommits });
}

export async function listBranches(projectPath: string): Promise<BranchRef[]> {
  return invoke<BranchRef[]>("list_branches", { projectPath });
}

export async function getUpstreamStatus(projectPath: string): Promise<UpstreamStatus> {
  return invoke<UpstreamStatus>("get_upstream_status", { projectPath });
}

export async function getConflictState(projectPath: string): Promise<ConflictState> {
  return invoke<ConflictState>("get_conflict_state", { projectPath });
}

// Write ops — each rejects with a GitOpError on failure.

export async function createBranch(
  projectPath: string,
  name: string,
  fromRef: string | null,
  checkout: boolean,
): Promise<GitOpResult> {
  return invoke<GitOpResult>("create_branch", { projectPath, name, fromRef, checkout });
}

export async function switchBranch(projectPath: string, name: string): Promise<GitOpResult> {
  return invoke<GitOpResult>("switch_branch", { projectPath, name });
}

export async function switchBranchPreview(
  projectPath: string,
  name: string,
): Promise<SwitchPreview> {
  return invoke<SwitchPreview>("switch_branch_preview", { projectPath, name });
}

export async function gitCommit(projectPath: string, message: string): Promise<GitOpResult> {
  return invoke<GitOpResult>("git_commit", { projectPath, message });
}

export async function deleteBranch(
  projectPath: string,
  name: string,
  force: boolean,
): Promise<GitOpResult> {
  return invoke<GitOpResult>("delete_branch", { projectPath, name, force });
}

export async function deleteBranchPreview(
  projectPath: string,
  name: string,
): Promise<DeletePreview> {
  return invoke<DeletePreview>("delete_branch_preview", { projectPath, name });
}

export async function mergeBranch(projectPath: string, source: string): Promise<GitOpResult> {
  return invoke<GitOpResult>("merge_branch", { projectPath, source });
}

export async function mergeBranchPreview(
  projectPath: string,
  source: string,
): Promise<MergePreview> {
  return invoke<MergePreview>("merge_branch_preview", { projectPath, source });
}

export async function abortMerge(projectPath: string): Promise<GitOpResult> {
  return invoke<GitOpResult>("abort_merge", { projectPath });
}

export async function gitPull(projectPath: string): Promise<GitOpResult> {
  return invoke<GitOpResult>("git_pull", { projectPath });
}

export async function gitPush(projectPath: string): Promise<GitOpResult> {
  return invoke<GitOpResult>("git_push", { projectPath });
}

export async function gitPushPreview(projectPath: string): Promise<PushPreview> {
  return invoke<PushPreview>("git_push_preview", { projectPath });
}

export async function publishBranch(projectPath: string): Promise<GitOpResult> {
  return invoke<GitOpResult>("publish_branch", { projectPath });
}

export async function undoGitOp(projectPath: string, token: UndoToken): Promise<GitOpResult> {
  return invoke<GitOpResult>("undo_git_op", { projectPath, token });
}

// --- Slash Commands ---

export async function discoverCommands(
  projectPath: string,
  /** v1.5.0 — agent-aware discovery. Codex sessions get `.codex/prompts`
   * + built-ins; Claude sessions get `.claude/{commands,skills}` +
   * built-ins + Claude's CLI commands. Omit → defaults to claude_code. */
  agentId?: AgentId,
): Promise<SlashCommand[]> {
  return invoke<SlashCommand[]>("discover_commands", { projectPath, agentId });
}

export async function expandSkill(
  projectPath: string,
  sourcePath: string,
  arguments_: string,
  cliSessionId: string
): Promise<ExpandedSkill> {
  return invoke<ExpandedSkill>("expand_skill", {
    projectPath,
    sourcePath,
    arguments: arguments_,
    cliSessionId,
  });
}

export async function runOneshotCommand(
  projectPath: string,
  args: string[]
): Promise<OneshotResult> {
  return invoke<OneshotResult>("run_oneshot_command", { projectPath, args });
}

// --- MCP Servers ---

export async function getMcpServers(projectPath?: string): Promise<McpServerConfig[]> {
  return invoke<McpServerConfig[]>("get_mcp_servers", { projectPath });
}

export async function saveMcpServer(
  projectPath: string | null,
  server: McpServerConfig
): Promise<void> {
  return invoke("save_mcp_server", { projectPath, server });
}

export async function deleteMcpServer(
  projectPath: string | null,
  name: string,
  scope: string
): Promise<void> {
  return invoke("delete_mcp_server", { projectPath, name, scope });
}

export async function renameMcpServer(
  projectPath: string | null,
  oldName: string,
  newName: string,
  scope: string
): Promise<void> {
  return invoke("rename_mcp_server", { projectPath, oldName, newName, scope });
}

export async function getMcpConfigPath(scope: string, projectPath?: string): Promise<string> {
  return invoke<string>("get_mcp_config_path", { scope, projectPath });
}

// --- Scaffold ---

export async function listTemplates(): Promise<TemplateEntry[]> {
  return invoke<TemplateEntry[]>("list_templates");
}

export async function checkTemplatePrerequisites(
  checks: readonly PrerequisiteCheck[]
): Promise<PrerequisiteResult[]> {
  return invoke<PrerequisiteResult[]>("check_template_prerequisites", { checks });
}

export async function installPrerequisite(
  command: string
): Promise<InstallPrerequisiteResult> {
  return invoke<InstallPrerequisiteResult>("install_prerequisite", { command });
}

export async function scaffoldFromTemplate(
  templateId: string,
  projectPath: string,
  projectName: string
): Promise<ScaffoldResult> {
  return invoke<ScaffoldResult>("scaffold_from_template", {
    templateId,
    projectPath,
    projectName,
  });
}

export async function scaffoldFromCli(
  templateId: string,
  cliCommand: string,
  projectPath: string,
  projectName: string,
  postCommands: string[]
): Promise<ScaffoldResult> {
  return invoke<ScaffoldResult>("scaffold_from_cli", {
    templateId,
    cliCommand,
    projectPath,
    projectName,
    postCommands,
  });
}

export async function verifyTemplate(
  templateId: string
): Promise<VerifyResult> {
  return invoke<VerifyResult>("verify_template", { templateId });
}

export function listenScaffoldProgress(
  callback: (event: ScaffoldProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<ScaffoldProgressEvent>("scaffold-progress", (e) =>
    callback(e.payload)
  );
}

// --- Clone from Git ---

export async function cloneFromGit(
  repoUrl: string,
  projectPath: string,
  projectName: string,
  installDeps: boolean,
  generateClaudeMd: boolean,
): Promise<ScaffoldResult> {
  return invoke<ScaffoldResult>("clone_from_git", {
    repoUrl,
    projectPath,
    projectName,
    installDeps,
    generateClaudeMd,
  });
}

// --- CLAUDE.md Generation ---

export async function analyzeProject(
  projectPath: string,
): Promise<ProjectAnalysis> {
  return invoke<ProjectAnalysis>("analyze_project_cmd", { projectPath });
}

export async function generateClaudeMd(
  projectPath: string,
): Promise<string> {
  return invoke<string>("generate_claude_md_cmd", { projectPath });
}

// --- Preview ---

export async function openPreviewWindow(
  url: string,
  projectName: string,
  projectPath: string,
  width?: number,
  height?: number,
): Promise<void> {
  return invoke("open_preview_window", { url, projectName, projectPath, width, height });
}

export async function closePreviewWindow(): Promise<void> {
  return invoke("close_preview_window");
}

export async function navigatePreview(url: string): Promise<void> {
  return invoke("navigate_preview", { url });
}

export async function refreshPreview(): Promise<void> {
  return invoke("refresh_preview");
}

export async function focusPreviewWindow(): Promise<boolean> {
  return invoke<boolean>("focus_preview_window");
}

export interface DevServerInfo {
  terminal_id: string;
  synthetic_session_id: string;
  port: number | null;
  url: string | null;
  status: string;
}

export async function startDevServer(
  projectPath: string,
  devCommand: string | null,
  devPort: number | null,
): Promise<string> {
  return invoke<string>("start_dev_server", { projectPath, devCommand, devPort });
}

export async function stopDevServer(projectPath: string): Promise<void> {
  return invoke("stop_dev_server", { projectPath });
}

export async function getDevServerStatus(
  projectPath: string,
): Promise<DevServerInfo | null> {
  return invoke<DevServerInfo | null>("get_dev_server_status", { projectPath });
}

// --- Event Listeners ---

/**
 * Subscribe to chat-channel events for a session. v1.3.1: subscribes to
 * BOTH `claude-chat-*` and `codex-chat-*` (one of the two will be the
 * actual emit channel; the other is a no-op). Cheap because Tauri's
 * `listen` is just a name match — unmatched channels never fire.
 *
 * Why both rather than agent-specific: the caller (useClaudeSession)
 * doesn't always have the agent id at attach time (resume-from-history
 * flows construct the listener before SessionInfo lands). Subscribing
 * to both is safer than guessing.
 */
export async function listenChatEvents(
  sessionId: string,
  callback: (event: FrontendEvent) => void
): Promise<UnlistenFn> {
  const handler = (e: { payload: FrontendEvent }): void => callback(e.payload);
  const [unA, unB] = await Promise.all([
    listen<FrontendEvent>(`claude-chat-${sessionId}`, handler),
    listen<FrontendEvent>(`codex-chat-${sessionId}`, handler),
  ]);
  return (() => {
    unA();
    unB();
  }) as UnlistenFn;
}

export async function listenActivityEvents(
  sessionId: string,
  callback: (event: FrontendEvent) => void
): Promise<UnlistenFn> {
  const handler = (e: { payload: FrontendEvent }): void => callback(e.payload);
  const [unA, unB] = await Promise.all([
    listen<FrontendEvent>(`claude-activity-${sessionId}`, handler),
    listen<FrontendEvent>(`codex-activity-${sessionId}`, handler),
  ]);
  return (() => {
    unA();
    unB();
  }) as UnlistenFn;
}

export function listenToolApprovalRequests(
  callback: (event: ToolApprovalRequestEvent) => void
): Promise<UnlistenFn> {
  return listen<ToolApprovalRequestEvent>("tool-approval-request", (e) =>
    callback(e.payload)
  );
}

export function listenSessionModeChanged(
  callback: (event: { sessionId: string; mode: string }) => void
): Promise<UnlistenFn> {
  return listen<{ sessionId: string; mode: string }>("session-mode-changed", (e) =>
    callback(e.payload)
  );
}

// --- Dev Server Detection ---

export interface DevServerDetectedPayload {
  terminalId: string;
  sessionId: string;
  port: number;
  url: string;
}

/**
 * Why the dev-server PTY closed:
 * - `"shutdown_requested"` — CodeMantis asked it to stop (Stop button, or
 *   `start_dev_server` cleaning up stale state before re-spawning).  Not a
 *   crash; UI should not surface a "process exited" error.
 * - `"pty_eof"` — child process exited on its own; usually a real crash or
 *   port conflict the user should see.
 * - `"pty_error"` — read error on the PTY; rare, treat as a crash.
 */
export type DevServerCloseReason =
  | "shutdown_requested"
  | "pty_eof"
  | "pty_error";

export interface DevServerClosedPayload {
  terminalId: string;
  sessionId: string;
  reason: DevServerCloseReason;
}

export function listenDevServerDetected(
  callback: (event: DevServerDetectedPayload) => void
): Promise<UnlistenFn> {
  return listen<DevServerDetectedPayload>("dev-server-detected", (e) =>
    callback(e.payload)
  );
}

export function listenDevServerClosed(
  callback: (event: DevServerClosedPayload) => void
): Promise<UnlistenFn> {
  return listen<DevServerClosedPayload>("dev-server-closed", (e) =>
    callback(e.payload)
  );
}

// --- SpecWriter ---

export async function saveTaskBoardState(
  projectPath: string,
  stateJson: string,
): Promise<void> {
  return invoke("save_task_board_state", { projectPath, stateJson });
}

export async function loadTaskBoardState(
  projectPath: string,
): Promise<string | null> {
  return invoke<string | null>("load_task_board_state", { projectPath });
}

export async function deleteTaskPlanById(planId: string): Promise<void> {
  return invoke("delete_task_plan_cmd", { planId });
}

export async function archiveTaskPlan(planId: string): Promise<void> {
  return invoke("archive_task_plan_cmd", { planId });
}

export async function saveSpecDocument(
  projectPath: string,
  filename: string,
  content: string,
  overwrite: boolean,
): Promise<string> {
  return invoke<string>("save_spec_document", { projectPath, filename, content, overwrite });
}

export async function listSpecDocuments(
  projectPath: string,
): Promise<import("../types/spec-writer").SpecDocumentInfo[]> {
  return invoke("list_spec_documents", { projectPath });
}

export async function readSpecDocument(
  projectPath: string,
  filename: string,
): Promise<string> {
  return invoke<string>("read_spec_document", { projectPath, filename });
}

export async function deleteSpecDocument(
  projectPath: string,
  filename: string,
): Promise<void> {
  return invoke("delete_spec_document", { projectPath, filename });
}

export async function gatherSpecContext(
  projectPath: string,
): Promise<string> {
  return invoke<string>("gather_spec_context", { projectPath });
}

// ── Phase 0 project capability probe ────────────────────────────────────
//
// See plan: ~/.claude/plans/analyse-this-why-refactored-yao.md
// SpecWriter calls `probeProjectCapabilities` on context load, persists the
// result via `writeProjectCapabilities`, and renders it into the system
// prompt's `## Capabilities` section. Self-Drive verify-mode reads the same
// record via `readProjectCapabilities` to decide what evidence to demand.

export async function probeProjectCapabilities(
  projectPath: string,
): Promise<import("../types/spec-writer").ProjectCapabilitiesRecord> {
  return invoke("probe_project_capabilities", { projectPath });
}

export async function readProjectCapabilities(
  projectPath: string,
): Promise<import("../types/spec-writer").ProjectCapabilitiesRecord | null> {
  return invoke("read_project_capabilities", { projectPath });
}

export async function writeProjectCapabilities(
  projectPath: string,
  record: import("../types/spec-writer").ProjectCapabilitiesRecord,
): Promise<void> {
  return invoke("write_project_capabilities", { projectPath, record });
}

export async function liveFireCapabilities(
  projectPath: string,
  capabilityIds: string[],
): Promise<import("../types/spec-writer").ProbedCapability[]> {
  return invoke("live_fire_capabilities", { projectPath, capabilityIds });
}

export async function readProjectFiles(
  projectPath: string,
  filePaths: string[],
  maxLines?: number,
): Promise<import("../types/spec-writer").FileReadResult[]> {
  return invoke("read_project_files", { projectPath, filePaths, maxLines });
}

export async function addVerificationWorkflowToClaudeMd(
  projectPath: string,
): Promise<string> {
  return invoke<string>("add_verification_workflow_to_claude_md", { projectPath });
}

// ── Cross-system action parity (the "mock-only PASS" gate) ────────────

export interface ActionParityRequest {
  action: string;
  /**
   * Single caller path (legacy). Either this or `callerPaths` (preferred)
   * must carry the search location; both being set is fine — Rust unions
   * them. Passing `""` is treated as unset.
   */
  callerPath: string;
  /**
   * Multiple caller paths. The action/wire string is considered found if
   * it appears in ANY listed path (file or directory). Self-Drive
   * populates this with every distinct directory across the session's
   * declared files so the gate doesn't false-positive when the call site
   * lives in a sibling directory.
   */
  callerPaths?: string[];
  handlerPath: string;
  /**
   * Optional on-the-wire identifier when it differs from `action` — e.g.
   * the JS function is `resolveCheckpoint` but the URL slug / edge-function
   * name is `hitl-respond`. Rust uses this as the grep needle when set
   * (non-empty); otherwise it falls back to `action`.
   */
  wire?: string;
}

export interface ActionParityResult {
  action: string;
  callerPresent: boolean;
  handlerPresent: boolean;
  handlerStubFree: boolean;
  /** "PASS" iff caller + handler both present AND handler stub-free. */
  status: "PASS" | "FAIL";
  detail: string;
}

export async function verifyActionParity(
  projectRoot: string,
  actions: ActionParityRequest[],
): Promise<ActionParityResult[]> {
  return invoke<ActionParityResult[]>("verify_action_parity", {
    projectRoot,
    actions,
  });
}

export async function gatherProjectSnapshot(
  projectPath: string,
): Promise<string> {
  return invoke<string>("gather_project_snapshot", { projectPath });
}

export async function capturePreviewScreenshot(): Promise<string> {
  return invoke<string>("capture_preview_screenshot");
}

export async function getPreviewConsoleLogs(
  projectPath: string,
): Promise<{ level: string; ts: string; msg: string; url: string; stack?: string }[]> {
  return invoke("get_preview_console_logs", { projectPath });
}

export function listenPreviewConsoleEntry(
  callback: (entry: { level: string; ts: string; msg: string; url: string; stack?: string }) => void,
): Promise<UnlistenFn> {
  return listen("preview-console-entry", (e: { payload: { level: string; ts: string; msg: string; url: string; stack?: string } }) => callback(e.payload));
}

// ── Implementation Guides ───────────────────────────────────────────

export interface GuidePayload {
  id: string;
  dataJson: string;
}

export async function saveGuide(
  projectPath: string,
  dataJson: string,
): Promise<string> {
  return invoke<string>("save_guide", { projectPath, dataJson });
}

export async function loadGuide(
  projectPath: string,
): Promise<GuidePayload | null> {
  return invoke<GuidePayload | null>("load_guide", { projectPath });
}

export async function updateGuideData(
  guideId: string,
  dataJson: string,
): Promise<void> {
  return invoke("update_guide_data", { guideId, dataJson });
}

export async function deleteGuide(guideId: string): Promise<void> {
  return invoke("delete_guide_cmd", { guideId });
}

export async function deleteGuidesForProject(
  projectPath: string,
): Promise<void> {
  return invoke("delete_guides_for_project_cmd", { projectPath });
}

// ── Self-Drive Run State (restart recovery) ─────────────────────────

export interface SelfDriveStatePayload {
  projectPath: string;
  dataJson: string;
}

export async function saveSelfDriveState(
  projectPath: string,
  dataJson: string,
): Promise<void> {
  return invoke("save_self_drive_state", { projectPath, dataJson });
}

export async function loadSelfDriveState(
  projectPath: string,
): Promise<string | null> {
  return invoke<string | null>("load_self_drive_state", { projectPath });
}

export async function listSelfDriveStates(): Promise<SelfDriveStatePayload[]> {
  return invoke<SelfDriveStatePayload[]>("list_self_drive_states");
}

export async function deleteSelfDriveState(
  projectPath: string,
): Promise<void> {
  return invoke("delete_self_drive_state", { projectPath });
}

// ── Super-Bro ────────────────────────────────────────────────────────

export interface ObservationPayload {
  id: string;
  projectPath: string;
  text: string;
  category: string;
  createdAt: string;
  lastReferencedAt: string;
}

export async function saveObservation(
  id: string,
  projectPath: string,
  text: string,
  category: string,
  createdAt: string,
  lastReferencedAt: string,
): Promise<void> {
  return invoke("save_observation", {
    id,
    projectPath,
    text,
    category,
    createdAt,
    lastReferencedAt,
  });
}

export async function loadObservations(
  projectPath: string,
): Promise<ObservationPayload[]> {
  return invoke<ObservationPayload[]>("load_observations", { projectPath });
}

export async function deleteObservation(id: string): Promise<void> {
  return invoke("delete_observation", { id });
}

// --- Duo-Coding ---

export async function duoStartRun(
  id: string,
  primarySessionId: string,
  duoSessionId: string,
  projectPath: string,
  configJson: string,
): Promise<void> {
  return invoke("duo_start_run", {
    id,
    primarySessionId,
    duoSessionId,
    projectPath,
    configJson,
  });
}

export async function duoCompleteRun(
  id: string,
  status: string,
  outcome?: string,
): Promise<void> {
  return invoke("duo_complete_run", { id, status, outcome });
}

export async function duoGetRun(id: string): Promise<DuoRunRow | null> {
  return invoke<DuoRunRow | null>("duo_get_run", { id });
}

export async function duoListRuns(projectPath: string): Promise<DuoRunRow[]> {
  return invoke<DuoRunRow[]>("duo_list_runs", { projectPath });
}

export async function duoRecordEvent(
  id: string,
  runId: string,
  kind: string,
  actor: string,
  payloadJson: string,
  diffStatsJson?: string,
): Promise<void> {
  return invoke("duo_record_event", {
    id,
    runId,
    kind,
    actor,
    payloadJson,
    diffStatsJson,
  });
}

export async function duoListEvents(runId: string): Promise<DuoEventRow[]> {
  return invoke<DuoEventRow[]>("duo_list_events", { runId });
}

export async function duoRecordSnapshot(
  id: string,
  runId: string,
  narrative: string,
  metricsJson: string,
  seriesJson: string,
): Promise<void> {
  return invoke("duo_record_snapshot", {
    id,
    runId,
    narrative,
    metricsJson,
    seriesJson,
  });
}

export async function duoLatestSnapshot(
  runId: string,
): Promise<DuoSnapshotRow | null> {
  return invoke<DuoSnapshotRow | null>("duo_latest_snapshot", { runId });
}

export async function duoAnalyze(runId: string): Promise<DuoAnalystReport> {
  return invoke<DuoAnalystReport>("duo_analyze", { runId });
}

export async function duoLogCompletion(
  runId: string,
  outcome: string,
): Promise<void> {
  return invoke("duo_log_completion", { runId, outcome });
}

/** Reconcile Duo runs left running by a crash/restart; returns the interrupted runs. */
export async function duoRecoverInterrupted(): Promise<DuoRunRow[]> {
  return invoke<DuoRunRow[]>("duo_recover_interrupted");
}

/** Subscribe to backend-produced analyst snapshots (`duo:snapshot`). */
export async function listenDuoSnapshot(
  callback: (event: DuoSnapshotEvent) => void,
): Promise<UnlistenFn> {
  return listen<DuoSnapshotEvent>("duo:snapshot", ({ payload }) =>
    callback(payload),
  );
}

export async function readSuperBroModule(
  moduleName: string,
): Promise<string> {
  return invoke<string>("read_super_bro_module", { moduleName });
}

// ── Menu ────────────────────────────────────────────────────────────

export async function enableUpdateMenuItem(version: string): Promise<void> {
  return invoke("enable_update_menu_item", { version });
}

export async function disableUpdateMenuItem(): Promise<void> {
  return invoke("disable_update_menu_item");
}

export function listenOpenUpdateModal(
  callback: () => void,
): Promise<UnlistenFn> {
  return listen<void>("open-update-modal", () => callback());
}

// ── Preflight System ──

export async function preflightLoadManifest(projectPath: string): Promise<Manifest> {
  return invoke<Manifest>("preflight_load_manifest", { projectPath });
}

export async function preflightStatus(projectPath: string): Promise<PreflightStatus> {
  return invoke<PreflightStatus>("preflight_status", { projectPath });
}

export async function preflightVerifyOne(
  projectPath: string,
  capabilityId: string,
): Promise<CapabilityStatus> {
  return invoke<CapabilityStatus>("preflight_verify_one", {
    projectPath,
    capabilityId,
  });
}

export async function preflightVerifyAll(
  projectPath: string,
): Promise<CapabilityStatus[]> {
  return invoke<CapabilityStatus[]>("preflight_verify_all", { projectPath });
}

export async function preflightAcknowledgeSkip(
  projectPath: string,
  capabilityId: string,
): Promise<CapabilityStatus> {
  return invoke<CapabilityStatus>("preflight_acknowledge_skip", {
    projectPath,
    capabilityId,
  });
}

export async function preflightStoreSecret(
  projectPath: string,
  capabilityId: string,
  value: string,
): Promise<void> {
  return invoke("preflight_store_secret", { projectPath, capabilityId, value });
}

export async function preflightRunAutoInstall(
  projectPath: string,
  capabilityId: string,
): Promise<InstallResult> {
  return invoke<InstallResult>("preflight_run_auto_install", {
    projectPath,
    capabilityId,
  });
}

export async function preflightDetectExisting(
  projectPath: string,
): Promise<DetectionHit[]> {
  return invoke<DetectionHit[]>("preflight_detect_existing", { projectPath });
}

export async function preflightGenerateManifest(
  request: ExtractionRequest,
): Promise<ExtractionResult> {
  return invoke<ExtractionResult>("preflight_generate_manifest", { request });
}

// ── Recall (Phase 5) ────────────────────────────────────────────────

import type {
  RecallEnrichmentRow,
  RecallHarvestRow,
  RecallHealth,
  RecallIndexedNote,
  RecallReindexResponse,
  RecallSeedResponse,
  RecallStatusResponse,
} from "../types/recall";

export async function recallStatus(
  projectPath: string,
): Promise<RecallStatusResponse> {
  return invoke<RecallStatusResponse>("recall_status", { projectPath });
}

export async function recallReindex(
  projectPath: string,
): Promise<RecallReindexResponse> {
  return invoke<RecallReindexResponse>("recall_reindex", { projectPath });
}

export async function recallGetEnrichments(
  projectPath: string,
  limit?: number,
): Promise<RecallEnrichmentRow[]> {
  return invoke<RecallEnrichmentRow[]>("recall_get_enrichments", {
    projectPath,
    limit: limit ?? null,
  });
}

export async function recallGetHarvests(
  projectPath: string,
  limit?: number,
): Promise<RecallHarvestRow[]> {
  return invoke<RecallHarvestRow[]>("recall_get_harvests", {
    projectPath,
    limit: limit ?? null,
  });
}

export async function recallGetNotesForPaths(
  projectPath: string,
  paths: string[],
): Promise<RecallIndexedNote[]> {
  return invoke<RecallIndexedNote[]>("recall_get_notes_for_paths", {
    projectPath,
    paths,
  });
}

export async function recallGetHealth(
  projectPath: string,
): Promise<RecallHealth> {
  return invoke<RecallHealth>("recall_get_health", { projectPath });
}

export async function recallOpenVault(projectPath: string): Promise<void> {
  return invoke<void>("recall_open_vault", { projectPath });
}

export async function recallForceSeed(
  projectPath: string,
): Promise<RecallSeedResponse> {
  return invoke<RecallSeedResponse>("recall_force_seed", { projectPath });
}
