import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RunLogViewer from "./RunLogViewer";
import { useSelfDriveStore } from "../../stores/selfDriveStore";
import type { RunLogEntry } from "../../types/implementation-guide";

function makeLogEntry(overrides?: Partial<RunLogEntry>): RunLogEntry {
  return {
    timestamp: 1700000000000,
    sessionIndex: 1,
    phase: "building",
    event: "session_building",
    summary: "Sending build prompt to Claude Code",
    ...overrides,
  };
}

describe("RunLogViewer", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSelfDriveStore.setState({
      runLog: [],
      startedAt: null,
      status: "running",
    });
  });

  it("renders run log entries", () => {
    useSelfDriveStore.setState({
      runLog: [
        makeLogEntry({ summary: "Starting session 1" }),
        makeLogEntry({ phase: "verifying", summary: "Verifying implementation" }),
      ],
      startedAt: Date.now() - 60000,
    });

    render(<RunLogViewer onClose={onClose} />);
    expect(screen.getByText("Starting session 1")).toBeInTheDocument();
    expect(screen.getByText("Verifying implementation")).toBeInTheDocument();
  });

  it("shows timestamp for each entry", () => {
    // Use a known timestamp: 1700000000000 = Nov 14, 2023
    const ts = new Date(2026, 0, 15, 10, 30, 45).getTime();
    useSelfDriveStore.setState({
      runLog: [makeLogEntry({ timestamp: ts, summary: "Build started" })],
      startedAt: ts - 5000,
    });

    render(<RunLogViewer onClose={onClose} />);
    expect(screen.getByText("10:30:45")).toBeInTheDocument();
  });

  it("shows decision details via summary text", () => {
    useSelfDriveStore.setState({
      runLog: [
        makeLogEntry({
          phase: "decision",
          summary: "AI decided to advance — all checks passed",
          decision: {
            action: "advance",
            summary: "All checks passed",
            confidence: "high",
          },
        }),
      ],
      startedAt: Date.now() - 10000,
    });

    render(<RunLogViewer onClose={onClose} />);
    expect(screen.getByText("AI decided to advance — all checks passed")).toBeInTheDocument();
  });

  it("close button calls onClose", () => {
    useSelfDriveStore.setState({
      runLog: [makeLogEntry({ summary: "Test entry" })],
      startedAt: Date.now() - 5000,
    });

    render(<RunLogViewer onClose={onClose} />);
    // The header now has both a Copy button and the X close button; pick
    // the close one by its title.
    const closeBtn = screen.getByTitle("Close");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows 'No log entries yet' when runLog is empty", () => {
    render(<RunLogViewer onClose={onClose} />);
    expect(screen.getByText("No log entries yet")).toBeInTheDocument();
  });

  it("shows Prompt button when log entry has a prompt", () => {
    useSelfDriveStore.setState({
      runLog: [
        makeLogEntry({ summary: "Building session 1", prompt: "Build the foundation..." }),
      ],
      startedAt: Date.now() - 5000,
    });

    render(<RunLogViewer onClose={onClose} />);
    expect(screen.getByText("Prompt")).toBeInTheDocument();
  });

  it("does not show Prompt button when log entry has no prompt", () => {
    useSelfDriveStore.setState({
      runLog: [
        makeLogEntry({ summary: "AI decided something" }),
      ],
      startedAt: Date.now() - 5000,
    });

    render(<RunLogViewer onClose={onClose} />);
    expect(screen.queryByText("Prompt")).toBeNull();
  });

  it("clicking Prompt button expands to show prompt text", () => {
    useSelfDriveStore.setState({
      runLog: [
        makeLogEntry({ summary: "Fix session", prompt: "Fix these TypeScript errors in src/main.ts" }),
      ],
      startedAt: Date.now() - 5000,
    });

    render(<RunLogViewer onClose={onClose} />);

    // Prompt text should not be visible initially
    expect(screen.queryByText("Fix these TypeScript errors in src/main.ts")).toBeNull();

    // Click the Prompt button
    fireEvent.click(screen.getByText("Prompt"));

    // Now prompt text should be visible
    expect(screen.getByText("Fix these TypeScript errors in src/main.ts")).toBeInTheDocument();
  });

  it("Copy button flattens the log to plain text", () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const ts = new Date(2026, 0, 15, 10, 30, 45).getTime();
    useSelfDriveStore.setState({
      runLog: [
        makeLogEntry({ timestamp: ts, summary: "line one" }),
        makeLogEntry({ timestamp: ts + 1000, summary: "line two", prompt: "PROMPT-BODY" }),
      ],
      startedAt: ts,
    });
    render(<RunLogViewer onClose={onClose} />);

    const copyBtn = screen.getByTitle("Copy full log");
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(copied).toContain("line one");
    expect(copied).toContain("line two");
    // The expanded prompt body is indented beneath the summary line.
    expect(copied).toContain("    PROMPT-BODY");
  });

  it("Copy button is absent when the log is empty", () => {
    render(<RunLogViewer onClose={onClose} />);
    expect(screen.queryByTitle("Copy full log")).toBeNull();
  });

  it("shows summary footer with session and fix counts", () => {
    useSelfDriveStore.setState({
      runLog: [
        makeLogEntry({ sessionIndex: 1, phase: "building", summary: "Building" }),
        makeLogEntry({ sessionIndex: 1, phase: "fixing", summary: "Fixing" }),
        makeLogEntry({ sessionIndex: 2, phase: "building", summary: "Building session 2" }),
      ],
      startedAt: Date.now() - 120000,
    });

    render(<RunLogViewer onClose={onClose} />);
    expect(screen.getByText("Sessions: 2")).toBeInTheDocument();
    expect(screen.getByText("Fixes: 1")).toBeInTheDocument();
  });
});
