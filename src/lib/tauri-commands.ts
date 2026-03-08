import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session, PersistedSession } from "../types/session";
import type { FileNode } from "../types/file-tree";
import type { FrontendEvent } from "../types/claude-events";
import type { AppSettings } from "../types/settings";

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
  name?: string
): Promise<Session> {
  return invoke<Session>("create_session", {
    projectPath,
    name,
  });
}

export async function sendMessage(
  sessionId: string,
  prompt: string
): Promise<void> {
  return invoke("send_message", { sessionId, prompt });
}

export async function respondToApproval(
  sessionId: string,
  toolUseId: string,
  approved: boolean
): Promise<void> {
  return invoke("respond_to_approval", { sessionId, toolUseId, approved });
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

// --- Files ---

export async function readFileTree(rootPath: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("read_file_tree", { rootPath });
}

export async function readFileContent(filePath: string): Promise<string> {
  return invoke<string>("read_file_content", { filePath });
}

// --- Attachments ---

export interface AttachmentInfo {
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  is_image: boolean;
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
  name?: string
): Promise<TerminalInfo> {
  return invoke<TerminalInfo>("create_terminal", {
    sessionId,
    cwd,
    shell,
    name,
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

export function listenApprovalEvents(
  sessionId: string,
  callback: (event: FrontendEvent) => void
): Promise<UnlistenFn> {
  return listen<FrontendEvent>(`claude-approval-${sessionId}`, (e) =>
    callback(e.payload)
  );
}
