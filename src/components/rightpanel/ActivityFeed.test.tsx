import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ActivityFeed from "./ActivityFeed";
import { useActivityStore } from "../../stores/activityStore";

describe("ActivityFeed", () => {
  beforeEach(() => {
    useActivityStore.setState({
      entries: [],
      pendingApproval: null,
    });
  });

  it("shows empty state when no entries", () => {
    render(<ActivityFeed />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders activity entries with tool names", () => {
    useActivityStore.setState({
      entries: [
        {
          id: "a1",
          toolUseId: "t1",
          toolName: "Read",
          toolInput: { file_path: "src/main.rs" },
          status: "done",
          timestamp: "2026-01-01T12:00:00Z",
          messageId: "m1",
          isError: false,
          result: "186 lines",
        },
      ],
    });
    render(<ActivityFeed />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("src/main.rs")).toBeInTheDocument();
  });

  it("shows tool badge for each entry type", () => {
    useActivityStore.setState({
      entries: [
        {
          id: "a1",
          toolUseId: "t1",
          toolName: "Read",
          toolInput: {},
          status: "done",
          timestamp: "2026-01-01T12:00:00Z",
          messageId: "m1",
          isError: false,
        },
        {
          id: "a2",
          toolUseId: "t2",
          toolName: "Write",
          toolInput: { file_path: "new.ts" },
          status: "done",
          timestamp: "2026-01-01T12:00:01Z",
          messageId: "m1",
          isError: false,
        },
        {
          id: "a3",
          toolUseId: "t3",
          toolName: "Edit",
          toolInput: { file_path: "old.ts" },
          status: "done",
          timestamp: "2026-01-01T12:00:02Z",
          messageId: "m1",
          isError: false,
        },
        {
          id: "a4",
          toolUseId: "t4",
          toolName: "Bash",
          toolInput: { command: "npm test" },
          status: "running",
          timestamp: "2026-01-01T12:00:03Z",
          messageId: "m1",
          isError: false,
        },
      ],
    });
    render(<ActivityFeed />);
    expect(screen.getByText("RE")).toBeInTheDocument();
    expect(screen.getByText("WR")).toBeInTheDocument();
    expect(screen.getByText("ED")).toBeInTheDocument();
    expect(screen.getByText("BA")).toBeInTheDocument();
  });

  it("shows error indicator for failed tools", () => {
    useActivityStore.setState({
      entries: [
        {
          id: "a1",
          toolUseId: "t1",
          toolName: "Bash",
          toolInput: { command: "bad-command" },
          status: "error",
          timestamp: "2026-01-01T12:00:00Z",
          messageId: "m1",
          isError: true,
          result: "command not found",
        },
      ],
    });
    render(<ActivityFeed />);
    expect(screen.getByText(/command not found/)).toBeInTheDocument();
  });

  it("shows result text for completed tools", () => {
    useActivityStore.setState({
      entries: [
        {
          id: "a1",
          toolUseId: "t1",
          toolName: "Glob",
          toolInput: { pattern: "**/*.ts" },
          status: "done",
          timestamp: "2026-01-01T12:00:00Z",
          messageId: "m1",
          isError: false,
          result: "Found 12 files",
        },
      ],
    });
    render(<ActivityFeed />);
    expect(screen.getByText("Found 12 files")).toBeInTheDocument();
  });

  it("displays tool input details", () => {
    useActivityStore.setState({
      entries: [
        {
          id: "a1",
          toolUseId: "t1",
          toolName: "Bash",
          toolInput: { command: "npm install" },
          status: "running",
          timestamp: "2026-01-01T12:00:00Z",
          messageId: "m1",
          isError: false,
        },
      ],
    });
    render(<ActivityFeed />);
    expect(screen.getByText("npm install")).toBeInTheDocument();
  });
});
