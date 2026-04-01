import type { SuperBroTrigger, Observation } from "../types/super-bro";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useGuideStore } from "../stores/guideStore";
import { usePreviewStore } from "../stores/previewStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { readSuperBroModule } from "./tauri-commands";

// ── Context Snapshot ───────────────────────────────────────��─────────

// ── Deployment Types ────────────────────────────────────────────────

export type DeploymentAction =
  | "container_rebuild"
  | "server_restart"
  | "dependency_install"
  | "db_migration"
  | "env_config"
  | "none";

export interface DeploymentContext {
  actions: DeploymentAction[];
  devServerRunning: boolean;
}

export interface SuperBroContext {
  project: {
    path: string;
    techStack: string;
    claudeMdExists: boolean;
  };
  guide: {
    active: boolean;
    currentSession: number;
    totalSessions: number;
    completedSessions: number;
    currentSessionName: string;
    specFilename: string;
    auditFilename: string | null;
    allDone: boolean;
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
  deployment: DeploymentContext;
  testing: {
    testFilesCreated: boolean;
    testSuiteRan: boolean;
    testFilePaths: string[];
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

  // Last Claude message (truncated to 9000 chars)
  const activeId = sessionStore.activeSessionId;
  let lastClaudeMessage = "";
  if (activeId) {
    const messages = sessionStore.sessionMessages.get(activeId) ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        lastClaudeMessage = messages[i].content.slice(0, 9000);
        break;
      }
    }
  }

  // Recent activity summaries — prioritize writes/edits (most important), then bash
  const recentActivity: string[] = [];
  if (activeId) {
    const allEntries = activityStore.getActiveEntries(activeId);

    const writeEdits = allEntries.filter(
      (e) => e.toolName === "Write" || e.toolName === "Edit" || e.toolName === "NotebookEdit",
    );
    const bashEntries = allEntries.filter((e) => e.toolName === "Bash");

    // Last 90 writes/edits + last 30 bash commands, sorted by original order
    const prioritized = [
      ...writeEdits.slice(-90),
      ...bashEntries.slice(-30),
    ].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

    // Cap at 120 total
    const capped = prioritized.slice(-120);

    for (const entry of capped) {
      const summary = `${entry.toolName}: ${summarizeToolInput(entry.toolName, entry.toolInput)} [${entry.status}]`;
      recentActivity.push(summary.slice(0, 1200));
    }
  }

  // Guide state — include both active and completed guides so the LLM
  // gets context even after all sessions finish (guide_session_complete)
  let guide: SuperBroContext["guide"] = null;
  const g = guideStore.guide;
  if (g && (g.status === "active" || g.status === "completed")) {
    const activeSession = g.sessions.find((s) => s.status === "active");
    const completedCount = g.sessions.filter(
      (s) => s.status === "done",
    ).length;
    const allDone = completedCount === g.sessions.length;
    guide = {
      active: !allDone,
      currentSession: activeSession?.index ?? completedCount,
      totalSessions: g.sessions.length,
      completedSessions: completedCount,
      currentSessionName: allDone
        ? "All sessions complete"
        : (activeSession?.name ?? g.sessions[0]?.name ?? ""),
      specFilename: g.specFilename,
      auditFilename: g.auditFilename,
      allDone,
    };
  }

  // Preview errors (last 30)
  const consoleLogs = previewStore.consoleLogs.get(projectPath) ?? [];
  const previewErrors = consoleLogs
    .filter((log) => log.level === "error")
    .slice(-30)
    .map((log) => log.message.slice(0, 1200));

  // Tech stack from CLAUDE.md
  const techStack = claudeMdContent
    ? extractTechStack(claudeMdContent)
    : "Unknown";

  // Deployment awareness
  const deploymentActions = detectDeploymentActions(recentActivity);
  const terminalStoreState = useTerminalStore.getState();
  const devServerRunning = Array.from(terminalStoreState.detectedDevServers.values())
    .some((detections) => detections.length > 0);

