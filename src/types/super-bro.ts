export type SuperBroTrigger =
  | "claude_response"
  | "build_error"
  | "test_failure"
  | "preview_error"
  | "guide_session_complete"
  | "guide_session_start"
  | "silence_timeout"
  | "destructive_action"
  | "session_start";

export interface SuperBroMessage {
  id: string;
  guidance: string;
  suggestedPrompt: string | null;
  fileCheckRequest: string | null;
  trigger: SuperBroTrigger;
  timestamp: string;
  dismissed: boolean;
}

export interface Observation {
  id: string;
  text: string;
  category: "pattern" | "preference" | "issue" | "project_note";
  createdAt: string;
  lastReferencedAt: string;
}

export interface SuperBroState {
  enabled: boolean;
  currentMessage: SuperBroMessage | null;
  isThinking: boolean;
  isPaused: boolean;
  observations: Observation[];
  messageHistory: SuperBroMessage[];
}
