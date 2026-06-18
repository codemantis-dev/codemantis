/**
 * duo-drift — a cheap, pure classifier for "severe drift" the read-only mentor
 * should flag WHILE the primary is mid-turn (the hybrid intervention path).
 *
 * It inspects the primary's tool operations (Activity Feed `tool_use_start`
 * events) and looks for clearly destructive or off-the-rails behavior:
 * blowing away the working tree, deleting tests, mass-rewriting files. Only
 * "severe" hits warrant interrupting the primary's flow; everything subtler is
 * left to the turn-boundary review. Kept pure so it's trivially testable; the
 * store wires it to the live activity stream.
 */

export type DriftSensitivity = "conservative" | "balanced" | "aggressive";

export interface ToolOp {
  toolName: string;
  input: Record<string, unknown>;
}

export interface DriftSignal {
  severe: boolean;
  reason: string | null;
}

const NO_DRIFT: DriftSignal = { severe: false, reason: null };

/** Destructive shell commands that wipe work regardless of sensitivity. */
const DESTRUCTIVE_CMD =
  /\brm\s+-rf?\b|\bgit\s+reset\s+--hard\b|\bgit\s+checkout\s+(--\s+)?\.|\bgit\s+clean\s+-[a-z]*f/i;

const TEST_PATH = /(\.|_)test(s)?(\.|\/|$)|__tests__|\/tests?\//i;

function commandOf(op: ToolOp): string {
  const c = op.input.command;
  return typeof c === "string" ? c : "";
}

function pathOf(op: ToolOp): string {
  const p = op.input.file_path ?? op.input.path;
  return typeof p === "string" ? p : "";
}

/** Mass-edit threshold per sensitivity (distinct files written/edited in one turn). */
function massEditThreshold(sensitivity: DriftSensitivity): number {
  switch (sensitivity) {
    case "aggressive":
      return 8;
    case "balanced":
      return 15;
    case "conservative":
    default:
      return Infinity; // conservative never flags on volume alone
  }
}

/**
 * Classify the accumulated tool ops for the current primary turn.
 * Returns the FIRST severe signal found (so the caller can nudge once).
 */
export function classifyDrift(
  ops: ToolOp[],
  sensitivity: DriftSensitivity = "conservative",
): DriftSignal {
  const editedFiles = new Set<string>();

  for (const op of ops) {
    const cmd = commandOf(op);
    const path = pathOf(op);

    // 1. Destructive shell commands (all sensitivities).
    if (cmd && DESTRUCTIVE_CMD.test(cmd)) {
      return { severe: true, reason: `Destructive command: ${cmd.slice(0, 120)}` };
    }

    // 2. Deleting test files (all sensitivities) — via rm or a path delete.
    if (cmd && /\brm\b/i.test(cmd) && TEST_PATH.test(cmd)) {
      return { severe: true, reason: "Deleting test files" };
    }
    if (path && TEST_PATH.test(path) && /delete|remove/i.test(op.toolName)) {
      return { severe: true, reason: `Deleting test file: ${path}` };
    }

    // Track distinct edited files for the mass-edit heuristic.
    if (path && /write|edit|create|update/i.test(op.toolName)) {
      editedFiles.add(path);
    }
  }

  // 3. Mass edits (balanced/aggressive only).
  const threshold = massEditThreshold(sensitivity);
  if (editedFiles.size > threshold) {
    return {
      severe: true,
      reason: `Edited ${editedFiles.size} files in one turn (threshold ${threshold})`,
    };
  }

  return NO_DRIFT;
}

/** Normalize a mentor concern summary for ping-pong (repeat-concern) detection. */
export function normalizeConcern(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
