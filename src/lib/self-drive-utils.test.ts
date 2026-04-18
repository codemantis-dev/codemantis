import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Message } from "../types/session";
import type { ImplementationGuide } from "../types/implementation-guide";

// guideStore needs tauri-commands for persistence
vi.mock("./tauri-commands", () => ({
  saveGuide: vi.fn(() => Promise.resolve("guide-1")),
  loadGuide: vi.fn(() => Promise.resolve(null)),
  updateGuideData: vi.fn(() => Promise.resolve()),
  deleteGuide: vi.fn(() => Promise.resolve()),
  deleteGuidesForProject: vi.fn(() => Promise.resolve()),
}));

import { useGuideStore } from "../stores/guideStore";
import {
  extractToolsFromTurn,
  truncateResponse,
  getCurrentSessionPlan,
} from "./self-drive-utils";

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
  it("extracts tool names from activity IDs", () => {
    const messages: Message[] = [
      { id: "m1", role: "user", content: "Do stuff", timestamp: "", activityIds: [], isStreaming: false },
      {
        id: "m2",
        role: "assistant",
        content: "Done",
        timestamp: "",
        activityIds: ["read-123456", "write-789012", "bash-345678"],
        isStreaming: false,
      },
    ];

    const tools = extractToolsFromTurn(messages);
    expect(tools).toContain("read");
    expect(tools).toContain("write");
    expect(tools).toContain("bash");
  });

  it("extracts tool names from content patterns", () => {
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

    const tools = extractToolsFromTurn(messages);
    expect(tools).toContain("Read");
    expect(tools).toContain("Grep");
  });

  it("stops at the last user message boundary", () => {
    const messages: Message[] = [
      {
        id: "m1",
        role: "assistant",
        content: "Old turn with Bash",
        timestamp: "",
        activityIds: ["bash-111"],
        isStreaming: false,
      },
      { id: "m2", role: "user", content: "New turn", timestamp: "", activityIds: [], isStreaming: false },
      {
        id: "m3",
        role: "assistant",
        content: "New turn using Read",
        timestamp: "",
        activityIds: ["read-222"],
        isStreaming: false,
      },
    ];

    const tools = extractToolsFromTurn(messages);
    expect(tools).toContain("read");
    expect(tools).toContain("Read");
    // Should NOT contain tools from old turn
    expect(tools).not.toContain("bash");
  });

  it("returns empty array for empty messages", () => {
    expect(extractToolsFromTurn([])).toEqual([]);
  });

  it("deduplicates tool names", () => {
    const messages: Message[] = [
      {
        id: "m1",
        role: "assistant",
        content: "Read then Read again",
        timestamp: "",
        activityIds: ["read-111", "read-222"],
        isStreaming: false,
      },
    ];

    const tools = extractToolsFromTurn(messages);
    const readCount = tools.filter((t) => t.toLowerCase() === "read").length;
    // Each source (activity ID pattern vs content pattern) produces a separate entry
    // but within each source, Set ensures uniqueness
    expect(readCount).toBeLessThanOrEqual(2);
  });
});

// ── truncateResponse ──────────────────────────────────────────────

describe("truncateResponse", () => {
  it("returns short content unchanged", () => {
    expect(truncateResponse("Hello", 100)).toBe("Hello");
  });

  it("truncates content exceeding maxChars", () => {
    const long = "A".repeat(5000);
    const result = truncateResponse(long, 100);
    expect(result.length).toBeLessThan(5000);
    expect(result).toContain("[...truncated...]");
  });

  it("keeps beginning and end of the response", () => {
    const content = "START" + "X".repeat(5000) + "END";
    const result = truncateResponse(content, 200);
    expect(result.startsWith("START")).toBe(true);
    expect(result.endsWith("END")).toBe(true);
  });

  it("defaults to 6000 char limit", () => {
    const long = "A".repeat(7000);
    const result = truncateResponse(long);
    expect(result.length).toBeLessThan(7000);
    expect(result).toContain("[...truncated...]");
  });

  it("returns unchanged when exactly at limit", () => {
    const exact = "A".repeat(6000);
    expect(truncateResponse(exact, 6000)).toBe(exact);
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
