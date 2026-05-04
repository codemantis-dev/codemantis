// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Utility functions
// ═══════════════════════════════════════════════════════════════════════

import type { Message } from "../types/session";
import type { ImplementationGuide } from "../types/implementation-guide";
import { useGuideStore } from "../stores/guideStore";
import { useActivityStore } from "../stores/activityStore";

/**
 * Extract tool names used in the current turn.
 *
 * Three layers, primary → fallback, deduplicated into one list:
 *
 *   1. TIMESTAMP slice of activityStore (primary). Take every
 *      ActivityEntry whose timestamp ≥ the boundary (last user
 *      message's timestamp, or the start of time when there isn't one).
 *      This bypasses messageId attribution entirely, so it survives the
 *      long-turn / sub-agent / message-id-drift races that previously
 *      made the orchestrator see "TOOLS USED: none" on a 13-minute
 *      turn that actually did real work.
 *
 *   2. MESSAGE-ID lookup of activityStore (secondary). Per-message
 *      attribution. Catches the case where an entry's timestamp is
 *      somehow before the boundary (clock skew, restored sessions) but
 *      its messageId clearly belongs to a turn message.
 *
 *   3. Prose regex over assistant text (last resort). Cheap, harmless,
 *      and catches the rare case where activity events are missing
 *      entirely (listener not yet registered, restored chat history
 *      with no live activity stream).
 *
 * The orchestrator's fabrication detector is gated on this list. False
 * negatives (real work reported as "none") cause Self-Drive to interrupt
 * legitimate long-running work with a Blocker, so we err on the side of
 * over-reporting tools rather than under-reporting.
 */
export function extractToolsFromTurn(messages: Message[], sessionId: string): string[] {
  const tools = new Set<string>();

  // Find the boundary: last user message. Everything after is the
  // current turn (one or more assistant messages).
  let boundaryIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      boundaryIdx = i;
      break;
    }
  }
  const turnMessages = messages.slice(boundaryIdx + 1).filter((m) => m.role === "assistant");

  const store = useActivityStore.getState();
  const allEntries = store.getActiveEntries(sessionId);

  // Primary source: timestamp slice. Independent of messageId tagging.
  // We use the user message's timestamp as the lower bound; an entry
  // created at-or-after that point is part of the current turn. Entries
  // without a parseable timestamp (rare; only synthetic test fixtures)
  // fall through to the secondary check.
  const boundaryMessage = boundaryIdx >= 0 ? messages[boundaryIdx] : null;
  const boundaryTs = boundaryMessage?.timestamp ? Date.parse(boundaryMessage.timestamp) : NaN;
  if (!Number.isNaN(boundaryTs)) {
    for (const entry of allEntries) {
      const entryTs = Date.parse(entry.timestamp);
      if (!Number.isNaN(entryTs) && entryTs >= boundaryTs && entry.toolName) {
        tools.add(entry.toolName);
      }
    }
  }

  // Secondary source: per-message attribution. Catches entries with
  // skewed/missing timestamps but a clear messageId match.
  if (turnMessages.length > 0) {
    for (const msg of turnMessages) {
      const entries = store.getEntriesForMessage(sessionId, msg.id);
      for (const entry of entries) {
        if (entry.toolName && entry.toolName.length > 0) {
          tools.add(entry.toolName);
        }
      }
    }
  }

  // Last resort: scan assistant prose for literal tool names. Won't
  // catch concise summaries that don't name tools by string, but
  // protects sessions where the activity stream isn't running.
  const toolPatterns: Array<[RegExp, string]> = [
    [/\bRead\b/, "Read"], [/\bWrite\b/, "Write"], [/\bEdit\b/, "Edit"],
    [/\bBash\b/, "Bash"], [/\bGlob\b/, "Glob"], [/\bGrep\b/, "Grep"],
    [/\bListDir\b/, "ListDir"],
  ];
  for (const msg of turnMessages) {
    for (const [pat, name] of toolPatterns) {
      if (pat.test(msg.content)) tools.add(name);
    }
  }

  return Array.from(tools);
}

/**
 * Detect the project's tech stack from CLAUDE.md content or common patterns.
 */
export function getProjectTechStack(): string {
  // For CodeMantis itself, we know the stack
  // In a general implementation this would read CLAUDE.md or detect from package.json
  return "Tauri v2 + React 19 + TypeScript + Rust + Vite + Tailwind CSS";
}

/**
 * Get the build/typecheck command for the project.
 * Reads from common conventions.
 */
export function getBuildCommand(): string | null {
  return "pnpm tsc --noEmit";
}

/**
 * Get the test command for the project.
 */
export function getTestCommand(): string | null {
  return "pnpm test";
}

/**
 * Format a session plan for the orchestrator.
 *
 * Accepts an explicit guide so Self-Drive can pass its pinned snapshot —
 * do NOT default to useGuideStore.guide because that field follows UI
 * navigation and may belong to a different project than the one Self-Drive
 * is actually running on. When `guide` is omitted the function falls back
 * to the store for legacy callers (tests, tools that know they're always
 * looking at the UI's current project).
 */
export function getCurrentSessionPlan(
  sessionIndex: number,
  guide?: ImplementationGuide | null,
): {
  index: number;
  name: string;
  scope: string;
  prompt: string;
  verifyChecks: { label: string; kind?: "static" | "side-effect" | "behavioral" | "integration" }[];
  isLastSession: boolean;
  hasAuditDocument: boolean;
} | null {
  const g = guide ?? useGuideStore.getState().guide;
  if (!g) return null;

  const session = g.sessions.find((s) => s.index === sessionIndex);
  if (!session) return null;

  const lastSessionIndex = Math.max(...g.sessions.map((s) => s.index));

  return {
    index: session.index,
    name: session.name,
    scope: session.scope,
    prompt: session.prompt,
    verifyChecks: session.verifyChecks.map((c) => ({ label: c.label, kind: c.kind })),
    isLastSession: session.index === lastSessionIndex,
    hasAuditDocument: !!g.auditFilename,
  };
}
