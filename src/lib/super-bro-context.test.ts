import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuperBroTrigger, Observation } from "../types/super-bro";

vi.mock("../stores/sessionStore", () => ({
  useSessionStore: { getState: vi.fn() },
}));
vi.mock("../stores/activityStore", () => ({
  useActivityStore: { getState: vi.fn() },
}));
vi.mock("../stores/guideStore", () => ({
  useGuideStore: { getState: vi.fn() },
}));
vi.mock("../stores/previewStore", () => ({
  usePreviewStore: { getState: vi.fn() },
}));
vi.mock("../stores/terminalStore", () => ({
  useTerminalStore: { getState: vi.fn() },
}));
vi.mock("../stores/specWriterStore", () => ({
  useSpecWriterStore: { getState: vi.fn() },
}));
vi.mock("./tauri-commands", () => ({
  readSuperBroModule: vi.fn(),
}));

import {
  selectKnowledgeModule,
  buildSuperBroContext,
  buildSuperBroRequest,
  detectDeploymentActions,
} from "./super-bro-context";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useGuideStore } from "../stores/guideStore";
import { usePreviewStore } from "../stores/previewStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { readSuperBroModule } from "./tauri-commands";

// ── Helpers ──────────────────────────────────────────────────────────

function mockStores(overrides?: {
  activeSessionId?: string | null;
  messages?: Array<{ role: string; content: string }>;
  activityEntries?: Array<{
    toolName: string;
    toolInput: Record<string, unknown>;
    status: string;
    timestamp?: string;
  }>;
  guide?: unknown;
  consoleLogs?: Array<{ level: string; message: string }>;
  specContent?: string;
  specConversation?: { mode: string } | null;
}): void {
  const sessionId = overrides?.activeSessionId ?? null;
  const messages = overrides?.messages ?? [];
  const sessionMessages = new Map<
    string,
    Array<{ role: string; content: string }>
  >();
  if (sessionId) {
    sessionMessages.set(sessionId, messages);
  }

  (useSessionStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    activeSessionId: sessionId,
    sessionMessages,
  });

  (useActivityStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    getActiveEntries: vi.fn().mockReturnValue(overrides?.activityEntries ?? []),
  });

  (useGuideStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    guide: overrides?.guide ?? null,
  });

  const consoleLogs = new Map<
    string,
    Array<{ level: string; message: string }>
  >();
  if (overrides?.consoleLogs) {
    consoleLogs.set("/test/project", overrides.consoleLogs);
  }

  (usePreviewStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    consoleLogs,
  });

  (useTerminalStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    detectedDevServers: new Map(),
  });

  const specContentMap = new Map<string, string>();
  const specConversationsMap = new Map<string, unknown>();
  if (overrides?.specContent) {
    specContentMap.set("/test/project", overrides.specContent);
  }
  if (overrides?.specConversation) {
    specConversationsMap.set("/test/project", overrides.specConversation);
  }

  (useSpecWriterStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    currentSpecContent: specContentMap,
    conversations: specConversationsMap,
  });
}

// ── selectKnowledgeModule ────────────────────────────────────────────

