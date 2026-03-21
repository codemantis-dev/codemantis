import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session, PersistedSession, SessionHistoryEntry } from "../types/session";
import type { FileNode } from "../types/file-tree";
import type { FrontendEvent, ToolApprovalRequestEvent } from "../types/claude-events";
import type { AppSettings } from "../types/settings";
import type { ChangelogEntry, ProjectChangelogEntry } from "../types/changelog";
import type { GitStatusInfo } from "../types/git";
import type { SlashCommand, ExpandedSkill, OneshotResult } from "../types/slash-commands";
import type { McpServerConfig } from "../types/mcp";
import type { ApiLogEntry, ApiCostSummary } from "../types/api-logs";
import type { TemplateEntry, ScaffoldResult, ScaffoldProgressEvent, VerifyResult, PrerequisiteCheck, PrerequisiteResult, InstallPrerequisiteResult, ProjectAnalysis } from "../types/project-templates";

// --- Startup ---

export interface ClaudeStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  binary_path: string | null;
}

export async function checkClaudeStatus(): Promise<ClaudeStatus> {
  return invoke<ClaudeStatus>("check_claude_status");
}

export async function setClaudeBinaryOverride(path: string): Promise<ClaudeStatus> {
  return invoke<ClaudeStatus>("set_claude_binary_override", { path });
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
  | { type: "image"; mime_type: string; data: string };

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
  width?: number,
  height?: number,
): Promise<void> {
  return invoke("open_preview_window", { url, projectName, width, height });
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

export interface DevServerClosedPayload {
  terminalId: string;
  sessionId: string;
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
