import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import * as React from "react";
import PreviewLoadingModal from "./PreviewLoadingModal";
import { usePreviewStore } from "../../stores/previewStore";
import { useSessionStore } from "../../stores/sessionStore";

// Capture the latest registered "dev-server-progress" handler so tests can
// fire fake events at it. The Tauri event bridge is replaced with this
// minimal mock — the real implementation is exercised by the Rust side.
type ProgressHandler = (e: { payload: unknown }) => void;
const progressHandlers: ProgressHandler[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (_event: string, handler: ProgressHandler): Promise<() => void> => {
      progressHandlers.push(handler);
      return () => {
        const idx = progressHandlers.indexOf(handler);
        if (idx >= 0) progressHandlers.splice(idx, 1);
      };
    },
  ),
}));

// Mock Radix Dialog portal to render inline
vi.mock("@radix-ui/react-dialog", () => {
  return {
    Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open !== false ? children : null,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "dialog-overlay" }, children),
    Content: ({
      children,
      ...rest
    }: {
      children: React.ReactNode;
      onPointerDownOutside?: unknown;
      onEscapeKeyDown?: unknown;
    }) =>
      React.createElement("div", { "data-testid": "dialog-content", ...rest }, children),
    Title: ({ children }: { children: React.ReactNode }) =>
      React.createElement("h2", null, children),
    Description: ({ children }: { children: React.ReactNode }) =>
      React.createElement("p", null, children),
  };
});

const PROJECT = "/tmp/my-project";

function resetStores(): void {
  usePreviewStore.setState({
    devServer: new Map(),
    previewOpen: new Map(),
    consoleLogs: new Map(),
    consoleDrawerOpen: false,
    viewportPreset: "desktop",
    unreadErrors: new Map(),
    previewUrlPrompt: null,
  });
  useSessionStore.setState({
    activeProjectPath: PROJECT,
    sessions: new Map(),
    activeSessionId: null,
    tabOrder: [],
    projectOrder: [],
  });
}