describe("selectKnowledgeModule", () => {
  const triggerMap: Record<SuperBroTrigger, string> = {
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

  it.each(Object.entries(triggerMap))(
    "maps trigger '%s' to module '%s'",
    (trigger, expectedModule) => {
      expect(selectKnowledgeModule(trigger as SuperBroTrigger)).toBe(
        expectedModule,
      );
    },
  );

  it("returns 'knowledge-post-change' for claude_response when deployment actions detected", () => {
    expect(
      selectKnowledgeModule("claude_response", {
        deployment: { actions: ["dependency_install"], devServerRunning: false },
      }),
    ).toBe("knowledge-post-change");
  });

  it("returns 'knowledge-claude-response' for claude_response when no deployment actions", () => {
    expect(
      selectKnowledgeModule("claude_response", {
        deployment: { actions: ["none"], devServerRunning: false },
      }),
    ).toBe("knowledge-claude-response");
  });

  it("still works without context parameter (backward compat)", () => {
    expect(selectKnowledgeModule("build_error")).toBe("knowledge-build-errors");
    expect(selectKnowledgeModule("claude_response")).toBe("knowledge-claude-response");
  });
});

// ── buildSuperBroContext ─────────────────────────────────────────────

describe("buildSuperBroContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct shape with mocked store data", () => {
    mockStores({
      activeSessionId: "sess-1",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there, how can I help?" },
      ],
      activityEntries: [
        {
          toolName: "Write",
          toolInput: { file_path: "/src/index.ts" },
          status: "done",
          timestamp: "2026-01-01T00:00:01Z",
        },
      ],
      guide: {
        status: "active",
        specFilename: "my-feature.md",
        auditFilename: "my-feature.audit.md",
        sessions: [
          { index: 1, name: "Setup", status: "done", verifyChecks: [] },
          { index: 2, name: "Core Logic", status: "active", verifyChecks: [{ label: "Tests pass" }] },
          { index: 3, name: "Testing", status: "pending", verifyChecks: [] },
        ],
      },
      consoleLogs: [
        { level: "error", message: "TypeError: undefined is not a function" },
        { level: "log", message: "render complete" },
      ],
    });

    const ctx = buildSuperBroContext(
      "/test/project",
      "$ npm run build\nDone.",
      { changedFiles: 3, uncommitted: true, branch: "feat/abc" },
      "# My Project\nReact + TypeScript",
    );

    // Project
    expect(ctx.project.path).toBe("/test/project");
    expect(ctx.project.techStack).toContain("My Project");
    expect(ctx.project.claudeMdExists).toBe(true);

    // Guide
    expect(ctx.guide).not.toBeNull();
    expect(ctx.guide!.active).toBe(true);
    expect(ctx.guide!.currentSession).toBe(2);
    expect(ctx.guide!.totalSessions).toBe(3);
    expect(ctx.guide!.completedSessions).toBe(1);
    expect(ctx.guide!.currentSessionName).toBe("Core Logic");
    expect(ctx.guide!.specFilename).toBe("my-feature.md");
    expect(ctx.guide!.auditFilename).toBe("my-feature.audit.md");
    expect(ctx.guide!.allDone).toBe(false);

    // Messages
    expect(ctx.lastClaudeMessage).toBe("Hi there, how can I help?");

    // Activity (Write entries are prioritized)
    expect(ctx.recentActivity).toHaveLength(1);
    expect(ctx.recentActivity[0]).toContain("Write");
    expect(ctx.recentActivity[0]).toContain("/src/index.ts");

    // Terminal
    expect(ctx.terminalOutput).toContain("npm run build");

    // Preview errors (only "error" level)
    expect(ctx.previewErrors).toHaveLength(1);
    expect(ctx.previewErrors[0]).toContain("TypeError");

    // Git
    expect(ctx.gitStatus.changedFiles).toBe(3);
    expect(ctx.gitStatus.uncommitted).toBe(true);
    expect(ctx.gitStatus.branch).toBe("feat/abc");

    // Spec — null when no spec in store
    expect(ctx.spec).toBeNull();

    // Deployment
    expect(ctx.deployment).toBeDefined();
    expect(typeof ctx.deployment.devServerRunning).toBe("boolean");
  });

  it("truncates lastClaudeMessage to 9000 chars", () => {
    const longMessage = "A".repeat(12000);
    mockStores({
      activeSessionId: "sess-1",
      messages: [{ role: "assistant", content: longMessage }],
    });

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.lastClaudeMessage).toHaveLength(9000);
    expect(ctx.lastClaudeMessage).toBe("A".repeat(9000));
  });

  it("prioritizes Write/Edit entries and limits Bash to last 30", () => {
    const writes = Array.from({ length: 100 }, (_, i) => ({
      toolName: "Write",
      toolInput: { file_path: `/src/file-${i}.ts` },
      status: "done",
      timestamp: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
    }));
    const bashes = Array.from({ length: 40 }, (_, i) => ({
      toolName: "Bash",
      toolInput: { command: `cmd-${i}` },
      status: "done",
      timestamp: `2026-01-01T01:${String(i).padStart(2, "0")}:00Z`,
    }));

    mockStores({
      activeSessionId: "sess-1",
      messages: [],
      activityEntries: [...writes, ...bashes],
    });

    const ctx = buildSuperBroContext("/test/project", "");

    // Last 90 writes + last 30 bashes = 120, capped at 120
    expect(ctx.recentActivity.length).toBeLessThanOrEqual(120);
    // Should include the last 90 writes (file-10 through file-99)
    expect(ctx.recentActivity.some((a) => a.includes("file-10"))).toBe(true);
    expect(ctx.recentActivity.some((a) => a.includes("file-99"))).toBe(true);
    // Should NOT include the earliest writes that were trimmed
    expect(ctx.recentActivity.some((a) => a.includes("file-0 "))).toBe(false);
    // Should include the last 30 bash entries (cmd-10 through cmd-39)
    expect(ctx.recentActivity.some((a) => a.includes("cmd-10"))).toBe(true);
    expect(ctx.recentActivity.some((a) => a.includes("cmd-39"))).toBe(true);
    // Should NOT include early bash entries
    expect(ctx.recentActivity.some((a) => a.includes("cmd-0 "))).toBe(false);
  });

  it("excludes Read/Glob/Grep entries from recentActivity (only Write/Edit/Bash)", () => {
    mockStores({
      activeSessionId: "sess-1",
      messages: [],
      activityEntries: [
        { toolName: "Read", toolInput: { file_path: "/src/a.ts" }, status: "done", timestamp: "2026-01-01T00:00:01Z" },
        { toolName: "Glob", toolInput: { pattern: "**/*.ts" }, status: "done", timestamp: "2026-01-01T00:00:02Z" },
        { toolName: "Grep", toolInput: { pattern: "TODO" }, status: "done", timestamp: "2026-01-01T00:00:03Z" },
        { toolName: "Write", toolInput: { file_path: "/src/b.ts" }, status: "done", timestamp: "2026-01-01T00:00:04Z" },
      ],
    });

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.recentActivity).toHaveLength(1);
    expect(ctx.recentActivity[0]).toContain("Write");
    expect(ctx.recentActivity[0]).toContain("/src/b.ts");
  });

  it("summarizeToolInput handles capitalized tool names (case-insensitive)", () => {
    mockStores({
      activeSessionId: "sess-1",
      messages: [],
      activityEntries: [
        { toolName: "Write", toolInput: { file_path: "/src/component.tsx" }, status: "done", timestamp: "2026-01-01T00:00:01Z" },
        { toolName: "Edit", toolInput: { file_path: "/src/utils.ts" }, status: "done", timestamp: "2026-01-01T00:00:02Z" },
        { toolName: "Bash", toolInput: { command: "cd frontend && npx tsc --noEmit" }, status: "done", timestamp: "2026-01-01T00:00:03Z" },
      ],
    });

    const ctx = buildSuperBroContext("/test/project", "");

    // Write/Edit should show clean file paths, not garbled JSON
    expect(ctx.recentActivity[0]).toBe("Write: /src/component.tsx [done]");
    expect(ctx.recentActivity[1]).toBe("Edit: /src/utils.ts [done]");
    // Bash should show the command, not JSON
    expect(ctx.recentActivity[2]).toBe("Bash: cd frontend && npx tsc --noEmit [done]");
  });

  it("summarizeToolInput handles NotebookEdit with file_path", () => {
    mockStores({
      activeSessionId: "sess-1",
      messages: [],
      activityEntries: [
        { toolName: "NotebookEdit", toolInput: { file_path: "/notebooks/analysis.ipynb" }, status: "done", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const ctx = buildSuperBroContext("/test/project", "");

    // NotebookEdit is classified as a write, so it appears in recentActivity
    expect(ctx.recentActivity).toHaveLength(1);
    expect(ctx.recentActivity[0]).toContain("/notebooks/analysis.ipynb");
    // Should NOT contain JSON braces
    expect(ctx.recentActivity[0]).not.toContain("{");
  });

  it("extracts tech stack from CLAUDE.md content (first 5 lines)", () => {
    const claudeMd = `# CodeMantis
Tauri v2 + React 19 + TypeScript + Rust
Some more description here that goes on and on.`;

    mockStores();

    const ctx = buildSuperBroContext("/test/project", "", undefined, claudeMd);

    expect(ctx.project.techStack).toContain("CodeMantis");
    expect(ctx.project.techStack).toContain("Tauri v2");
    expect(ctx.project.techStack.length).toBeLessThanOrEqual(2400);
  });

  it("extractTechStack finds Docker info deeper in CLAUDE.md", () => {
    const claudeMd = `# My App
A web application.


Some description.
More description.
Even more.
Yet more.
## Architecture
Docker Compose with nginx + FastAPI + React
Uses Postgres in containers.`;

    mockStores();

    const ctx = buildSuperBroContext("/test/project", "", undefined, claudeMd);

    // Should find the Architecture section and Docker reference
    expect(ctx.project.techStack).toContain("Architecture");
    expect(ctx.project.techStack).toContain("Docker");
  });

  it("handles empty stores gracefully", () => {
    mockStores();

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.project.path).toBe("/test/project");
    expect(ctx.project.techStack).toBe("Unknown");
    expect(ctx.project.claudeMdExists).toBe(false);
    expect(ctx.guide).toBeNull();
    expect(ctx.spec).toBeNull();
    expect(ctx.lastClaudeMessage).toBe("");
    expect(ctx.recentActivity).toEqual([]);
    expect(ctx.terminalOutput).toBe("");
    expect(ctx.previewErrors).toEqual([]);
    expect(ctx.gitStatus).toEqual({
      changedFiles: 0,
      uncommitted: false,
      branch: "main",
    });
  });

  it("includes guide context when guide status is 'completed' (all sessions done)", () => {
    mockStores({
      guide: {
        status: "completed",
        specFilename: "ai-potential-analysis.md",
        auditFilename: "ai-potential-analysis.audit.md",
        sessions: [
          { index: 1, name: "Setup", status: "done", verifyChecks: [{ label: "DB ready" }] },
          { index: 2, name: "Data Collection", status: "done", verifyChecks: [{ label: "Rating buttons render" }] },
        ],
      },
    });

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.guide).not.toBeNull();
    expect(ctx.guide!.allDone).toBe(true);
    expect(ctx.guide!.active).toBe(false);
    expect(ctx.guide!.completedSessions).toBe(2);
    expect(ctx.guide!.totalSessions).toBe(2);
    expect(ctx.guide!.currentSessionName).toBe("All sessions complete");
    expect(ctx.guide!.specFilename).toBe("ai-potential-analysis.md");
    expect(ctx.guide!.auditFilename).toBe("ai-potential-analysis.audit.md");
  });

  it("filters preview errors by level 'error'", () => {
    mockStores({
      consoleLogs: [
        { level: "log", message: "page loaded" },
        { level: "warn", message: "deprecation warning" },
        { level: "error", message: "ReferenceError: x is not defined" },
        { level: "info", message: "connected" },
        { level: "error", message: "TypeError: null is not an object" },
      ],
    });

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.previewErrors).toHaveLength(2);
    expect(ctx.previewErrors[0]).toContain("ReferenceError");
    expect(ctx.previewErrors[1]).toContain("TypeError");
  });

  it("detects deployment actions from Write/Edit activities", () => {
    mockStores({
      activeSessionId: "sess-1",
      messages: [],
      activityEntries: [
        { toolName: "Write", toolInput: { file_path: "/project/package.json" }, status: "done", timestamp: "2026-01-01T00:00:01Z" },
        { toolName: "Edit", toolInput: { file_path: "/project/Dockerfile" }, status: "done", timestamp: "2026-01-01T00:00:02Z" },
      ],
    });

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.deployment.actions).toContain("dependency_install");
    expect(ctx.deployment.actions).toContain("container_rebuild");
  });

  it("resolves spec from specWriterStore when content exists", () => {
    mockStores({
      specContent: "# My Spec\nSome spec content here.",
      specConversation: { mode: "new_application" },
    });

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.spec).not.toBeNull();
    expect(ctx.spec!.hasActiveSpec).toBe(true);
    expect(ctx.spec!.title).toContain("new application");
  });

  it("returns spec as null when no spec content in store", () => {
    mockStores();

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.spec).toBeNull();
  });
});

