import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SelfDriveStatus from "./SelfDriveStatus";
import { useSelfDriveStore } from "../../stores/selfDriveStore";

// Mock RunLogViewer
vi.mock("./RunLogViewer", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="run-log-viewer">
      <button onClick={onClose}>close-log</button>
    </div>
  ),
}));

describe("SelfDriveStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSelfDriveStore.setState({
      status: "idle",
      currentPhase: null,
      currentSessionIndex: null,
      fixAttempt: 0,
      maxFixAttempts: 3,
      pauseReason: null,
      sessionStartedAt: null,
      runLog: [],
      startedAt: null,
    });
  });

  it("renders nothing when status is idle", () => {
    const { container } = render(<SelfDriveStatus />);
    expect(container.firstChild).toBeNull();
  });

  it("shows phase label when running", () => {
    useSelfDriveStore.setState({
      status: "running",
      currentPhase: "building",
      currentSessionIndex: 1,
      sessionStartedAt: Date.now(),
    });

    render(<SelfDriveStatus />);
    expect(screen.getByText(/Building/)).toBeInTheDocument();
    expect(screen.getByText(/Session 1/)).toBeInTheDocument();
  });

  it("shows elapsed time when running and elapsed > 0", () => {
    vi.useFakeTimers();
    const startedAt = Date.now() - 65_000; // 1 min 5 sec ago

    useSelfDriveStore.setState({
      status: "running",
      currentPhase: "building",
      currentSessionIndex: 1,
      sessionStartedAt: startedAt,
    });

    render(<SelfDriveStatus />);

    // Advance timer so the interval fires
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/1:0[0-9]/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows Pause button when running", () => {
    const mockPause = vi.fn();
    useSelfDriveStore.setState({
      status: "running",
      currentPhase: "verifying",
      currentSessionIndex: 2,
      sessionStartedAt: Date.now(),
      pause: mockPause,
    });

    render(<SelfDriveStatus />);
    const pauseBtn = screen.getByText("Pause");
    expect(pauseBtn).toBeInTheDocument();

    fireEvent.click(pauseBtn);
    expect(mockPause).toHaveBeenCalledTimes(1);
  });

  it("shows Stop button when paused", () => {
    const mockStop = vi.fn();
    useSelfDriveStore.setState({
      status: "paused",
      pauseReason: "Build failed after 3 attempts",
      stop: mockStop,
      resume: vi.fn(),
    });

    render(<SelfDriveStatus />);
    const stopBtn = screen.getByText("Stop");
    expect(stopBtn).toBeInTheDocument();

    fireEvent.click(stopBtn);
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("shows pause reason when paused", () => {
    useSelfDriveStore.setState({
      status: "paused",
      pauseReason: "Typecheck failed repeatedly",
      stop: vi.fn(),
      resume: vi.fn(),
    });

    render(<SelfDriveStatus />);
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    expect(screen.getByText("Typecheck failed repeatedly")).toBeInTheDocument();
  });

  it("shows completed state with Log button", () => {
    useSelfDriveStore.setState({
      status: "completed",
    });

    render(<SelfDriveStatus />);
    expect(screen.getByText("Self-Drive Complete")).toBeInTheDocument();
    expect(screen.getByText("Log")).toBeInTheDocument();
  });

  it("shows prompt preview when running and runLog has prompt", () => {
    useSelfDriveStore.setState({
      status: "running",
      currentPhase: "building",
      currentSessionIndex: 1,
      sessionStartedAt: Date.now(),
      runLog: [
        {
          timestamp: Date.now(),
          sessionIndex: 1,
          phase: "building",
          event: "building",
          summary: "Starting session 1",
          prompt: "Build the database schema and API endpoints for user management",
        },
      ],
    });

    render(<SelfDriveStatus />);
    expect(screen.getByText(/Build the database schema/)).toBeInTheDocument();
  });

  it("does not show prompt preview when runLog has no prompts", () => {
    useSelfDriveStore.setState({
      status: "running",
      currentPhase: "evaluating",
      currentSessionIndex: 1,
      sessionStartedAt: Date.now(),
      runLog: [
        {
          timestamp: Date.now(),
          sessionIndex: 1,
          phase: "evaluating",
          event: "evaluating",
          summary: "AI orchestrator evaluating...",
        },
      ],
    });

    render(<SelfDriveStatus />);
    // Should show the phase label but no prompt preview
    expect(screen.getByText(/AI deciding/)).toBeInTheDocument();
    // No prompt text should appear
    const container = screen.getByText(/AI deciding/).closest("div.mx-1");
    const allText = container?.textContent ?? "";
    expect(allText).not.toContain("Build ");
  });

  it("shows fix attempt indicator when fixAttempt > 0", () => {
    useSelfDriveStore.setState({
      status: "running",
      currentPhase: "fixing",
      currentSessionIndex: 1,
      sessionStartedAt: Date.now(),
      fixAttempt: 2,
      maxFixAttempts: 3,
    });

    render(<SelfDriveStatus />);
    expect(screen.getByText("Fix attempt 2/3")).toBeInTheDocument();
  });
});
