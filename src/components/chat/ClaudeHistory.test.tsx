import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import ClaudeHistory from "./ClaudeHistory";
import type { SessionHistoryEntry } from "../../types/session";

const mockListSessionHistory = vi.fn();
const mockResumeFromHistory = vi.fn();

vi.mock("../../lib/tauri-commands", () => ({
  listSessionHistory: (...args: unknown[]) => mockListSessionHistory(...args),
}));

vi.mock("../../hooks/useClaudeSession", () => ({
  useClaudeSession: () => ({
    resumeFromHistory: mockResumeFromHistory,
  }),
}));

vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

function makeHistoryEntry(overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    session_id: "s1",
    name: "Test Session",
    model: "claude-sonnet-4-6",
    closed_at: new Date().toISOString(),
    cli_session_id: "cli-123",
    icon_index: 0,
    recent_headlines: ["Did something", "Did another thing"],
    ...overrides,
  };
}

describe("ClaudeHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ activeProjectPath: "/test/project" });
    mockListSessionHistory.mockResolvedValue([]);
  });

  it("shows 'No project selected' when no active project path", () => {
    useSessionStore.setState({ activeProjectPath: null });
    render(<ClaudeHistory />);
    expect(screen.getByText("No project selected")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    mockListSessionHistory.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ClaudeHistory />);
    expect(screen.getByText("Loading session history...")).toBeInTheDocument();
  });

  it("shows empty state when no sessions exist", async () => {
    mockListSessionHistory.mockResolvedValue([]);
    render(<ClaudeHistory />);
    await waitFor(() => {
      expect(screen.getByText("No closed sessions for this project")).toBeInTheDocument();
    });
  });

  it("renders history entries after loading", async () => {
    const entries = [
      makeHistoryEntry({ cli_session_id: "cli-1", name: "Session One" }),
      makeHistoryEntry({ cli_session_id: "cli-2", name: "Session Two" }),
    ];
    mockListSessionHistory.mockResolvedValue(entries);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Session One")).toBeInTheDocument();
      expect(screen.getByText("Session Two")).toBeInTheDocument();
    });
  });

  it("shows entry count badge", async () => {
    mockListSessionHistory.mockResolvedValue([
      makeHistoryEntry({ cli_session_id: "cli-1" }),
      makeHistoryEntry({ cli_session_id: "cli-2" }),
    ]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  it("calls resumeFromHistory when Resume button is clicked", async () => {
    const entry = makeHistoryEntry({ cli_session_id: "cli-1", name: "My Session" });
    mockListSessionHistory.mockResolvedValue([entry]);
    mockResumeFromHistory.mockResolvedValue(undefined);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("My Session")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Resume"));

    await waitFor(() => {
      expect(mockResumeFromHistory).toHaveBeenCalledWith(
        "/test/project",
        "cli-1",
        "My Session",
      );
    });
  });

  it("shows model label for entries with model", async () => {
    const entry = makeHistoryEntry({ model: "claude-sonnet-4-6" });
    mockListSessionHistory.mockResolvedValue([entry]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Sonnet")).toBeInTheDocument();
    });
  });

  it("shows recent headlines as bullet list", async () => {
    const entry = makeHistoryEntry({
      recent_headlines: ["Fixed a bug", "Added tests"],
    });
    mockListSessionHistory.mockResolvedValue([entry]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Fixed a bug")).toBeInTheDocument();
      expect(screen.getByText("Added tests")).toBeInTheDocument();
    });
  });
});
