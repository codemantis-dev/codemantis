import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PlanCompleteModal from "./PlanCompleteModal";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";

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
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      showPlanCompleteModal: false,
      planCompleteSessionId: null,
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
});
