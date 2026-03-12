export type PreviewStatus = "idle" | "starting" | "scanning" | "running" | "error";

export type ViewportPreset = "mobile" | "tablet" | "desktop";

export interface ConsoleLogEntry {
  id: string;
  level: "log" | "warn" | "error" | "info" | "debug";
  timestamp: number;
  message: string;
  stack?: string;
  url?: string;
}

export interface DevServerState {
  terminalId: string;
  sessionId: string;
  port: number | null;
  url: string | null;
  status: PreviewStatus;
  errorMessage?: string;
}

export interface DevServerReadyEvent {
  port: number;
  url: string;
  terminalId: string;
  projectPath: string;
}

export interface DevServerErrorEvent {
  message: string;
  projectPath: string;
}
