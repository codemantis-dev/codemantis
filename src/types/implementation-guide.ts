// ═══════════════════════════════════════════════════════════════════════
// Implementation Guide — Type definitions
// ═══════════════════════════════════════════════════════════════════════

export interface ImplementationGuide {
  id: string;
  projectPath: string;
  specFilename: string;
  auditFilename: string | null;
  title: string;
  sessions: GuideSession[];
  createdAt: string;
  status: "active" | "completed";
}

export interface GuideSession {
  index: number;
  name: string;
  scope: string;
  readSections: string;
  files: string[];
  prompt: string;
  verifyChecks: VerifyCheck[];
  verificationPrompt?: string | null;
  status: "pending" | "active" | "done";
  promptSent?: boolean;
  verifyRequested?: boolean;
}

export interface VerifyCheck {
  id: string;
  label: string;
  checked: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — AI-orchestrated autonomous implementation
// ═══════════════════════════════════════════════════════════════════════

export type SelfDriveStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed";

export type SelfDrivePhase =
  | "preparing"
  | "building"
  | "build-checking"
  | "verifying"
  | "fixing"
  | "testing"
  | "evaluating"
  | "advancing"
  | "committing";

export interface SelfDriveConfig {
  provider: string;
  model: string;
  maxFixAttempts: number;
  runTests: boolean;
  runBuildCheck: boolean;
  autoCommit: boolean;
}

export interface OrchestratorInput {
  currentPhase: "building" | "verifying" | "fixing" | "build-checking" | "testing" | "committing";
  sessionPlan: {
    index: number;
    name: string;
    scope: string;
    prompt: string;
    verifyChecks: string[];
    isLastSession: boolean;
    hasAuditDocument: boolean;
  };
  claudeCodeResponse: string;
  claudeCodeToolsUsed: string[];
  turnDurationMs: number;
  fixAttempt: number;
  maxFixAttempts: number;
  previousFixPrompts: string[];
  techStack: string;
  testCommand: string | null;
  buildCommand: string | null;
  specFilename: string;
  auditFilename: string | null;
}

export type OrchestratorAction =
  | "advance"
  | "verify"
  | "fix"
  | "build_check"
  | "test"
  | "commit"
  | "pause"
  | "abort";

export interface OrchestratorDecision {
  action: OrchestratorAction;
  fixPrompt?: string;
  buildCommand?: string;
  testCommand?: string;
  pauseReason?: string;
  abortReason?: string;
  checkResults?: { label: string; passed: boolean; reason?: string }[];
  summary: string;
  confidence: "high" | "medium" | "low";
}

export interface RunLogEntry {
  timestamp: number;
  sessionIndex: number;
  phase: SelfDrivePhase | "started" | "resumed" | "paused" | "stopped" | "completed" | "aborted" | "crash" | "decision";
  event: string;
  summary: string;
  decision?: OrchestratorDecision;
  durationMs?: number;
  prompt?: string;
}
