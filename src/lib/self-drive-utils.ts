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
 * Source of truth is the activity store — the same place the Activity
 * Feed reads from. Every tool_use event flows into activityStore.sessionEntries
 * via a per-session listener registered in useClaudeSession, and those
 * entries carry the toolName verbatim ("Write", "Bash", …).
 *
 * Historically this function walked back through `msg.activityIds` +
 * a regex fallback scanning assistant text. The activityIds field is
 * never populated anywhere (verified repo-wide), and the regex falls
 * silent on concise replies like "Created 7 functions and deployed" —
 * which made the orchestrator conclude "TOOLS USED: none" and flag real
 * work as fabricated. This implementation reads from the store so the
 * detector stays correct regardless of what the assistant wrote.
 */
export function extractToolsFromTurn(messages: Message[], sessionId: string): string[] {
  const tools = new Set<string>();

  // Find the id boundary: last user message. Everything after is the
  // current turn (one or more assistant messages).
  let boundaryIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      boundaryIdx = i;
      break;
    }
  }
  const turnMessages = messages.slice(boundaryIdx + 1).filter((m) => m.role === "assistant");

  // Primary source: activityStore entries tagged with this turn's message ids.
  if (turnMessages.length > 0) {
    const store = useActivityStore.getState();
    for (const msg of turnMessages) {
      const entries = store.getEntriesForMessage(sessionId, msg.id);
      for (const entry of entries) {
        if (entry.toolName && entry.toolName.length > 0) {
          tools.add(entry.toolName);
        }
      }
    }
  }

  // Fallback: scan assistant prose for literal tool names. Cheap,
  // harmless, and catches the rare race where the activity event is
  // slightly delayed relative to turn_complete.
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
