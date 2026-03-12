import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ThinkingIndicator from "./ThinkingIndicator";
import { useSessionStore } from "../../stores/sessionStore";

// Mock the trivia data module to avoid loading the full dataset in tests
vi.mock("../../data/trivia", () => ({
  getRandomTrivia: () => ({
    topic: "Test Topic",
    fact: "A test trivia fact.",
    isEasterEgg: false,
  }),
  getRandomEasterEgg: () => ({
    topic: "Easter Egg",
    fact: "A secret fact.",
    isEasterEgg: true,
  }),
}));

const TEST_SESSION_ID = "test-session-1";

function setupBusySession(busySince?: number) {
  const store = useSessionStore.getState();
  store.addSession({
    id: TEST_SESSION_ID,
    name: "Test",
    project_path: "/test",
    status: "connected",
    created_at: new Date().toISOString(),
    model: null,
    icon_index: 0,
  });
  store.setSessionBusy(TEST_SESSION_ID, true);
  if (busySince) {
    useSessionStore.setState((s) => {
      const busySinceMap = new Map(s.busySince);
      busySinceMap.set(TEST_SESSION_ID, busySince);
      return { busySince: busySinceMap };
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({
    sessions: new Map(),
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    sessionStats: new Map(),
    sessionModes: new Map(),
    sessionBusy: new Map(),
    sessionEffort: new Map(),
    sessionRetry: new Map(),
    lastEventTimestamp: new Map(),
    contextToastFired: new Map(),
    sessionActivity: new Map(),
    sessionCompacting: new Map(),
    busySince: new Map(),
    rateLimitUtilization: new Map(),
    tabOrder: [],
    activeSessionId: null,
    activeProjectPath: null,
    projectOrder: [],
    projectActiveSession: new Map(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ThinkingIndicator", () => {
  it("renders default 'Thinking...' label", () => {
    setupBusySession();
    render(<ThinkingIndicator sessionId={TEST_SESSION_ID} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("shows contextual activity label when tool is running", () => {
    setupBusySession();
    useSessionStore.getState().setSessionActivity(TEST_SESSION_ID, {
      label: "Reading file...",
      toolName: "Read",
      toolElapsed: 0,
      filePath: null,
    });
    render(<ThinkingIndicator sessionId={TEST_SESSION_ID} />);
    expect(screen.getByText("Reading file...")).toBeInTheDocument();
  });

  it("shows compacting label when compacting", () => {
    setupBusySession();
    useSessionStore.getState().setSessionCompacting(TEST_SESSION_ID, true);
    render(<ThinkingIndicator sessionId={TEST_SESSION_ID} />);
    expect(screen.getByText("Compacting context...")).toBeInTheDocument();
  });

  it("shows elapsed timer when busy", () => {
    const fiveMinAgo = Date.now() - 300_000;
    setupBusySession(fiveMinAgo);
    render(<ThinkingIndicator sessionId={TEST_SESSION_ID} />);
    // Should show "5m 00s" (approximately)
    expect(screen.getByText(/5m/)).toBeInTheDocument();
  });

  it("shows tool elapsed time for long-running tools", () => {
    setupBusySession();
    useSessionStore.getState().setSessionActivity(TEST_SESSION_ID, {
      label: "Running command...",
      toolName: "Bash",
      toolElapsed: 45.2,
      filePath: null,
    });
    render(<ThinkingIndicator sessionId={TEST_SESSION_ID} />);
    expect(screen.getByText(/Running command.*\(45s\)/)).toBeInTheDocument();
  });

  it("does not render trivia card before 3 seconds", () => {
    setupBusySession();
    render(<ThinkingIndicator sessionId={TEST_SESSION_ID} />);
    expect(screen.queryByText("A test trivia fact.")).not.toBeInTheDocument();
  });

  it("renders trivia card after 3 seconds", () => {
    setupBusySession();
    render(<ThinkingIndicator sessionId={TEST_SESSION_ID} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText("A test trivia fact.")).toBeInTheDocument();
  });

  it("renders trivia card with topic badge after delay", () => {
    setupBusySession();
    render(<ThinkingIndicator sessionId={TEST_SESSION_ID} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText("Test Topic")).toBeInTheDocument();
  });
});
