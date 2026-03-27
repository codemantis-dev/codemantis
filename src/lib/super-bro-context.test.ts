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
vi.mock("./tauri-commands", () => ({
  readSuperBroModule: vi.fn(),
}));

import {
  selectKnowledgeModule,
  buildSuperBroContext,
  buildSuperBroRequest,
} from "./super-bro-context";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useGuideStore } from "../stores/guideStore";
import { usePreviewStore } from "../stores/previewStore";
import { readSuperBroModule } from "./tauri-commands";

// ── Helpers ──────────────────────────────────────────────────────────

function mockStores(overrides?: {
  activeSessionId?: string | null;
  messages?: Array<{ role: string; content: string }>;
  activityEntries?: Array<{
    toolName: string;
    toolInput: Record<string, unknown>;
    status: string;
  }>;
  guide?: unknown;
  consoleLogs?: Array<{ level: string; message: string }>;
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
          toolName: "read",
          toolInput: { file_path: "/src/index.ts" },
          status: "done",
        },
      ],
      guide: {
        status: "active",
        sessions: [
          { index: 1, name: "Setup", status: "done" },
          { index: 2, name: "Core Logic", status: "active" },
          { index: 3, name: "Testing", status: "pending" },
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

    // Guide
    expect(ctx.guide).not.toBeNull();
    expect(ctx.guide!.active).toBe(true);
    expect(ctx.guide!.currentSession).toBe(2);
    expect(ctx.guide!.totalSessions).toBe(3);
    expect(ctx.guide!.completedSessions).toBe(1);
    expect(ctx.guide!.currentSessionName).toBe("Core Logic");

    // Messages
    expect(ctx.lastClaudeMessage).toBe("Hi there, how can I help?");

    // Activity
    expect(ctx.recentActivity).toHaveLength(1);
    expect(ctx.recentActivity[0]).toContain("read");
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

    // Spec is always null in current implementation
    expect(ctx.spec).toBeNull();
  });

  it("truncates lastClaudeMessage to 500 chars", () => {
    const longMessage = "A".repeat(800);
    mockStores({
      activeSessionId: "sess-1",
      messages: [{ role: "assistant", content: longMessage }],
    });

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.lastClaudeMessage).toHaveLength(500);
    expect(ctx.lastClaudeMessage).toBe("A".repeat(500));
  });

  it("limits recentActivity to last 10 entries", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      toolName: "bash",
      toolInput: { command: `cmd-${i}` },
      status: "done",
    }));

    mockStores({
      activeSessionId: "sess-1",
      messages: [],
      activityEntries: entries,
    });

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.recentActivity).toHaveLength(10);
    // Should keep the *last* 10, so first entry should reference cmd-5
    expect(ctx.recentActivity[0]).toContain("cmd-5");
    expect(ctx.recentActivity[9]).toContain("cmd-14");
  });

  it("extracts tech stack from CLAUDE.md content", () => {
    const claudeMd = `# CodeMantis
Tauri v2 + React 19 + TypeScript + Rust
Some more description here that goes on and on.`;

    mockStores();

    const ctx = buildSuperBroContext("/test/project", "", undefined, claudeMd);

    expect(ctx.project.techStack).toContain("CodeMantis");
    expect(ctx.project.techStack).toContain("Tauri v2");
    // Should be limited to 200 chars
    expect(ctx.project.techStack.length).toBeLessThanOrEqual(200);
  });

  it("handles empty stores gracefully", () => {
    mockStores();

    const ctx = buildSuperBroContext("/test/project", "");

    expect(ctx.project.path).toBe("/test/project");
    expect(ctx.project.techStack).toBe("Unknown");
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
    project: { path: "/test/project", techStack: "React + TS" },
    guide: null,
    spec: null,
    lastClaudeMessage: "I created the component.",
    recentActivity: ["write: /src/Button.tsx [done]"],
    terminalOutput: "",
    previewErrors: [],
    gitStatus: { changedFiles: 1, uncommitted: true, branch: "main" },
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
    expect(userMessage).toContain("React + TS");
    expect(userMessage).toContain("I created the component.");
    expect(userMessage).toContain("write: /src/Button.tsx [done]");
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
});
