export interface Session {
  id: string;
  name: string;
  project_path: string;
  status: SessionStatus;
  created_at: string;
  model: string | null;
  icon_index: number;
}

export type SessionStatus = "starting" | "connected" | "idle" | "closed";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  activityIds: string[];
  isStreaming: boolean;
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
