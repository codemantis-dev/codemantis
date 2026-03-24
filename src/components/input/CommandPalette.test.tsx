import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import CommandPalette from "./CommandPalette";
import type { SlashCommand } from "../../types/slash-commands";

const mockDiscoverCommands = vi.fn();

vi.mock("../../lib/tauri-commands", () => ({
  discoverCommands: (...args: unknown[]) => mockDiscoverCommands(...args),
}));

const mockCommands: SlashCommand[] = [
  {
    name: "help",
    description: "Show help",
    category: "built-in",
    source_path: null,
    argument_hint: null,
    model: null,
    user_invocable: true,
  },
  {
    name: "review",
    description: "Review code changes",
    category: "skill",
    source_path: "/path/to/skill",
    argument_hint: "<file>",
    model: null,
    user_invocable: true,
  },
  {
    name: "doctor",
    description: "Run diagnostics",
    category: "cli-only",
    source_path: null,
    argument_hint: null,
    model: null,
    user_invocable: true,
  },
];

describe("CommandPalette", () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverCommands.mockResolvedValue(mockCommands);
    useSessionStore.setState({
      activeSessionId: "s1",
      sessions: new Map([["s1", {
        id: "s1",
        name: "Test",
        project_path: "/test/project",
        status: "connected" as const,
        created_at: "2024-01-01",
        model: null,
        icon_index: 0,
      }]]),
    });
  });

  it("shows loading state initially", () => {
    mockDiscoverCommands.mockReturnValue(new Promise(() => {})); // never resolves
    render(<CommandPalette query="" onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText("Loading commands...")).toBeInTheDocument();
  });

  it("renders all commands when query is empty", async () => {
    render(<CommandPalette query="" onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("/help")).toBeInTheDocument();
      expect(screen.getByText("/review")).toBeInTheDocument();
      expect(screen.getByText("/doctor")).toBeInTheDocument();
    });
  });

  it("filters commands by query", async () => {
    render(<CommandPalette query="help" onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("/help")).toBeInTheDocument();
      expect(screen.queryByText("/review")).not.toBeInTheDocument();
    });
  });

  it("shows no match message for unknown query", async () => {
    render(<CommandPalette query="nonexistent" onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText(/No commands matching/)).toBeInTheDocument();
    });
  });

  it("calls onSelect when a command item is clicked", async () => {
    render(<CommandPalette query="" onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("/help")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("/help"));
    expect(onSelect).toHaveBeenCalledWith(mockCommands[0], "");
  });

  it("shows category badges", async () => {
    render(<CommandPalette query="" onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("Built-in")).toBeInTheDocument();
      expect(screen.getByText("Skill")).toBeInTheDocument();
      expect(screen.getByText("Opens CLI")).toBeInTheDocument();
    });
  });

  it("shows command descriptions", async () => {
    render(<CommandPalette query="" onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("Show help")).toBeInTheDocument();
      expect(screen.getByText("Review code changes")).toBeInTheDocument();
    });
  });
});
