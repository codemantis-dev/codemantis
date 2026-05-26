import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";
import { useSessionStore } from "../stores/sessionStore";
import type { ToolApprovalRequestEvent } from "../types/claude-events";

// Capture callbacks registered by the hook
let toolApprovalCallback: ((event: ToolApprovalRequestEvent) => void) | null = null;
let sessionModeCallback: ((event: { sessionId: string; mode: string }) => void) | null = null;

// Hoist mock functions so they're available in vi.mock factories
const {
  mockUnlistenApproval,
  mockUnlistenMode,
  mockResolveToolApproval,
} = vi.hoisted(() => ({
  mockUnlistenApproval: vi.fn(),
  mockUnlistenMode: vi.fn(),
  mockResolveToolApproval: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/tauri-commands", () => ({
  listenToolApprovalRequests: vi.fn((cb: (event: ToolApprovalRequestEvent) => void) => {
    toolApprovalCallback = cb;
    return Promise.resolve(mockUnlistenApproval);
  }),
  listenSessionModeChanged: vi.fn((cb: (event: { sessionId: string; mode: string }) => void) => {
    sessionModeCallback = cb;
    return Promise.resolve(mockUnlistenMode);
  }),
  resolveToolApproval: mockResolveToolApproval,
}));

import { useToolApprovalListener } from "./useToolApprovalListener";

