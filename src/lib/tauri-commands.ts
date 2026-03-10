import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session, PersistedSession, SessionHistoryEntry } from "../types/session";
import type { FileNode } from "../types/file-tree";
import type { FrontendEvent, ToolApprovalRequestEvent } from "../types/claude-events";
import type { AppSettings } from "../types/settings";
import type { ChangelogEntry, ProjectChangelogEntry } from "../types/changelog";
import type { GitStatusInfo } from "../types/git";

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

export async function resolveToolApproval(
  requestId: string,
  approved: boolean,
  reason?: string
): Promise<void> {
  return invoke("resolve_tool_approval", { requestId, approved, reason });
}

export async function respondToQuestion(
  sessionId: string,
  toolUseId: string,
  answer: string
): Promise<void> {
  return invoke("respond_to_question", { sessionId, toolUseId, answer });
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

export async function listSessionHistory(
  projectPath: string
): Promise<SessionHistoryEntry[]> {
  return invoke<SessionHistoryEntry[]>("list_session_history", { projectPath });
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
  apiKey: string
): Promise<boolean> {
  return invoke<boolean>("test_changelog_api_key", { provider, apiKey });
}

// --- Git ---

export async function getGitStatus(projectPath: string): Promise<GitStatusInfo> {
  return invoke<GitStatusInfo>("get_git_status", { projectPath });
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