describe("PreviewLoadingModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    progressHandlers.length = 0;
    resetStores();
  });

  it("does not render when no active project path", () => {
    useSessionStore.setState({ activeProjectPath: null });
    const { container } = render(<PreviewLoadingModal />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when no devServer entry exists for the project", () => {
    const { container } = render(<PreviewLoadingModal />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when devServer status is idle", () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "",
      sessionId: "",
      port: null,
      url: null,
      status: "idle",
    });
    const { container } = render(<PreviewLoadingModal />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when devServer status is running", () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: 3000,
      url: "http://localhost:3000",
      status: "running",
    });
    const { container } = render(<PreviewLoadingModal />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when devServer status is error", () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "",
      sessionId: "",
      port: null,
      url: null,
      status: "error",
      errorMessage: "Failed",
    });
    const { container } = render(<PreviewLoadingModal />);
    expect(container.innerHTML).toBe("");
  });

  it("renders when devServer status is starting", () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "",
      sessionId: "",
      port: null,
      url: null,
      status: "starting",
    });
    render(<PreviewLoadingModal />);
    expect(screen.getByTestId("dialog-overlay")).toBeTruthy();
    expect(screen.getByTestId("dialog-content")).toBeTruthy();
  });

  it("renders when devServer status is scanning", () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: null,
      url: null,
      status: "scanning",
    });
    render(<PreviewLoadingModal />);
    expect(screen.getByTestId("dialog-overlay")).toBeTruthy();
    expect(screen.getByTestId("dialog-content")).toBeTruthy();
  });

  it("shows correct title and description text", () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "",
      sessionId: "",
      port: null,
      url: null,
      status: "starting",
    });
    render(<PreviewLoadingModal />);
    // The title contains &hellip; which renders as "Opening preview…"
    expect(screen.getByText(/Opening preview/)).toBeTruthy();
    expect(screen.getByText(/Starting the dev server/)).toBeTruthy();
    expect(screen.getByText(/This may take a moment/)).toBeTruthy();
  });

  it("disappears when status transitions from starting to running", () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "",
      sessionId: "",
      port: null,
      url: null,
      status: "starting",
    });
    const { container, rerender } = render(<PreviewLoadingModal />);
    expect(screen.getByTestId("dialog-content")).toBeTruthy();

    // Simulate status change to running
    usePreviewStore.getState().setDevServer(PROJECT, {
      port: 3000,
      url: "http://localhost:3000",
      status: "running",
    });
    rerender(<PreviewLoadingModal />);
    expect(container.innerHTML).toBe("");
  });

  it("disappears when status transitions from scanning to error", () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: null,
      url: null,
      status: "scanning",
    });
    const { container, rerender } = render(<PreviewLoadingModal />);
    expect(screen.getByTestId("dialog-content")).toBeTruthy();

    // Simulate status change to error
    usePreviewStore.getState().setDevServer(PROJECT, {
      status: "error",
      errorMessage: "Could not detect port",
    });
    rerender(<PreviewLoadingModal />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render for a different project", () => {
    // DevServer is starting for a DIFFERENT project
    usePreviewStore.getState().setDevServer("/other/project", {
      terminalId: "",
      sessionId: "",
      port: null,
      url: null,
      status: "starting",
    });
    const { container } = render(<PreviewLoadingModal />);
    expect(container.innerHTML).toBe("");
  });

  // ── Progress transcript ───────────────────────────────────────────
  // The transcript surfaces detection-stage messages so the user sees
  // why a slow start is slow. Three rules matter:
  //   - only events for the active project show up
  //   - consecutive duplicate messages collapse (probe noise)
  //   - the visible window is capped (oldest drops off)

  function fireProgress(message: string, projectPath = PROJECT): void {
    act(() => {
      for (const h of progressHandlers) {
        h({ payload: { projectPath, stage: "probing", message, port: null } });
      }
    });
  }

  it("renders progress transcript lines for the active project", async () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: null,
      url: null,
      status: "scanning",
    });
    render(<PreviewLoadingModal />);

    // The listener registers asynchronously inside useEffect's then() —
    // wait for it before firing events.
    await waitFor(() => expect(progressHandlers.length).toBeGreaterThan(0));

    fireProgress("Scanning terminal output…");
    fireProgress("Detected port 5173, verifying…");

    expect(screen.getByText(/Scanning terminal output/)).toBeTruthy();
    expect(screen.getByText(/Detected port 5173/)).toBeTruthy();
  });

  it("ignores progress events for other projects", async () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: null,
      url: null,
      status: "scanning",
    });
    render(<PreviewLoadingModal />);
    await waitFor(() => expect(progressHandlers.length).toBeGreaterThan(0));

    fireProgress("Stale event from other project", "/some/other/project");

    expect(screen.queryByText(/Stale event/)).toBeNull();
  });

  it("collapses consecutive duplicate messages", async () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: null,
      url: null,
      status: "scanning",
    });
    render(<PreviewLoadingModal />);
    await waitFor(() => expect(progressHandlers.length).toBeGreaterThan(0));

    fireProgress("Probing port 5173…");
    fireProgress("Probing port 5173…");
    fireProgress("Probing port 5173…");

    // Only one transcript row even though the event fired three times.
    const matches = screen.getAllByText(/Probing port 5173/);
    expect(matches).toHaveLength(1);
  });

  it("caps the transcript at three visible lines", async () => {
    usePreviewStore.getState().setDevServer(PROJECT, {
      terminalId: "term-1",
      sessionId: "devserver-abc",
      port: null,
      url: null,
      status: "scanning",
    });
    render(<PreviewLoadingModal />);
    await waitFor(() => expect(progressHandlers.length).toBeGreaterThan(0));

    fireProgress("line 1");
    fireProgress("line 2");
    fireProgress("line 3");
    fireProgress("line 4");
    fireProgress("line 5");

    expect(screen.queryByText("line 1")).toBeNull();
    expect(screen.queryByText("line 2")).toBeNull();
    expect(screen.getByText("line 3")).toBeTruthy();
    expect(screen.getByText("line 4")).toBeTruthy();
    expect(screen.getByText("line 5")).toBeTruthy();
  });
});