describe("useToolApprovalListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolApprovalCallback = null;
    sessionModeCallback = null;

    useActivityStore.setState({
      sessionEntries: new Map(),
      sessionQuestions: new Map(),
      alwaysAllowedTools: new Map(),
      approvalQueue: [],
      approvalSeenIds: new Set(),
      currentApprovalIndex: 0,
    });
    useUiStore.setState({
      showApprovalModal: false,
      showQuestionModal: false,
    });
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionModes: new Map(),
      tabOrder: [],
    });
  });

  it("registers listeners on mount", async () => {
    renderHook(() => useToolApprovalListener());
    // Allow promises to settle
    await vi.waitFor(() => {
      expect(toolApprovalCallback).not.toBeNull();
      expect(sessionModeCallback).not.toBeNull();
    });
  });

  it("AskUserQuestion routes to QuestionModal", async () => {
    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    toolApprovalCallback!({
      requestId: "req-1",
      toolName: "AskUserQuestion",
      toolInput: { question: "What should I do?" },
      forgeSessionId: "s1",
    });

    expect(useUiStore.getState().showQuestionModal).toBe(true);
    const pq = useActivityStore.getState().sessionQuestions.get("s1");
    expect(pq).toBeDefined();
    expect(pq!.requestId).toBe("req-1");
  });

  it("AskUserQuestion parses simple text question", async () => {
    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    toolApprovalCallback!({
      requestId: "req-2",
      toolName: "AskUserQuestion",
      toolInput: { question: "Which file?" },
      forgeSessionId: "s1",
    });

    const pq = useActivityStore.getState().sessionQuestions.get("s1");
    expect(pq!.question).toBe("Which file?");
    expect(pq!.questions).toBeUndefined();
  });

  it("AskUserQuestion parses multi-question with options", async () => {
    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    toolApprovalCallback!({
      requestId: "req-3",
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          {
            header: "Pick a framework",
            question: "Which frontend framework should we use?",
            multiSelect: false,
            options: [
              { label: "React", value: "react", description: "UI library" },
              { label: "Vue", value: "vue", description: "Progressive framework" },
            ],
          },
        ],
      },
      forgeSessionId: "s1",
    });

    const pq = useActivityStore.getState().sessionQuestions.get("s1");
    expect(pq!.questions).toHaveLength(1);
    expect(pq!.questions![0].header).toBe("Pick a framework");
    expect(pq!.questions![0].question).toBe("Which frontend framework should we use?");
    expect(pq!.questions![0].options).toHaveLength(2);
    expect(pq!.questions![0].options[0].value).toBe("react");
  });

  it("AskUserQuestion defaults question to empty string when missing", async () => {
    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    toolApprovalCallback!({
      requestId: "req-3b",
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          {
            header: "Legacy",
            multiSelect: false,
            options: [{ label: "A", value: "a", description: "" }],
          },
        ],
      },
      forgeSessionId: "s1",
    });

    const pq = useActivityStore.getState().sessionQuestions.get("s1");
    expect(pq!.questions![0].question).toBe("");
  });

  it("always-allowed tool auto-approves and calls resolveToolApproval", async () => {
    // Pre-configure "Write" as always-allowed for session s1
    useActivityStore.getState().addAlwaysAllowedTool("s1", "Write");

    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    toolApprovalCallback!({
      requestId: "req-4",
      toolName: "Write",
      toolInput: { path: "/tmp/file.txt" },
      forgeSessionId: "s1",
    });

    expect(mockResolveToolApproval).toHaveBeenCalledWith("req-4", true);
  });

  it("always-allowed tool adds auto-approved activity entry", async () => {
    useActivityStore.getState().addAlwaysAllowedTool("s1", "Write");

    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    toolApprovalCallback!({
      requestId: "req-5",
      toolName: "Write",
      toolInput: { path: "/tmp/file.txt" },
      forgeSessionId: "s1",
    });

    const entries = useActivityStore.getState().sessionEntries.get("s1") ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].approvalStatus).toBe("approved");
    expect(entries[0].result).toContain("Auto-approved");
  });

  it("non-allowed tool enqueues approval", async () => {
    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    toolApprovalCallback!({
      requestId: "req-6",
      toolName: "Execute",
      toolInput: { command: "rm -rf /" },
      forgeSessionId: "s1",
    });

    const queue = useActivityStore.getState().approvalQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].toolName).toBe("Execute");
    expect(queue[0].requestId).toBe("req-6");
  });

  it("non-allowed tool shows approval modal", async () => {
    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    toolApprovalCallback!({
      requestId: "req-7",
      toolName: "Execute",
      toolInput: { command: "ls" },
      forgeSessionId: "s1",
    });

    expect(useUiStore.getState().showApprovalModal).toBe(true);
  });

  it("opens modal unconditionally — second approval while modal already open still enqueues + reopens", async () => {
    // Defect #4 of the Codex-stuck bug: the previous implementation
    // gated `setShowApprovalModal(true)` behind a `!showApprovalModal`
    // check. If the flag was stuck at true (route change, prior
    // session, modal closed visually but flag not reset), the new
    // approval went into the queue but no UI surfaced. Regression
    // pin: with the modal already open, a fresh approval must still
    // enqueue AND keep `showApprovalModal === true` after the call.
    useUiStore.setState({ showApprovalModal: true });

    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    let setCallCount = 0;
    const origSet = useUiStore.getState().setShowApprovalModal;
    useUiStore.setState({
      setShowApprovalModal: (next: boolean) => {
        setCallCount += 1;
        origSet(next);
      },
    });

    toolApprovalCallback!({
      requestId: "req-9",
      toolName: "Execute",
      toolInput: { command: "rm -rf /" },
      forgeSessionId: "s1",
    });

    expect(useActivityStore.getState().approvalQueue).toHaveLength(1);
    expect(useUiStore.getState().showApprovalModal).toBe(true);
    // The fix is precisely about NOT skipping this call when the
    // modal is already open.
    expect(setCallCount).toBe(1);
  });

  it("session mode change updates sessionStore", async () => {
    renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(sessionModeCallback).not.toBeNull());

    sessionModeCallback!({ sessionId: "s1", mode: "auto-accept" });

    expect(useSessionStore.getState().sessionModes.get("s1")).toBe("auto-accept");
  });

  it("cleanup calls unlisten functions", async () => {
    const { unmount } = renderHook(() => useToolApprovalListener());
    await vi.waitFor(() => expect(toolApprovalCallback).not.toBeNull());

    unmount();

    expect(mockUnlistenApproval).toHaveBeenCalled();
    expect(mockUnlistenMode).toHaveBeenCalled();
  });
});
