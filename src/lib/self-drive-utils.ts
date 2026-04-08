// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Utility functions
// ═══════════════════════════════════════════════════════════════════════

import type { Message } from "../types/session";
import { useGuideStore } from "../stores/guideStore";

/**
 * Extract tool names from recent messages in the current turn.
 * Looks for tool_use patterns in activity IDs and message content.
 */
export function extractToolsFromTurn(messages: Message[]): string[] {
  const tools = new Set<string>();

  // Walk backwards to find tools from the last assistant turn
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") break; // stop at the last user message

    // Extract tool names from activity IDs (format: "tool-name-timestamp")
    for (const actId of msg.activityIds ?? []) {
      const match = actId.match(/^([a-z_]+)-\d+/);
      if (match) tools.add(match[1]);
    }

    // Also look for common tool patterns in content
    const toolPatterns = [
      /\bRead\b/g, /\bWrite\b/g, /\bEdit\b/g, /\bBash\b/g,
      /\bGlob\b/g, /\bGrep\b/g, /\bListDir\b/g,
    ];
    for (const pat of toolPatterns) {
      if (pat.test(msg.content)) {
        tools.add(pat.source.replace(/\\b/g, ""));
      }
    }
  }

  return Array.from(tools);
}

/**
 * Smart truncation that keeps the beginning and end of a response.
 * This ensures the orchestrator sees both the initial context and the conclusion.
 */
export function truncateResponse(content: string, maxChars: number = 6000): string {
  if (content.length <= maxChars) return content;

  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = maxChars - headSize - 20; // 20 chars for separator

  const head = content.slice(0, headSize);
  const tail = content.slice(-tailSize);

  return `${head}\n\n[...truncated...]\n\n${tail}`;
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
 * Get the current session plan data formatted for the orchestrator.
 */
export function getCurrentSessionPlan(sessionIndex: number): {
  index: number;
  name: string;
  scope: string;
  prompt: string;
  verifyChecks: string[];
  isLastSession: boolean;
  hasAuditDocument: boolean;
} | null {
  const guide = useGuideStore.getState().guide;
  if (!guide) return null;

  const session = guide.sessions.find((s) => s.index === sessionIndex);
  if (!session) return null;

  const lastSessionIndex = Math.max(...guide.sessions.map((s) => s.index));

  return {
    index: session.index,
    name: session.name,
    scope: session.scope,
    prompt: session.prompt,
    verifyChecks: session.verifyChecks.map((c) => c.label),
    isLastSession: session.index === lastSessionIndex,
    hasAuditDocument: !!guide.auditFilename,
  };
}