  // Test awareness
  const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx)$|__tests__\//;
  const testRunPattern = /vitest|jest|mocha|pnpm test|npm test|bun test|pytest|cargo test/i;

  const testFilesCreated = recentActivity.some(
    (a) => (a.startsWith("Write:") || a.startsWith("Edit:")) && testFilePattern.test(a),
  );
  const testSuiteRan = recentActivity.some(
    (a) => a.startsWith("Bash:") && testRunPattern.test(a),
  );
  const testFilePaths = recentActivity
    .filter((a) => (a.startsWith("Write:") || a.startsWith("Edit:")) && testFilePattern.test(a))
    .map((a) => a.replace(/^(Write|Edit):\s*/, "").replace(/\s*\[.*$/, ""));

  return {
    project: { path: projectPath, techStack, claudeMdExists: !!claudeMdContent },
    guide,
    spec: resolveSpec(projectPath),
    lastClaudeMessage,
    recentActivity,
    terminalOutput: terminalOutput.slice(-12000),
    previewErrors,
    gitStatus: gitStatus ?? { changedFiles: 0, uncommitted: false, branch: "main" },
    deployment: {
      actions: deploymentActions,
      devServerRunning,
    },
    testing: {
      testFilesCreated,
      testSuiteRan,
      testFilePaths,
    },
  };
}

function summarizeToolInput(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  const name = toolName.toLowerCase();
  if (name === "write" || name === "edit" || name === "read" || name === "notebookedit") {
    return String(toolInput.file_path ?? toolInput.path ?? "");
  }
  if (name === "bash") {
    return String(toolInput.command ?? "").slice(0, 900);
  }
  if (name === "glob" || name === "grep") {
    return String(toolInput.pattern ?? toolInput.regex ?? "").slice(0, 100);
  }
  return JSON.stringify(toolInput).slice(0, 100);
}

function resolveSpec(projectPath: string): SuperBroContext["spec"] {
  const specStore = useSpecWriterStore.getState();
  const content = specStore.currentSpecContent.get(projectPath);
  if (!content) return null;
  const conversation = specStore.conversations.get(projectPath);
  const title = conversation ? `Spec (${conversation.mode.replace("_", " ")})` : "Active spec";
  return { title, hasActiveSpec: true };
}

function extractTechStack(claudeMd: string): string {
  const sections = ["stack", "architecture", "tech", "setup", "docker", "deployment", "infrastructure"];
  const lines = claudeMd.split("\n");

  // Always include first 5 lines (project name + summary)
  let result = lines.slice(0, 5).join(" ").trim();

  // Scan for deployment-related content deeper in the file
  for (let i = 5; i < Math.min(lines.length, 100); i++) {
    const lower = lines[i].toLowerCase();
    if (sections.some((s) => lower.includes(s)) || /docker|container|compose/i.test(lines[i])) {
      const contextLines = lines.slice(i, i + 3).join(" ").trim();
      result += " | " + contextLines;
      break;
    }
  }

  return result.slice(0, 2400);
}

// ── Deployment Detection ────────────────────────────────────────────

const DEPLOYMENT_PATTERNS: Array<{ pattern: RegExp; action: DeploymentAction }> = [
  // Container rebuild triggers
  { pattern: /Dockerfile/i,                action: "container_rebuild" },
  { pattern: /docker-compose\.ya?ml/i,     action: "container_rebuild" },
  { pattern: /compose\.ya?ml/i,            action: "container_rebuild" },
  { pattern: /\.dockerignore/i,            action: "container_rebuild" },

  // Dependency install triggers
  { pattern: /package\.json/,              action: "dependency_install" },
  { pattern: /requirements\.txt/,          action: "dependency_install" },
  { pattern: /Pipfile/,                    action: "dependency_install" },
  { pattern: /pyproject\.toml/,            action: "dependency_install" },
  { pattern: /Gemfile/,                    action: "dependency_install" },
  { pattern: /go\.mod/,                    action: "dependency_install" },
  { pattern: /pom\.xml/,                   action: "dependency_install" },

  // DB migration triggers
  { pattern: /models\.py/,                 action: "db_migration" },
  { pattern: /schema\.prisma/,             action: "db_migration" },
  { pattern: /\.sql$/,                     action: "db_migration" },
  { pattern: /alembic/i,                   action: "db_migration" },
  { pattern: /drizzle.*schema/i,           action: "db_migration" },

  // Env/config changes
  { pattern: /\.env/,                      action: "env_config" },

  // Server restart triggers (config files that require restart)
  { pattern: /next\.config/,               action: "server_restart" },
  { pattern: /vite\.config/,               action: "server_restart" },
  { pattern: /webpack\.config/,            action: "server_restart" },
  { pattern: /tsconfig\.json/,             action: "server_restart" },
  { pattern: /tailwind\.config/,           action: "server_restart" },
  { pattern: /postcss\.config/,            action: "server_restart" },
  { pattern: /nginx\.conf/i,              action: "server_restart" },
  { pattern: /Cargo\.toml/,               action: "server_restart" },
];

