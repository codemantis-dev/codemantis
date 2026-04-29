import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PlanCompleteModal from "./PlanCompleteModal";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session } from "../../types/session";

vi.mock("../../lib/tauri-commands", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  setSessionMode: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/error-handler", () => ({ handleError: vi.fn() }));
vi.mock("../../stores/toastStore", () => ({ showToast: vi.fn() }));
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  Description: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <p className={className}>{children}</p>
  ),
}));

describe("PlanCompleteModal", () => {
  // Capture the real store actions on first access so tests that replace
  // them with mocks don't leak into later tests.
  const realSetShowPlanCompleteModal = useUiStore.getState().setShowPlanCompleteModal;
  const realSetRightTab = useUiStore.getState().setRightTab;

  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      showPlanCompleteModal: false,
      planCompleteSessionId: null,
      planCompleteFilePath: null,
      planCompleteContent: null,
      pendingPlanSessionId: null,
      setShowPlanCompleteModal: realSetShowPlanCompleteModal,
      setRightTab: realSetRightTab,
    });
    useSessionStore.setState({
      sessionBusy: new Map(),
      sessions: new Map(),
    });
  });

  it("returns null when not shown or no session ID", () => {
    const { container } = render(<PlanCompleteModal />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the modal when shown with session ID", () => {
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
    });
    render(<PlanCompleteModal />);
    expect(screen.getByText("Plan Complete")).toBeInTheDocument();
    expect(screen.getByText("Claude has finished planning. Ready to implement?")).toBeInTheDocument();
  });

  it("shows Implement Now and Later buttons", () => {
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
    });
    render(<PlanCompleteModal />);
    expect(screen.getByText("Implement Now")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();
  });

  it("has an auto-accept checkbox", () => {
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
    });
    render(<PlanCompleteModal />);
    expect(screen.getByText("Enable Auto-Accept")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
  });

  it("closes modal when Later button is clicked", () => {
    const setShowModal = vi.fn();
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
      setShowPlanCompleteModal: setShowModal,
    });
    render(<PlanCompleteModal />);
    fireEvent.click(screen.getByText("Later"));
    expect(setShowModal).toHaveBeenCalledWith(false);
  });

  it("shows plan file info when planCompleteFilePath is set", () => {
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
      planCompleteFilePath: "/Users/hr/.claude/plans/jazzy-prancing-wilkes.md",
    });
    render(<PlanCompleteModal />);
    expect(screen.getByText("Plan file")).toBeInTheDocument();
    expect(screen.getByText("jazzy-prancing-wilkes.md")).toBeInTheDocument();
    expect(screen.getByText("Reveal in File Viewer →")).toBeInTheDocument();
  });

  it("reveals plan file in File Viewer when plan file card is clicked", async () => {
    const setShowModal = vi.fn();
    const setRightTab = vi.fn();
    const setActiveFile = vi.fn();
    const { useFileViewerStore } = await import("../../stores/fileViewerStore");
    useFileViewerStore.setState({ setActiveFile });
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
      planCompleteFilePath: "/Users/hr/.claude/plans/jazzy-prancing-wilkes.md",
      setShowPlanCompleteModal: setShowModal,
      setRightTab,
    });
    const session: Session = {
      id: "s1",
      name: "s1",
      project_path: "/Users/hr/project",
      status: "connected",
      created_at: new Date().toISOString(),
      model: null,
      icon_index: 0,
    };
    useSessionStore.setState({ sessions: new Map([["s1", session]]) });
    render(<PlanCompleteModal />);
    fireEvent.click(screen.getByText("jazzy-prancing-wilkes.md"));
    expect(setActiveFile).toHaveBeenCalledWith(
      "s1",
      "/Users/hr/.claude/plans/jazzy-prancing-wilkes.md",
    );
    expect(setRightTab).toHaveBeenCalledWith("files");
    expect(setShowModal).toHaveBeenCalledWith(false);
  });

  it("does not show plan file info when planCompleteFilePath is null", () => {
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
      planCompleteFilePath: null,
    });
    render(<PlanCompleteModal />);
    expect(screen.queryByText("Plan file")).not.toBeInTheDocument();
  });

  it("Later preserves pending plan state so the banner can reopen the modal", () => {
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
      planCompleteFilePath: "/plans/p.md",
      planCompleteContent: "## body",
      pendingPlanSessionId: "s1",
    });
    render(<PlanCompleteModal />);
    fireEvent.click(screen.getByText("Later"));

    const s = useUiStore.getState();
    expect(s.showPlanCompleteModal).toBe(false);
    // Pending state must survive so the InputArea banner shows.
    expect(s.planCompleteSessionId).toBe("s1");
    expect(s.planCompleteFilePath).toBe("/plans/p.md");
    expect(s.planCompleteContent).toBe("## body");
    expect(s.pendingPlanSessionId).toBe("s1");
  });

  it("Reveal in File Viewer preserves pending plan state", async () => {
    const setActiveFile = vi.fn();
    const { useFileViewerStore } = await import("../../stores/fileViewerStore");
    useFileViewerStore.setState({ setActiveFile });
    useUiStore.setState({
      showPlanCompleteModal: true,
      planCompleteSessionId: "s1",
      planCompleteFilePath: "/plans/p.md",
      planCompleteContent: "## body",
      pendingPlanSessionId: "s1",
    });
    const session: Session = {
      id: "s1",
      name: "s1",
      project_path: "/proj",
      status: "connected",
      created_at: new Date().toISOString(),
      model: null,
      icon_index: 0,
    };
    useSessionStore.setState({ sessions: new Map([["s1", session]]) });
    render(<PlanCompleteModal />);

    fireEvent.click(screen.getByText("p.md"));

    const s = useUiStore.getState();
    expect(s.showPlanCompleteModal).toBe(false);
    // Pending state must survive the reveal-in-viewer dismissal.
    expect(s.pendingPlanSessionId).toBe("s1");
    expect(s.planCompleteSessionId).toBe("s1");
    expect(s.planCompleteFilePath).toBe("/plans/p.md");
    expect(s.planCompleteContent).toBe("## body");
  });
});
