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
  /**
   * Evidence type required to pass this check.
   *  - "static":      file:lines + quoted code. DEFAULT. Backward compatible.
   *  - "side-effect": requires a live command output / query result.
   *                   (e.g. DB row, HTTP status, deployed schema row)
   *  - "behavioral":  requires a passing test run with quoted assertion.
   */
  kind?: "static" | "side-effect" | "behavioral";
}

// ═══════════════════════════════════════════════════════════════════════
// Blocker — structured pause state
// ═══════════════════════════════════════════════════════════════════════

export type BlockerKind =
  | "infra-state-drift"   // migration/deploy history mismatch, prod-vs-local schema drift
  | "permissions"         // missing write/push/access rights
  | "missing-deps"        // tool/package/version unavailable
  | "credentials"         // API key, token, login needed
  | "env-config"          // missing env var, wrong config value
  | "user-decision"       // Claude asked a question with multiple valid options
  | "external-failure"    // third-party outage / rate limit
  | "unknown";

export interface Blocker {
  id: string;
  sessionIndex: number;
  detectedAt: number;
  kind: BlockerKind;
  summary: string;             // one line for log / card header
  detail: string;              // truncated excerpt of Claude Code's response
  optionsOffered: string[];    // options Claude Code listed (parsed)
  resolutionCriteria: string;  // what must be true for "resolved"
  status: "open" | "user-decided" | "verifying" | "resolved" | "abandoned";
  userResolution?: string;     // free text / chosen option label
  /**
   * ID of the last non-self-drive chat message at the moment the pause
   * was taken. On Resume, Self-Drive reads messages AFTER this id as the
   * "chat since pause" window — what the user answered in the main chat,
   * what Claude Code replied — and feeds that into the recovery prompt.
   * Null if no messages existed, or the id can't be resolved.
   */
  prePauseLastMessageId?: string | null;
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
  | "committing"
  | "recovering";

export interface SelfDriveConfig {
  provider: string;
  model: string;
  maxFixAttempts: number;
  runTests: boolean;
  runBuildCheck: boolean;
  autoCommit: boolean;
}

export interface OrchestratorInput {
  currentPhase: "building" | "verifying" | "fixing" | "build-checking" | "testing" | "committing" | "recovering";
  sessionPlan: {
    index: number;
    name: string;
    scope: string;
    prompt: string;
    verifyChecks: { label: string; kind?: "static" | "side-effect" | "behavioral" }[];
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
  /**
   * If a blocker is active, the orchestrator is being asked to evaluate
   * a recovery verification — was the original blocker actually fixed?
   */
  activeBlocker: Blocker | null;
  /** Summaries of the last few pauses — gives the orchestrator memory across resumes. */
  recentPauseSummaries: string[];
}

export type OrchestratorAction =
  | "advance"
  | "verify"
  | "fix"
  | "build_check"
  | "test"
  | "commit"
  | "pause"
  | "abort"
  | "advance_recovery";

export interface OrchestratorDecision {
  action: OrchestratorAction;
  fixPrompt?: string;
  buildCommand?: string;
  testCommand?: string;
  pauseReason?: string;
  abortReason?: string;
  checkResults?: { label: string; passed: boolean; reason?: string; evidence?: string }[];
  summary: string;
  confidence: "high" | "medium" | "low";
  /**
   * Emitted when action === "pause" and the cause is a real blocker
   * (user input / infra / credential / etc.). Lets Self-Drive build
   * a structured Blocker object instead of a freeform string.
   */
  blocker?: {
    kind: BlockerKind;
    summary: string;
    optionsOffered: string[];
    resolutionCriteria: string;
  };
}

export interface RunLogEntry {
  timestamp: number;
  sessionIndex: number;
  phase:
    | SelfDrivePhase
    | "started" | "resumed" | "paused" | "stopped" | "completed" | "aborted" | "crash" | "decision"
    | "blocker-detected" | "blocker-user-decided" | "blocker-verifying" | "blocker-resolved";
  event: string;
  summary: string;
  decision?: OrchestratorDecision;
  durationMs?: number;
  prompt?: string;
  /** Attached when phase is one of the blocker-* lifecycle entries. */
  blocker?: Blocker;
}