// ── detectDeploymentActions ──────────────────────────────────────────

describe("detectDeploymentActions", () => {
  it("returns ['none'] when no write/edit activities", () => {
    const result = detectDeploymentActions([
      "read: /src/index.ts [done]",
      "bash: npm run build [done]",
    ]);
    expect(result).toEqual(["none"]);
  });

  it("returns ['none'] for empty activity list", () => {
    expect(detectDeploymentActions([])).toEqual(["none"]);
  });

  it("detects dependency_install from package.json write", () => {
    const result = detectDeploymentActions([
      "write: /project/package.json [done]",
    ]);
    expect(result).toContain("dependency_install");
  });

  it("detects container_rebuild from Dockerfile edit", () => {
    const result = detectDeploymentActions([
      "edit: /project/Dockerfile [done]",
    ]);
    expect(result).toContain("container_rebuild");
  });

  it("detects container_rebuild from docker-compose.yml", () => {
    const result = detectDeploymentActions([
      "write: /project/docker-compose.yml [done]",
    ]);
    expect(result).toContain("container_rebuild");
  });

  it("detects db_migration from schema.prisma", () => {
    const result = detectDeploymentActions([
      "write: /project/prisma/schema.prisma [done]",
    ]);
    expect(result).toContain("db_migration");
  });

  it("detects db_migration from models.py", () => {
    const result = detectDeploymentActions([
      "edit: /project/app/models.py [done]",
    ]);
    expect(result).toContain("db_migration");
  });

  it("detects env_config from .env write", () => {
    const result = detectDeploymentActions([
      "write: /project/.env [done]",
    ]);
    expect(result).toContain("env_config");
  });

  it("detects server_restart from vite.config edit", () => {
    const result = detectDeploymentActions([
      "edit: /project/vite.config.ts [done]",
    ]);
    expect(result).toContain("server_restart");
  });

  it("detects multiple actions from multiple files", () => {
    const result = detectDeploymentActions([
      "write: /project/package.json [done]",
      "edit: /project/Dockerfile [done]",
      "write: /project/prisma/schema.prisma [done]",
    ]);
    expect(result).toContain("dependency_install");
    expect(result).toContain("container_rebuild");
    expect(result).toContain("db_migration");
  });

  it("deduplicates actions", () => {
    const result = detectDeploymentActions([
      "write: /project/package.json [done]",
      "edit: /project/package.json [done]",
    ]);
    const depCount = result.filter((a) => a === "dependency_install").length;
    expect(depCount).toBe(1);
  });

  it("ignores read activities for deployment-relevant files", () => {
    const result = detectDeploymentActions([
      "read: /project/Dockerfile [done]",
      "read: /project/package.json [done]",
    ]);
    expect(result).toEqual(["none"]);
  });

  it("detects dependency_install from requirements.txt", () => {
    const result = detectDeploymentActions([
      "write: /project/requirements.txt [done]",
    ]);
    expect(result).toContain("dependency_install");
  });

  it("detects dependency_install from pyproject.toml", () => {
    const result = detectDeploymentActions([
      "edit: /project/pyproject.toml [done]",
    ]);
    expect(result).toContain("dependency_install");
  });

  it("handles Write/Edit with capital letters", () => {
    const result = detectDeploymentActions([
      "Write: /project/package.json [done]",
      "Edit: /project/.env [done]",
    ]);
    expect(result).toContain("dependency_install");
    expect(result).toContain("env_config");
  });
});

