import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmCloseModal from "./ConfirmCloseModal";
import type { PendingClose } from "./ConfirmCloseModal";

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

describe("ConfirmCloseModal", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when pendingClose is null", () => {
    const { container } = render(
      <ConfirmCloseModal pendingClose={null} onConfirm={onConfirm} onCancel={onCancel} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows session close title for session type", () => {
    const pending: PendingClose = {
      type: "session",
      id: "s1",
      name: "My Session",
      sessionCount: 1,
    };
    render(<ConfirmCloseModal pendingClose={pending} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('Close session "My Session"?')).toBeInTheDocument();
    expect(screen.getByText("The Claude CLI process will be stopped.")).toBeInTheDocument();
  });

  it("shows project close title with session count for project type", () => {
    const pending: PendingClose = {
      type: "project",
      id: "p1",
      name: "My Project",
      sessionCount: 3,
    };
    render(<ConfirmCloseModal pendingClose={pending} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('Close project "My Project"?')).toBeInTheDocument();
    expect(screen.getByText("All 3 sessions and their CLI processes will be stopped.")).toBeInTheDocument();
  });

  it("calls onConfirm when Close button is clicked", () => {
    const pending: PendingClose = {
      type: "session",
      id: "s1",
      name: "Test",
      sessionCount: 1,
    };
    render(<ConfirmCloseModal pendingClose={pending} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Close"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const pending: PendingClose = {
      type: "session",
      id: "s1",
      name: "Test",
      sessionCount: 1,
    };
    render(<ConfirmCloseModal pendingClose={pending} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm on Enter key and onCancel on Escape key", () => {
    const pending: PendingClose = {
      type: "session",
      id: "s1",
      name: "Test",
      sessionCount: 1,
    };
    render(<ConfirmCloseModal pendingClose={pending} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
