import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import ClaudeHistory from "./ClaudeHistory";
import type { SessionHistoryEntry } from "../../types/session";

const mockListSessionHistory = vi.fn();
const mockResumeFromHistory = vi.fn();
const mockSearchSessionMessages = vi.fn();

vi.mock("../../lib/tauri-commands", () => ({
  listSessionHistory: (...args: unknown[]) => mockListSessionHistory(...args),
  searchSessionMessages: (...args: unknown[]) => mockSearchSessionMessages(...args),
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
    project_path: "/tmp/test-project",
    model: "claude-sonnet-4-6",
    closed_at: new Date().toISOString(),
    cli_session_id: "cli-123",
    icon_index: 0,
    recent_headlines: ["Did something", "Did another thing"],
    has_stored_messages: false,
    ...overrides,
  };
}

describe("ClaudeHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ activeProjectPath: "/test/project" });
    useUiStore.setState({ showClaudeHistory: true });
    mockListSessionHistory.mockResolvedValue([]);
    mockSearchSessionMessages.mockResolvedValue([]);
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
        "s1",
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

  it("closes history view when Back button is clicked", async () => {
    mockListSessionHistory.mockResolvedValue([]);
    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByTitle("Back to Project")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Back to Project"));
    expect(useUiStore.getState().showClaudeHistory).toBe(false);
  });

  // ── "Saved" badge ──

  it("shows 'Saved' badge for entries with stored messages", async () => {
    const entry = makeHistoryEntry({
      has_stored_messages: true,
      cli_session_id: "cli-saved",
    });
    mockListSessionHistory.mockResolvedValue([entry]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("does not show 'Saved' badge when has_stored_messages is false", async () => {
    const entry = makeHistoryEntry({
      has_stored_messages: false,
      cli_session_id: "cli-nosave",
    });
    mockListSessionHistory.mockResolvedValue([entry]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  // ── Search bar ──

  it("shows search bar when entries exist", async () => {
    mockListSessionHistory.mockResolvedValue([
      makeHistoryEntry({ cli_session_id: "cli-1" }),
    ]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search session conversations...")).toBeInTheDocument();
    });
  });

  it("does not show search bar when no entries", async () => {
    mockListSessionHistory.mockResolvedValue([]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("No closed sessions for this project")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText("Search session conversations...")).not.toBeInTheDocument();
  });

  it("triggers search when typing in search bar", async () => {
    const entries = [
      makeHistoryEntry({ cli_session_id: "cli-1", session_id: "s1", name: "Auth Session" }),
      makeHistoryEntry({ cli_session_id: "cli-2", session_id: "s2", name: "UI Session" }),
    ];
    mockListSessionHistory.mockResolvedValue(entries);
    mockSearchSessionMessages.mockResolvedValue([
      { sessionId: "s1", sessionName: "Auth Session", messageId: "m1", role: "user", contentSnippet: "fix auth", timestamp: "2026-01-01T00:00:00Z" },
    ]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Auth Session")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search session conversations...");
    fireEvent.change(searchInput, { target: { value: "auth" } });

    // After debounce, search should be called
    await waitFor(() => {
      expect(mockSearchSessionMessages).toHaveBeenCalledWith("/test/project", "auth");
    });
  });

  it("filters session list to only matching sessions when searching", async () => {
    const entries = [
      makeHistoryEntry({ cli_session_id: "cli-1", session_id: "s1", name: "Auth Session" }),
      makeHistoryEntry({ cli_session_id: "cli-2", session_id: "s2", name: "UI Session" }),
    ];
    mockListSessionHistory.mockResolvedValue(entries);
    mockSearchSessionMessages.mockResolvedValue([
      { sessionId: "s1", sessionName: "Auth Session", messageId: "m1", role: "user", contentSnippet: "fix auth bug", timestamp: "2026-01-01T00:00:00Z" },
    ]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Auth Session")).toBeInTheDocument();
      expect(screen.getByText("UI Session")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search session conversations...");
    fireEvent.change(searchInput, { target: { value: "auth" } });

    await waitFor(() => {
      expect(screen.getByText("Auth Session")).toBeInTheDocument();
      expect(screen.queryByText("UI Session")).not.toBeInTheDocument();
    });
  });

  it("shows 'No sessions match' when search finds nothing", async () => {
    const entries = [
      makeHistoryEntry({ cli_session_id: "cli-1", session_id: "s1" }),
    ];
    mockListSessionHistory.mockResolvedValue(entries);
    mockSearchSessionMessages.mockResolvedValue([]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search session conversations...");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    await waitFor(() => {
      expect(screen.getByText("No sessions match your search")).toBeInTheDocument();
    });
  });

  it("shows clear search button and clears on click", async () => {
    const entries = [
      makeHistoryEntry({ cli_session_id: "cli-1", session_id: "s1" }),
    ];
    mockListSessionHistory.mockResolvedValue(entries);
    mockSearchSessionMessages.mockResolvedValue([]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search session conversations...");
    fireEvent.change(searchInput, { target: { value: "something" } });

    await waitFor(() => {
      expect(screen.getByTitle("Clear search")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Clear search"));

    // After clearing, all entries should be visible again
    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });
    expect((screen.getByPlaceholderText("Search session conversations...") as HTMLInputElement).value).toBe("");
  });

  it("shows 'Clear search' link in empty search results", async () => {
    const entries = [
      makeHistoryEntry({ cli_session_id: "cli-1", session_id: "s1" }),
    ];
    mockListSessionHistory.mockResolvedValue(entries);
    mockSearchSessionMessages.mockResolvedValue([]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search session conversations...");
    fireEvent.change(searchInput, { target: { value: "nothing" } });

    await waitFor(() => {
      expect(screen.getByText("No sessions match your search")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Clear search"));

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });
  });

  it("shows search snippets under matching sessions", async () => {
    const entries = [
      makeHistoryEntry({ cli_session_id: "cli-1", session_id: "s1", name: "Debug Session" }),
    ];
    mockListSessionHistory.mockResolvedValue(entries);
    mockSearchSessionMessages.mockResolvedValue([
      { sessionId: "s1", sessionName: "Debug Session", messageId: "m1", role: "user", contentSnippet: "fix the login bug", timestamp: "2026-01-01T00:00:00Z" },
      { sessionId: "s1", sessionName: "Debug Session", messageId: "m2", role: "assistant", contentSnippet: "I found the issue in auth.ts", timestamp: "2026-01-01T00:01:00Z" },
    ]);

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Debug Session")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search session conversations...");
    fireEvent.change(searchInput, { target: { value: "login" } });

    await waitFor(() => {
      expect(screen.getByText("fix the login bug")).toBeInTheDocument();
      expect(screen.getByText("I found the issue in auth.ts")).toBeInTheDocument();
    });
  });

  it("shows info toast when resuming session without stored messages", async () => {
    const { showToast } = await import("../../stores/toastStore");
    const entry = makeHistoryEntry({ has_stored_messages: false });
    mockListSessionHistory.mockResolvedValue([entry]);
    mockResumeFromHistory.mockResolvedValue("new-session-id");

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Resume"));

    await waitFor(() => {
      expect(mockResumeFromHistory).toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        "Previous messages were not saved for this session",
        "info"
      );
    });
  });

  it("does NOT show info toast when resuming session with stored messages", async () => {
    const { showToast } = await import("../../stores/toastStore");
    const entry = makeHistoryEntry({ has_stored_messages: true });
    mockListSessionHistory.mockResolvedValue([entry]);
    mockResumeFromHistory.mockResolvedValue("new-session-id");

    render(<ClaudeHistory />);

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Resume"));

    await waitFor(() => {
      expect(mockResumeFromHistory).toHaveBeenCalled();
    });

    // showToast should NOT have been called with the info message
    expect(showToast).not.toHaveBeenCalledWith(
      "Previous messages were not saved for this session",
      "info"
    );
  });
});
