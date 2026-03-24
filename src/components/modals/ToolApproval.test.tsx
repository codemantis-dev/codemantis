import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
