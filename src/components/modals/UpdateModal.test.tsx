import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UpdateModal from "./UpdateModal";
import { useUiStore } from "../../stores/uiStore";

// Mock Radix Dialog
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
}));

// Mock update checker
vi.mock("../../lib/update-checker", () => ({
  getPendingUpdate: vi.fn().mockReturnValue(null),
}));

// Mock relaunch
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

describe("UpdateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      showUpdateModal: false,
      updateVersion: null,
      updateNotes: null,
    });
  });

  it("does not render when showUpdateModal is false", () => {
    const { container } = render(<UpdateModal />);
    expect(container.querySelector("[data-testid='dialog-root']")).toBeNull();
  });

  it("renders when showUpdateModal is true", () => {
    useUiStore.setState({
      showUpdateModal: true,
      updateVersion: "1.5.0",
      updateNotes: null,
    });

    render(<UpdateModal />);
    expect(screen.getByText("Update available")).toBeInTheDocument();
  });

  it("displays version info", () => {
    useUiStore.setState({
      showUpdateModal: true,
      updateVersion: "2.0.0",
      updateNotes: "Bug fixes and improvements",
    });

    render(<UpdateModal />);
    expect(screen.getByText("CodeMantis v2.0.0")).toBeInTheDocument();
    expect(screen.getByText("Bug fixes and improvements")).toBeInTheDocument();
  });

  it("has an Update & Restart button", () => {
    useUiStore.setState({
      showUpdateModal: true,
      updateVersion: "1.5.0",
      updateNotes: null,
    });

    render(<UpdateModal />);
    expect(screen.getByText("Update & Restart")).toBeInTheDocument();
  });

  it("close button calls closeUpdateModal", () => {
    useUiStore.setState({
      showUpdateModal: true,
      updateVersion: "1.5.0",
      updateNotes: null,
    });

    render(<UpdateModal />);
    fireEvent.click(screen.getByText("Later"));
    // After clicking Later, showUpdateModal should be set to false
    expect(useUiStore.getState().showUpdateModal).toBe(false);
  });
});
