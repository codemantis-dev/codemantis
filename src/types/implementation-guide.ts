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
  /**
   * Actions this session introduces that cross a system boundary (worker
   * → Edge Function, frontend → backend endpoint, producer → consumer).
   * Each row declares the caller's action name and the handler it must
   * dispatch to. Parsed from the spec's
   * `**Cross-system actions introduced:**` block. Used by Self-Drive to
   * run a static parity check before marking the session done.
   */
  crossSystemActions?: CrossSystemAction[];
  /**
   * Capability IDs (matching `preflight.yaml::capabilities[].id`) that must
   * be in `Satisfied` state before this session can run. Self-Drive's
   * pre-session loop verifies each entry; any failure pauses the run.
   * Optional for backwards compatibility — sessions without a `requires`
   * field run unchanged (no preflight gating).
   */
  requires?: string[];
  status: "pending" | "active" | "done";
  promptSent?: boolean;
  verifyRequested?: boolean;
}

export interface CrossSystemAction {
  /** The action name as issued by the caller (e.g. "insert_note_classification"). */
  action: string;
  /**
   * Path (and optional ::symbol) of the handler expected to dispatch this
   * action. The file portion is grep-searched for the action/wire string;
   * if not found, the session cannot transition to done.
   */
  handler: string;
  /**
   * Optional on-the-wire identifier when it differs from `action` — e.g.
   * the JS function name is `resolveCheckpoint` but the edge-function URL
   * is `hitl-respond`, or the action label is `insert_note` but the
   * request-body field carries `note.insert`. The parity gate searches
   * caller + handler files for `wire` when present, falling back to
   * `action` otherwise. Defaulting happens at consumption time, not at
   * parse/serialization time, so the AST stays minimal and existing
   * persisted guides (which never had this field) deserialize unchanged.
   */
  wire?: string;
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
   *                   Must declare its mock surface; if the test mocks a
   *                   cross-system boundary, a paired [integration] check
   *                   is mandatory for the same boundary.
   *  - "integration": requires BOTH caller and handler code to be cited
   *                   AND a real non-mocked invocation with quoted output.
   *                   The only kind that proves cross-system calls end-to-end.
   */
  kind?: "static" | "side-effect" | "behavioral" | "integration";
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
  | "capability-missing"  // a preflight.yaml capability isn't satisfied
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
  | "recovering"
  /**
   * Orchestrator asked Claude Code to re-state evidence for specific
   * verify items because the first response was missing a required
   * format element (e.g. "$ cmd" for a side-effect, "mocks=" on a
   * behavioral). The session is NOT stuck — we're waiting for a
   * targeted follow-up from Claude Code that will re-enter "verifying"
   * with the merged response.
   */
  | "rechecking";

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
    verifyChecks: { label: string; kind?: "static" | "side-effect" | "behavioral" | "integration" }[];
    crossSystemActions?: CrossSystemAction[];
    isLastSession: boolean;
    hasAuditDocument: boolean;
  };
  claudeCodeResponse: string;
  claudeCodeToolsUsed: string[];
  turnDurationMs: number;
  /**
   * Total tokens consumed by Claude Code during the turn (input + output +
   * cache). Surfaced to the orchestrator so the fabrication detector can
   * apply a sanity bound: a turn that genuinely spent millions of tokens
   * cannot be a "claim of work without doing the work". Pass 0 when the
   * count is unknown (no usage_update arrived) — the detector treats 0 as
   * "uncertain" and does not use it to soften the rule.
   */
  turnTokensUsed: number;
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
  | "advance_recovery"
  /**
   * Target the VERIFIER's response (not the code). Emitted when the
   * implementation is probably correct but the verifier's evidence is
   * missing a required format element for one or more items. The
   * orchestrator composes a short, concrete re-prompt that asks Claude
   * Code to re-state ONLY those items. Self-Drive enters the
   * "rechecking" phase, sends the prompt, merges the response, and
   * calls the orchestrator again. Distinct from "fix" (which modifies
   * CODE) and "pause" (which needs a human).
   */
  | "request_recheck";

export interface OrchestratorDecision {
  action: OrchestratorAction;
  fixPrompt?: string;
  buildCommand?: string;
  testCommand?: string;
  pauseReason?: string;
  abortReason?: string;
  /**
   * Per-item verdict. `passed:true` with `evidence` = green tick.
   * `passed:false` with `reason` = real failure (orchestrator should have
   * emitted "fix" or "pause" instead of "advance", but defense-in-depth).
   * `skipped:true` = the orchestrator judged the item as not-applicable
   * for this session (e.g. optional integration test with no credentials
   * available). Treated as satisfied by the advance gate — still counted
   * toward coverage, but does NOT require `passed:true`.
   */
  checkResults?: { label: string; passed: boolean; skipped?: boolean; reason?: string; evidence?: string }[];
  /**
   * Labels of verify checks that need re-stated evidence. Only meaningful
   * when `action === "request_recheck"`. Each label MUST appear in the
   * session's verifyChecks; labels outside the session are dropped during
   * parse. A non-empty list is required for the recheck path to run.
   */
  recheckItems?: string[];
  /**
   * Prompt the orchestrator composes for Claude Code, naming exact
   * commands, file paths, and evidence forms for each recheck item.
   * Capped at 2000 chars by the parser — over-long prompts usually mean
   * the orchestrator is asking for too much, which should become a fix
   * or a pause instead.
   */
  recheckPrompt?: string;
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
