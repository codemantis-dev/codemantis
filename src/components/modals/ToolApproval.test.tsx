import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ToolApproval from "./ToolApproval";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";

vi.mock("../../lib/tauri-commands", () => ({
  resolveToolApproval: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/error-handler", () => ({ handleError: vi.fn() }));
vi.mock("../shared/ToolBadge", () => ({
  default: ({ toolName }: { toolName: string }) => <span data-testid="tool-badge">{toolName}</span>,
}));
// Radix Dialog mock: forwards onKeyDown / onEscapeKeyDown / onOpenAutoFocus so
// keyboard-guard tests below can exercise the real handler logic without
// pulling in Radix's portal + focus-trap machinery.
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({
    children,
    onKeyDown,
    onEscapeKeyDown,
    onOpenAutoFocus,
  }: {
    children: React.ReactNode;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    onEscapeKeyDown?: (e: { preventDefault: () => void }) => void;
    onOpenAutoFocus?: (e: { defaultPrevented: boolean; preventDefault: () => void }) => void;
  }) => {
    const refCb = (el: HTMLDivElement | null) => {
      if (el && onOpenAutoFocus) {
        const ev = {
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
        };
        onOpenAutoFocus(ev);
        (el as HTMLDivElement & { __autoFocusPrevented?: boolean }).__autoFocusPrevented =
          ev.defaultPrevented;
      }
    };
    return (
      <div
        ref={refCb}
        data-testid="dialog-content"
        onKeyDown={(e) => {
          if (e.key === "Escape" && onEscapeKeyDown) {
            onEscapeKeyDown({ preventDefault: () => e.preventDefault() });
          }
          if (onKeyDown) onKeyDown(e);
        }}
      >
        {children}
      </div>
    );
  },
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  Description: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <p className={className}>{children}</p>
  ),
}));

describe("ToolApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActivityStore.setState({
      approvalQueue: [],
      currentApprovalIndex: 0,
      approvalSeenIds: new Set(),
    });
    useUiStore.setState({
      showApprovalModal: false,
    });
    useSessionStore.setState({
      sessions: new Map(),
    });
  });

  it("returns null when there is no current approval", () => {
    const { container } = render(<ToolApproval />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the approval modal with tool name", () => {
    useActivityStore.setState({
      approvalQueue: [{
        requestId: "r1",
        toolUseId: "tu1",
        toolName: "Write",
        toolInput: { path: "/test.txt", content: "hello" },
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      }],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    expect(screen.getByText("Approve Tool?")).toBeInTheDocument();
    // Tool name appears in badge + span + "always allow" text, so use getAllByText
    const writeElements = screen.getAllByText("Write");
    expect(writeElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Approve and Deny buttons", () => {
    useActivityStore.setState({
      approvalQueue: [{
        requestId: "r1",
        toolUseId: "tu1",
        toolName: "Bash",
        toolInput: { command: "ls" },
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      }],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Deny")).toBeInTheDocument();
  });

  it("displays tool input as JSON", () => {
    useActivityStore.setState({
      approvalQueue: [{
        requestId: "r1",
        toolUseId: "tu1",
        toolName: "Bash",
        toolInput: { command: "npm install" },
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      }],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    expect(screen.getByText(/npm install/)).toBeInTheDocument();
  });

  it("shows 'Approve all' button when queue has multiple items", () => {
    useActivityStore.setState({
      approvalQueue: [
        {
          requestId: "r1", toolUseId: "tu1", toolName: "Write",
          toolInput: {}, sessionId: "s1", timestamp: new Date().toISOString(),
        },
        {
          requestId: "r2", toolUseId: "tu2", toolName: "Bash",
          toolInput: {}, sessionId: "s1", timestamp: new Date().toISOString(),
        },
      ],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    expect(screen.getByText("Approve all (2)")).toBeInTheDocument();
  });

  it("does not approve from a stray window keydown (no global listener)", async () => {
    const { resolveToolApproval } = await import("../../lib/tauri-commands");
    useActivityStore.setState({
      approvalQueue: [{
        requestId: "r1", toolUseId: "tu1", toolName: "Bash",
        toolInput: { command: "rm -rf /" }, sessionId: "s1",
        timestamp: new Date().toISOString(),
      }],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(resolveToolApproval).not.toHaveBeenCalled();
  });

  it("ignores Enter on the dialog inside the settling window", async () => {
    const { resolveToolApproval } = await import("../../lib/tauri-commands");
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    useActivityStore.setState({
      approvalQueue: [{
        requestId: "r1", toolUseId: "tu1", toolName: "Bash",
        toolInput: {}, sessionId: "s1", timestamp: new Date().toISOString(),
      }],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    nowSpy.mockReturnValue(100); // 100 ms after open — still settling
    fireEvent.keyDown(screen.getByTestId("dialog-content"), { key: "Enter" });
    expect(resolveToolApproval).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("approves on Enter on the dialog after settling", async () => {
    const { resolveToolApproval } = await import("../../lib/tauri-commands");
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    useActivityStore.setState({
      approvalQueue: [{
        requestId: "r1", toolUseId: "tu1", toolName: "Bash",
        toolInput: {}, sessionId: "s1", timestamp: new Date().toISOString(),
      }],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    nowSpy.mockReturnValue(500); // > 400 ms — past settling
    fireEvent.keyDown(screen.getByTestId("dialog-content"), { key: "Enter" });
    expect(resolveToolApproval).toHaveBeenCalledWith("r1", true, undefined);
    nowSpy.mockRestore();
  });

  it("ignores Escape on the dialog inside the settling window", async () => {
    const { resolveToolApproval } = await import("../../lib/tauri-commands");
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    useActivityStore.setState({
      approvalQueue: [{
        requestId: "r1", toolUseId: "tu1", toolName: "Bash",
        toolInput: {}, sessionId: "s1", timestamp: new Date().toISOString(),
      }],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    nowSpy.mockReturnValue(100);
    fireEvent.keyDown(screen.getByTestId("dialog-content"), { key: "Escape" });
    expect(resolveToolApproval).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("prevents Radix auto-focus so a stray Enter cannot fire a button", () => {
    useActivityStore.setState({
      approvalQueue: [{
        requestId: "r1", toolUseId: "tu1", toolName: "Write",
        toolInput: {}, sessionId: "s1", timestamp: new Date().toISOString(),
      }],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    const content = screen.getByTestId("dialog-content") as HTMLElement & {
      __autoFocusPrevented?: boolean;
    };
    expect(content.__autoFocusPrevented).toBe(true);
  });

  it("shows navigation arrows for multi-item queue", () => {
    useActivityStore.setState({
      approvalQueue: [
        {
          requestId: "r1", toolUseId: "tu1", toolName: "Write",
          toolInput: {}, sessionId: "s1", timestamp: new Date().toISOString(),
        },
        {
          requestId: "r2", toolUseId: "tu2", toolName: "Bash",
          toolInput: {}, sessionId: "s1", timestamp: new Date().toISOString(),
        },
      ],
      currentApprovalIndex: 0,
    });
    useUiStore.setState({ showApprovalModal: true });
    render(<ToolApproval />);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous approval")).toBeInTheDocument();
    expect(screen.getByLabelText("Next approval")).toBeInTheDocument();
  });
});
