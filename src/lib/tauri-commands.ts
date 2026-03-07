import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Session } from "../types/session";
import type { FileNode } from "../types/file-tree";
import type { FrontendEvent } from "../types/claude-events";

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

// --- Files ---

export async function readFileTree(rootPath: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("read_file_tree", { rootPath });
}

export async function readFileContent(filePath: string): Promise<string> {
  return invoke<string>("read_file_content", { filePath });
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
