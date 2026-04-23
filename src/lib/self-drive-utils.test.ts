import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Message } from "../types/session";
import type { ImplementationGuide } from "../types/implementation-guide";
import type { ActivityEntry } from "../types/activity";

// guideStore needs tauri-commands for persistence
vi.mock("./tauri-commands", () => ({
  saveGuide: vi.fn(() => Promise.resolve("guide-1")),
  loadGuide: vi.fn(() => Promise.resolve(null)),
  updateGuideData: vi.fn(() => Promise.resolve()),
  deleteGuide: vi.fn(() => Promise.resolve()),
  deleteGuidesForProject: vi.fn(() => Promise.resolve()),
}));

import { useGuideStore } from "../stores/guideStore";
import { useActivityStore } from "../stores/activityStore";
import {
  extractToolsFromTurn,
  getCurrentSessionPlan,
} from "./self-drive-utils";

const SID = "session-sd-util";

function makeActivity(overrides: Partial<ActivityEntry> & { messageId: string; toolName: string }): ActivityEntry {
  return {
    id: `act-${Math.random().toString(36).slice(2, 8)}`,
    toolUseId: `tu-${Math.random().toString(36).slice(2, 8)}`,
    toolInput: {},
    status: "done",
    timestamp: new Date().toISOString(),
    isError: false,
    ...overrides,
  };
}

