export interface TerminalInstance {
  id: string;
  sessionId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  isRunning: boolean;
  kind?: "shell" | "cli-overlay";
}
