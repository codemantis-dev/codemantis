export interface QuickCommand {
  label: string;
  command: string;
}

export interface AppSettings {
  theme: string;
  fontSize: number;
  sendShortcut: string;
  terminalShell: string | null;
  terminalFontSize: number;
  quickCommands: QuickCommand[];
}
