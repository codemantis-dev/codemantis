import type { SuperBroTrigger, Observation } from "../types/super-bro";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useGuideStore } from "../stores/guideStore";
import { usePreviewStore } from "../stores/previewStore";
import { readSuperBroModule } from "./tauri-commands";

// ── Context Snapshot ───────────────────────────────────────��─────────

export interface SuperBroContext {
  project: {
    path: string;
    techStack: string;
  };
  guide: {
    active: boolean;
    currentSession: number;
    totalSessions: number;
    completedSessions: number;
    currentSessionName: string;
  } | null;
  spec: {
    title: string;
    hasActiveSpec: boolean;
  } | null;
  lastClaudeMessage: string;
  recentActivity: string[];
  terminalOutput: string;
  previewErrors: string[];
  gitStatus: {
    changedFiles: number;
    uncommitted: boolean;
    branch: string;
  };
}

export function buildSuperBroContext(
  projectPath: string,
  terminalOutput: string,
  gitStatus?: { changedFiles: number; uncommitted: boolean; branch: string },
  claudeMdContent?: string,
): SuperBroContext {
  const sessionStore = useSessionStore.getState();
  const activityStore = useActivityStore.getState();
  const guideStore = useGuideStore.getState();
  const previewStore = usePreviewStore.getState();

  // Last Claude message (truncated to 500 chars)
  const activeId = sessionStore.activeSessionId;
  let lastClaudeMessage = "";
  if (activeId) {
    const messages = sessionStore.sessionMessages.get(activeId) ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        lastClaudeMessage = messages[i].content.slice(0, 500);
        break;
      }
    }
  }

  // Recent activity summaries (last 10)
  const recentActivity: string[] = [];
  if (activeId) {
    const entries = activityStore.getActiveEntries(activeId);
    const last10 = entries.slice(-10);
    for (const entry of last10) {
      const summary = `${entry.toolName}: ${summarizeToolInput(entry.toolName, entry.toolInput)} [${entry.status}]`;
      recentActivity.push(summary.slice(0, 200));
    }
  }

  // Guide state
  let guide: SuperBroContext["guide"] = null;
  const g = guideStore.guide;
  if (g && g.status === "active") {
    const activeSession = g.sessions.find((s) => s.status === "active");
    const completedCount = g.sessions.filter(
      (s) => s.status === "done",
    ).length;
    guide = {
      active: true,
      currentSession: activeSession?.index ?? 1,
      totalSessions: g.sessions.length,
      completedSessions: completedCount,
      currentSessionName: activeSession?.name ?? g.sessions[0]?.name ?? "",
    };
  }

  // Preview errors (last 5)
  const consoleLogs = previewStore.consoleLogs.get(projectPath) ?? [];
  const previewErrors = consoleLogs
    .filter((log) => log.level === "error")
    .slice(-5)
    .map((log) => log.message.slice(0, 200));

  // Tech stack from CLAUDE.md
  const techStack = claudeMdContent
    ? extractTechStack(claudeMdContent)
    : "Unknown";

  return {
    project: { path: projectPath, techStack },
    guide,
    spec: null, // Could read from specWriterStore if needed
    lastClaudeMessage,
    recentActivity,
    terminalOutput: terminalOutput.slice(-2000), // Last ~30 lines
    previewErrors,
    gitStatus: gitStatus ?? { changedFiles: 0, uncommitted: false, branch: "main" },
  };
}

function summarizeToolInput(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  if (toolName === "write" || toolName === "edit" || toolName === "read") {
    return String(toolInput.file_path ?? toolInput.path ?? "");
  }
  if (toolName === "bash") {
    return String(toolInput.command ?? "").slice(0, 100);
  }
  return JSON.stringify(toolInput).slice(0, 100);
}

function extractTechStack(claudeMd: string): string {
  // Take first ~200 chars or find Architecture/Stack section
  const lines = claudeMd.split("\n").slice(0, 10);
  return lines.join(" ").slice(0, 200);
}

// ── Module Selection ─────────────────────────────────────────────────

const MODULE_MAP: Record<SuperBroTrigger, string> = {
  claude_response: "knowledge-claude-response",
  build_error: "knowledge-build-errors",
  test_failure: "knowledge-test-failures",
  preview_error: "knowledge-runtime-errors",
  guide_session_complete: "knowledge-guide-transitions",
  guide_session_start: "knowledge-guide-transitions",
  silence_timeout: "knowledge-user-stuck",
  destructive_action: "knowledge-safety",
  session_start: "knowledge-session-start",
};

export function selectKnowledgeModule(trigger: SuperBroTrigger): string {
  return MODULE_MAP[trigger];
}

// ─�� Module Cache ─────────────────────────────────────────────────────

const moduleCache = new Map<string, string>();

async function getCachedModule(name: string): Promise<string> {
  const cached = moduleCache.get(name);
  if (cached) return cached;

  const content = await readSuperBroModule(name);
  moduleCache.set(name, content);
  return content;
}

// ── Full Request Assembly ────────────────────────────────────────────

export async function buildSuperBroRequest(
  trigger: SuperBroTrigger,
  context: SuperBroContext,
  observations: Observation[],
): Promise<{ systemPrompt: string; userMessage: string }> {
  // Layer 1: Always-present persona
  const persona = await getCachedModule("persona");

  // Layer 2: Situation-specific knowledge
  const moduleName = selectKnowledgeModule(trigger);
  const knowledge = await getCachedModule(moduleName);

  // Combine into system prompt
  const systemPrompt = `${persona}\n\n${knowledge}`;

  // Build the user message from context
  const observationBlock =
    observations.length > 0
      ? `\nPROJECT OBSERVATIONS:\n${observations.map((o) => `- ${o.text}`).join("\n")}`
      : "";

  const userMessage = `
CURRENT STATE:
Project: ${context.project.path}
Tech Stack: ${context.project.techStack}
${context.guide ? `Implementation Guide: Session ${context.guide.currentSession} of ${context.guide.totalSessions} (${context.guide.currentSessionName})` : "No Implementation Guide active"}
Git: ${context.gitStatus.changedFiles} files changed, ${context.gitStatus.uncommitted ? "not committed" : "clean"}
${observationBlock}

TRIGGER: ${trigger}

CLAUDE CODE'S LAST MESSAGE:
${context.lastClaudeMessage}

RECENT ACTIVITY (what Claude did):
${context.recentActivity.join("\n")}

${context.terminalOutput ? `TERMINAL OUTPUT (last 30 lines):\n${context.terminalOutput}` : ""}
${context.previewErrors.length > 0 ? `PREVIEW ERRORS:\n${context.previewErrors.join("\n")}` : ""}

What should the user do next? If everything looks fine, respond with NOTHING_TO_REPORT.
`.trim();

  // Enforce total input budget: ~6000 tokens ≈ ~24000 chars
  // System prompt (persona + module) is ~3500 tokens; user message should stay under ~2500 tokens (~10000 chars)
  const MAX_USER_MESSAGE_CHARS = 10000;
  const truncatedUserMessage =
    userMessage.length > MAX_USER_MESSAGE_CHARS
      ? userMessage.slice(0, MAX_USER_MESSAGE_CHARS) + "\n[...truncated]"
      : userMessage;

  return { systemPrompt, userMessage: truncatedUserMessage };
}
