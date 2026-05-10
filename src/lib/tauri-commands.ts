import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session, PersistedSession, SessionHistoryEntry, SessionMessagePayload, SessionMessageSearchResult } from "../types/session";
import type { FileNode } from "../types/file-tree";
import type { FrontendEvent, ToolApprovalRequestEvent } from "../types/claude-events";
import type { AppSettings } from "../types/settings";
import type { ChangelogEntry, ProjectChangelogEntry } from "../types/changelog";
import type { GitStatusInfo, GitCommit } from "../types/git";
import type { SlashCommand, ExpandedSkill, OneshotResult } from "../types/slash-commands";
import type { McpServerConfig } from "../types/mcp";
import type { ApiLogEntry, ApiCostSummary } from "../types/api-logs";
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

export async function setClaudeBinaryOverride(path: string): Promise<ClaudeStatus> {
  return invoke<ClaudeStatus>("set_claude_binary_override", { path });
}

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
  resumeCliSessionId?: string
): Promise<Session> {
  return invoke<Session>("create_session", {
    projectPath,
    name,
    resumeCliSessionId,
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

// --- SpecWriter CLI Sessions ---

export async function createSpecwriterSession(
  projectPath: string,
  model: string,
  systemPrompt: string,
): Promise<string> {
  return invoke<string>("create_specwriter_session", {
    projectPath,
    model,
    systemPrompt,
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

export async function resolveToolApproval(
  requestId: string,
  approved: boolean,
  reason?: string
): Promise<void> {
  return invoke("resolve_tool_approval", { requestId, approved, reason });
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

// --- Slash Commands ---

export async function discoverCommands(projectPath: string): Promise<SlashCommand[]> {
  return invoke<SlashCommand[]>("discover_commands", { projectPath });
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

export function listenChatEvents(
  sessionId: string,
  callback: (event: FrontendEvent) => void
): Promise<UnlistenFn> {
  return listen<FrontendEvent>(`claude-chat-${sessionId}`, (e) =>
    callback(e.payload)
  );
}

export function listenActivityEvents(
  sessionId: string,
  callback: (event: FrontendEvent) => void
): Promise<UnlistenFn> {
  return listen<FrontendEvent>(`claude-activity-${sessionId}`, (e) =>
    callback(e.payload)
  );
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