export function detectDeploymentActions(recentActivity: string[]): DeploymentAction[] {
  const found = new Set<DeploymentAction>();

  // Only check write/edit activities (not reads or bash)
  const writeActivities = recentActivity.filter(
    (a) => a.startsWith("write:") || a.startsWith("edit:") || a.startsWith("Write:") || a.startsWith("Edit:"),
  );

  for (const activity of writeActivities) {
    for (const { pattern, action } of DEPLOYMENT_PATTERNS) {
      if (pattern.test(activity)) {
        found.add(action);
      }
    }
  }

  return found.size > 0 ? Array.from(found) : ["none"];
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

export function selectKnowledgeModule(
  trigger: SuperBroTrigger,
  context?: Pick<SuperBroContext, "deployment">,
): string {
  // When Claude responded and file changes need deployment action,
  // use the more specific post-change module
  if (
    trigger === "claude_response" &&
    context?.deployment &&
    context.deployment.actions[0] !== "none"
  ) {
    return "knowledge-post-change";
  }
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

  // Layer 2: Situation-specific knowledge (deployment-aware routing)
  const moduleName = selectKnowledgeModule(trigger, context);
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
CLAUDE.md: ${context.project.claudeMdExists ? "present" : "NOT FOUND"}
Tech Stack: ${context.project.techStack}
${context.guide ? (context.guide.allDone ? `Implementation Guide: All ${context.guide.totalSessions} sessions complete — spec: ${context.guide.specFilename}` : `Implementation Guide: Session ${context.guide.currentSession} of ${context.guide.totalSessions} (${context.guide.currentSessionName}) — spec: ${context.guide.specFilename}`) : "No Implementation Guide active"}
Git: ${context.gitStatus.changedFiles} files changed, ${context.gitStatus.uncommitted ? "not committed" : "clean"}
${observationBlock}

TRIGGER: ${trigger}

CLAUDE CODE'S LAST MESSAGE:
${context.lastClaudeMessage}

RECENT ACTIVITY (what Claude did):
${context.recentActivity.join("\n")}

${context.terminalOutput ? `TERMINAL OUTPUT (last 30 lines):\n${context.terminalOutput}` : ""}
${context.previewErrors.length > 0 ? `PREVIEW ERRORS:\n${context.previewErrors.join("\n")}` : ""}
${context.deployment.actions[0] !== "none" ? `DEPLOYMENT STATUS:\nActions needed: ${context.deployment.actions.join(", ")}\nDev server running: ${context.deployment.devServerRunning ? "YES" : "no"}` : ""}
${context.testing.testFilesCreated || context.testing.testSuiteRan
  ? `TESTING STATUS:\nTest files created: ${context.testing.testFilesCreated ? "YES (" + context.testing.testFilePaths.join(", ") + ")" : "NO"}\nTest suite ran: ${context.testing.testSuiteRan ? "YES" : "NO"}`
  : "TESTING STATUS: No test activity detected in this session"}

What should the user do next? If everything looks fine, respond with NOTHING_TO_REPORT.
`.trim();

  // Enforce total input budget: ~15000 tokens ≈ ~60000 chars
  // System prompt (persona + module) is ~3500 tokens; user message can use up to ~15000 tokens (~60000 chars)
  // Free models have 1M+ context; even worst-case fills <6% of the smallest paid model (128K)
  const MAX_USER_MESSAGE_CHARS = 60000;
  const truncatedUserMessage =
    userMessage.length > MAX_USER_MESSAGE_CHARS
      ? userMessage.slice(0, MAX_USER_MESSAGE_CHARS) + "\n[...truncated]"
      : userMessage;

  return { systemPrompt, userMessage: truncatedUserMessage };
}