// ── buildSuperBroRequest ─────────────────────────────────────────────

describe("buildSuperBroRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // readSuperBroModule returns different content based on module name
    (readSuperBroModule as ReturnType<typeof vi.fn>).mockImplementation(
      (name: string) => {
        if (name === "persona") return Promise.resolve("You are Super Bro.");
        return Promise.resolve(`Knowledge module: ${name}`);
      },
    );
  });

  const baseContext = {
    project: { path: "/test/project", techStack: "React + TS", claudeMdExists: true },
    guide: null,
    spec: null,
    lastClaudeMessage: "I created the component.",
    recentActivity: ["Write: /src/Button.tsx [done]"],
    terminalOutput: "",
    previewErrors: [],
    gitStatus: { changedFiles: 1, uncommitted: true, branch: "main" },
    deployment: { actions: ["none" as const], devServerRunning: false },
    testing: { testFilesCreated: false, testSuiteRan: false, testFilePaths: [] },
  };

  it("combines persona + knowledge module + context + observations into systemPrompt and userMessage", async () => {
    const observations: Observation[] = [
      {
        id: "obs-1",
        text: "User prefers functional components",
        category: "preference",
        createdAt: "2026-01-01T00:00:00Z",
        lastReferencedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const { systemPrompt, userMessage } = await buildSuperBroRequest(
      "claude_response",
      baseContext,
      observations,
    );

    // System prompt = persona + knowledge
    expect(systemPrompt).toContain("You are Super Bro.");
    expect(systemPrompt).toContain(
      "Knowledge module: knowledge-claude-response",
    );

    // User message contains context fields
    expect(userMessage).toContain("/test/project");
    expect(userMessage).toContain("CLAUDE.md: present");
    expect(userMessage).toContain("React + TS");
    expect(userMessage).toContain("I created the component.");
    expect(userMessage).toContain("Write: /src/Button.tsx [done]");
    expect(userMessage).toContain("TRIGGER: claude_response");

    // User message contains observations
    expect(userMessage).toContain("PROJECT OBSERVATIONS:");
    expect(userMessage).toContain("User prefers functional components");

    // Ends with the instruction
    expect(userMessage).toContain("NOTHING_TO_REPORT");
  });

  it("includes observation block when observations exist", async () => {
    const observations: Observation[] = [
      {
        id: "obs-1",
        text: "Prefers Tailwind over CSS modules",
        category: "preference",
        createdAt: "2026-01-01T00:00:00Z",
        lastReferencedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "obs-2",
        text: "Project uses monorepo structure",
        category: "project_note",
        createdAt: "2026-01-01T00:00:00Z",
        lastReferencedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const { userMessage } = await buildSuperBroRequest(
      "build_error",
      baseContext,
      observations,
    );

    expect(userMessage).toContain("PROJECT OBSERVATIONS:");
    expect(userMessage).toContain("- Prefers Tailwind over CSS modules");
    expect(userMessage).toContain("- Project uses monorepo structure");
  });

  it("omits observation block when no observations", async () => {
    const { userMessage } = await buildSuperBroRequest(
      "session_start",
      baseContext,
      [],
    );

    expect(userMessage).not.toContain("PROJECT OBSERVATIONS:");
  });

  it("shows 'CLAUDE.md: NOT FOUND' when claudeMdExists is false", async () => {
    const noClaudeMd = {
      ...baseContext,
      project: { ...baseContext.project, claudeMdExists: false },
    };

    const { userMessage } = await buildSuperBroRequest(
      "session_start",
      noClaudeMd,
      [],
    );

    expect(userMessage).toContain("CLAUDE.md: NOT FOUND");
    expect(userMessage).not.toContain("CLAUDE.md: present");
  });

  it("includes DEPLOYMENT STATUS when actions are detected", async () => {
    const contextWithDeployment = {
      ...baseContext,
      deployment: {
        actions: ["dependency_install" as const, "server_restart" as const],
        devServerRunning: true,
      },
    };

    const { userMessage } = await buildSuperBroRequest(
      "claude_response",
      contextWithDeployment,
      [],
    );

    expect(userMessage).toContain("DEPLOYMENT STATUS:");
    expect(userMessage).toContain("dependency_install, server_restart");
    expect(userMessage).toContain("Dev server running: YES");
  });

  it("omits DEPLOYMENT STATUS when actions is ['none']", async () => {
    const { userMessage } = await buildSuperBroRequest(
      "claude_response",
      baseContext,
      [],
    );

    expect(userMessage).not.toContain("DEPLOYMENT STATUS:");
  });

  it("routes to knowledge-post-change module when deployment actions detected", async () => {
    const contextWithDeployment = {
      ...baseContext,
      deployment: {
        actions: ["container_rebuild" as const],
        devServerRunning: false,
      },
    };

    const { systemPrompt } = await buildSuperBroRequest(
      "claude_response",
      contextWithDeployment,
      [],
    );

    expect(systemPrompt).toContain("Knowledge module: knowledge-post-change");
  });
});