function makeGuide(): ImplementationGuide {
  return {
    id: "g-1",
    projectPath: "/test",
    specFilename: "spec.md",
    auditFilename: "audit.md",
    title: "Test",
    sessions: [
      {
        index: 1,
        name: "Foundation",
        scope: "Phase 1",
        readSections: "Sec 1",
        files: ["a.ts"],
        prompt: "Build",
        verifyChecks: [
          { id: "v-1-0", label: "TypeScript compiles", checked: false },
          { id: "v-1-1", label: "Tests pass correctly", checked: false },
          { id: "v-1-2", label: "Build succeeds with no errors", checked: true },
        ],
        status: "active",
      },
      {
        index: 2,
        name: "Features",
        scope: "Phase 2",
        readSections: "Sec 2",
        files: ["b.ts"],
        prompt: "Build features",
        verifyChecks: [
          { id: "v-2-0", label: "API responds", checked: false },
        ],
        status: "pending",
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
  };
}

// ── extractToolsFromTurn ──────────────────────────────────────────

describe("extractToolsFromTurn", () => {
  beforeEach(() => {
    // Clear activity store between tests so entries don't leak.
    useActivityStore.setState({
      sessionEntries: new Map(),
      sessionQuestions: new Map(),
    });
  });

  it("picks up tool names from the activity store (even when msg.activityIds is empty)", () => {
    // Regression: msg.activityIds is always [] in production — the fix is to
    // read from activityStore by (sessionId, messageId). This is the failure
    // the user hit where Self-Drive thought Claude Code was fabricating work.
    const store = useActivityStore.getState();
    store.addEntry(SID, makeActivity({ messageId: "m2", toolName: "Write" }));
    store.addEntry(SID, makeActivity({ messageId: "m2", toolName: "Bash" }));
    store.addEntry(SID, makeActivity({ messageId: "m2", toolName: "Edit" }));

    const messages: Message[] = [
      { id: "m1", role: "user", content: "Do stuff", timestamp: "", activityIds: [], isStreaming: false },
      { id: "m2", role: "assistant", content: "Done.", timestamp: "", activityIds: [], isStreaming: false },
    ];

    const tools = extractToolsFromTurn(messages, SID);
    expect(tools).toContain("Write");
    expect(tools).toContain("Bash");
    expect(tools).toContain("Edit");
  });

  it("ignores activity entries from OTHER sessions", () => {
    // Sub-tab safety: tools used in another Claude Code session must not
    // bleed into Self-Drive's tool list.
    useActivityStore.getState().addEntry("other-session", makeActivity({
      messageId: "m2", toolName: "Write",
    }));

    const messages: Message[] = [
      { id: "m1", role: "user", content: "Do stuff", timestamp: "", activityIds: [], isStreaming: false },
      { id: "m2", role: "assistant", content: "Done.", timestamp: "", activityIds: [], isStreaming: false },
    ];

    const tools = extractToolsFromTurn(messages, SID);
    expect(tools).not.toContain("Write");
  });

  it("ignores activity entries tagged to a DIFFERENT message id", () => {
    useActivityStore.getState().addEntry(SID, makeActivity({
      messageId: "other-msg", toolName: "Bash",
    }));

    const messages: Message[] = [
      { id: "m1", role: "user", content: "Do stuff", timestamp: "", activityIds: [], isStreaming: false },
      { id: "m2", role: "assistant", content: "Done.", timestamp: "", activityIds: [], isStreaming: false },
    ];

    const tools = extractToolsFromTurn(messages, SID);
    expect(tools).not.toContain("Bash");
  });

  it("falls back to scanning assistant text when the store has no entries", () => {
    const messages: Message[] = [
      { id: "m1", role: "user", content: "Do stuff", timestamp: "", activityIds: [], isStreaming: false },
      {
        id: "m2",
        role: "assistant",
        content: "I used Read to view the file and Grep to search",
        timestamp: "",
        activityIds: [],
        isStreaming: false,
      },
    ];

    const tools = extractToolsFromTurn(messages, SID);
    expect(tools).toContain("Read");
    expect(tools).toContain("Grep");
  });

  it("stops at the last user message boundary — tools from prior turns are excluded", () => {
    const store = useActivityStore.getState();
    store.addEntry(SID, makeActivity({ messageId: "m1", toolName: "Bash" })); // old turn
    store.addEntry(SID, makeActivity({ messageId: "m3", toolName: "Read" })); // new turn

    const messages: Message[] = [
      { id: "m1", role: "assistant", content: "Old turn", timestamp: "", activityIds: [], isStreaming: false },
      { id: "m2", role: "user", content: "New turn", timestamp: "", activityIds: [], isStreaming: false },
      { id: "m3", role: "assistant", content: "New turn text", timestamp: "", activityIds: [], isStreaming: false },
    ];

    const tools = extractToolsFromTurn(messages, SID);
    expect(tools).toContain("Read");
    // Old turn's Bash must not leak in.
    expect(tools).not.toContain("Bash");
  });

  it("returns empty array for empty messages", () => {
    expect(extractToolsFromTurn([], SID)).toEqual([]);
  });

  it("deduplicates tool names across store entries and content scan", () => {
    const store = useActivityStore.getState();
    store.addEntry(SID, makeActivity({ messageId: "m1", toolName: "Read" }));
    store.addEntry(SID, makeActivity({ messageId: "m1", toolName: "Read" }));

    const messages: Message[] = [
      {
        id: "m1",
        role: "assistant",
        content: "Read then Read again",
        timestamp: "",
        activityIds: [],
        isStreaming: false,
      },
    ];

    const tools = extractToolsFromTurn(messages, SID);
    expect(tools.filter((t) => t === "Read")).toHaveLength(1);
  });
});

// ── getCurrentSessionPlan ─────────────────────────────────────────

describe("getCurrentSessionPlan", () => {
  beforeEach(() => {
    useGuideStore.setState({ guide: makeGuide() });
  });

  it("returns session plan for valid index", () => {
    const plan = getCurrentSessionPlan(1);
    expect(plan).not.toBeNull();
    expect(plan!.index).toBe(1);
    expect(plan!.name).toBe("Foundation");
    expect(plan!.verifyChecks).toEqual([
      { label: "TypeScript compiles", kind: undefined },
      { label: "Tests pass correctly", kind: undefined },
      { label: "Build succeeds with no errors", kind: undefined },
    ]);
  });

  it("indicates last session correctly", () => {
    const plan1 = getCurrentSessionPlan(1);
    expect(plan1!.isLastSession).toBe(false);

    const plan2 = getCurrentSessionPlan(2);
    expect(plan2!.isLastSession).toBe(true);
  });

  it("includes audit document flag", () => {
    const plan = getCurrentSessionPlan(1);
    expect(plan!.hasAuditDocument).toBe(true);

    // Without audit filename
    const guide = makeGuide();
    guide.auditFilename = null;
    useGuideStore.setState({ guide });
    const planNoAudit = getCurrentSessionPlan(1);
    expect(planNoAudit!.hasAuditDocument).toBe(false);
  });

  it("returns null for non-existent session", () => {
    expect(getCurrentSessionPlan(99)).toBeNull();
  });

  it("returns null when no guide is loaded", () => {
    useGuideStore.setState({ guide: null });
    expect(getCurrentSessionPlan(1)).toBeNull();
  });
});
