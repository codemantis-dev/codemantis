import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";

// Mock tauri-commands + toastStore so the helper doesn't hit IPC in tests.
vi.mock("./tauri-commands", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  setSessionMode: vi.fn().mockResolvedValue(undefined),
  writeFileContent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../stores/toastStore", () => ({
  showToast: vi.fn(),
}));
vi.mock("./error-handler", () => ({
  handleError: vi.fn(),
}));

import { implementPendingPlan, persistPlanDocument } from "./plan-actions";
import { sendMessage, setSessionMode, writeFileContent } from "./tauri-commands";
import { showToast } from "../stores/toastStore";

const SESSION_ID = "session-abc";

function seedSession(): void {
  useSessionStore.setState({
    sessions: new Map([[
      SESSION_ID,
      {
        id: SESSION_ID,
        name: "Test",
        project_path: "/tmp/test",
        status: "connected",
        created_at: new Date().toISOString(),
        model: null,
        icon_index: 0,
      },
    ]]),
    activeSessionId: SESSION_ID,
    sessionBusy: new Map(),
    sessionModes: new Map([[SESSION_ID, "normal"]]),
    sessionMessages: new Map([[SESSION_ID, []]]),
  });
}

function seedPending(): void {
  useUiStore.setState({
    showPlanCompleteModal: true,
    planCompleteSessionId: SESSION_ID,
    planCompleteFilePath: "/plans/p.md",
    planCompleteContent: "## body",
    pendingPlanSessionId: SESSION_ID,
  });
}

describe("implementPendingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSession();
    seedPending();
  });

  it("sends the implement prompt and clears pending state", async () => {
    await implementPendingPlan(SESSION_ID, false);

    expect(sendMessage).toHaveBeenCalledWith(
      SESSION_ID,
      "Go ahead, implement the plan.",
    );

    const ui = useUiStore.getState();
    expect(ui.showPlanCompleteModal).toBe(false);
    expect(ui.pendingPlanSessionId).toBeNull();
    expect(ui.planCompleteFilePath).toBeNull();
    expect(ui.planCompleteContent).toBeNull();
    expect(ui.planCompleteSessionId).toBeNull();
  });

  it("adds the implement message to the session chat", async () => {
    await implementPendingPlan(SESSION_ID, false);

    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Go ahead, implement the plan.");
  });

  it("marks the session busy", async () => {
    await implementPendingPlan(SESSION_ID, false);
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(true);
  });

  it("does nothing and shows a toast when the session is busy", async () => {
    useSessionStore.setState({
      sessionBusy: new Map([[SESSION_ID, true]]),
    });

    await implementPendingPlan(SESSION_ID, false);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("busy"),
      "info",
    );
    // Pending state is NOT cleared — the user can still click Review.
    expect(useUiStore.getState().pendingPlanSessionId).toBe(SESSION_ID);
  });

  it("does NOT flip session mode when autoAccept is false", async () => {
    await implementPendingPlan(SESSION_ID, false);
    expect(setSessionMode).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessionModes.get(SESSION_ID)).toBe("normal");
  });

  it("flips session mode to auto-accept when autoAccept is true", async () => {
    await implementPendingPlan(SESSION_ID, true);
    expect(setSessionMode).toHaveBeenCalledWith(SESSION_ID, "auto-accept");
    expect(useSessionStore.getState().sessionModes.get(SESSION_ID)).toBe(
      "auto-accept",
    );
  });

  it("clears pending state even if sendMessage throws", async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("IPC down"));

    await implementPendingPlan(SESSION_ID, false);

    // Busy flag reset on send error.
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(false);
    // Pending state cleared — the user-visible chat message is already there,
    // keeping the banner would be misleading.
    expect(useUiStore.getState().pendingPlanSessionId).toBeNull();
  });
});

describe("persistPlanDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSession();
  });

  it("writes a plan markdown file under <project>/plans/ with a header", async () => {
    await persistPlanDocument(SESSION_ID, "# Add feature X\n\nStep 1...");
    expect(writeFileContent).toHaveBeenCalledTimes(1);
    const [filePath, content] = vi.mocked(writeFileContent).mock.calls[0];
    expect(filePath).toMatch(/^\/tmp\/test\/plans\/plan-\d{8}-\d{6}-add-feature-x\.md$/);
    expect(content).toContain("# Plan — Test");
    expect(content).toContain("Agent: Claude Code");
    expect(content).toContain("# Add feature X");
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("Plan saved to plans/"),
      "success",
    );
  });

  it("labels the agent as Codex for codex sessions", async () => {
    useSessionStore.setState({
      sessions: new Map([[
        SESSION_ID,
        {
          id: SESSION_ID,
          agent_id: "codex",
          name: "Test",
          project_path: "/tmp/test",
          status: "connected",
          created_at: new Date().toISOString(),
          model: null,
          icon_index: 0,
        },
      ]]),
    });
    await persistPlanDocument(SESSION_ID, "Plan body");
    const [, content] = vi.mocked(writeFileContent).mock.calls[0];
    expect(content).toContain("Agent: Codex");
  });

  it("no-ops when the plan content is empty", async () => {
    await persistPlanDocument(SESSION_ID, "   ");
    expect(writeFileContent).not.toHaveBeenCalled();
  });

  it("no-ops when the session has no project path", async () => {
    useSessionStore.setState({ sessions: new Map() });
    await persistPlanDocument("missing", "Plan body");
    expect(writeFileContent).not.toHaveBeenCalled();
  });
});
