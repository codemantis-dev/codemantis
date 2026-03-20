import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ChangelogFeed from "./ChangelogFeed";
import { useSessionStore } from "../../stores/sessionStore";
import { useChangelogStore } from "../../stores/changelogStore";
import type { ChangelogEntry } from "../../types/changelog";

vi.mock("../../lib/tauri-commands", () => ({
  deleteChangelogEntry: vi.fn().mockResolvedValue(undefined),
}));

const SESSION_ID = "s1";

function makeEntry(overrides: Partial<ChangelogEntry> & { id: string }): ChangelogEntry {
  return {
    session_id: SESSION_ID,
    timestamp: "2026-01-01T12:00:00Z",
    headline: "Added feature",
    description: "A test description",
    category: "feature",
    files_changed: ["src/app.ts"],
    turn_index: 1,
    technical_details: "",
    tools_summary: "",
    ...overrides,
  };
}

function setup(entries: ChangelogEntry[], generating = false): void {
  useSessionStore.setState({
    sessions: new Map([[SESSION_ID, { id: SESSION_ID, name: "Test", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 0 }]]),
    activeSessionId: SESSION_ID,
    activeProjectPath: "/tmp",
    sessionMessages: new Map([[SESSION_ID, []]]),
    sessionStreaming: new Map([[SESSION_ID, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
    sessionContext: new Map([[SESSION_ID, { used: 0, max: 200000 }]]),
    tabOrder: [SESSION_ID],
  });
  useChangelogStore.setState({
    sessionEntries: new Map([[SESSION_ID, entries]]),
    generating: new Map([[SESSION_ID, generating]]),
    projectEntries: new Map(),
  });
}

describe("ChangelogFeed", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionContext: new Map(),
      tabOrder: [],
    });
    useChangelogStore.setState({
      sessionEntries: new Map(),
      generating: new Map(),
      projectEntries: new Map(),
    });
  });

  it("shows empty state when no entries", () => {
    setup([]);
    render(<ChangelogFeed />);
    expect(screen.getByText("No changelog entries yet")).toBeInTheDocument();
  });

  it("renders entries with markdown in headline and description", () => {
    setup([makeEntry({ id: "e1", headline: "Support `input_sources`", description: "Added **bold** feature" })]);
    render(<ChangelogFeed />);
    // Inline code should be rendered as <code>
    expect(screen.getByText("input_sources").closest("code")).toBeTruthy();
    // Bold should be rendered as <strong>
    expect(screen.getByText("bold").closest("strong")).toBeTruthy();
  });

  it("shows search bar when entries exist", () => {
    setup([makeEntry({ id: "e1" })]);
    render(<ChangelogFeed />);
    expect(screen.getByPlaceholderText("Search changelog...")).toBeInTheDocument();
  });

  it("does not show search bar in empty state", () => {
    setup([]);
    render(<ChangelogFeed />);
    expect(screen.queryByPlaceholderText("Search changelog...")).not.toBeInTheDocument();
  });

  describe("search filtering", () => {
    const entries = [
      makeEntry({ id: "e1", headline: "Database migration", description: "Updated schema", category: "refactor", files_changed: ["database.rs"] }),
      makeEntry({ id: "e2", headline: "Fix login bug", description: "Corrected auth flow", category: "bugfix", files_changed: ["auth.ts"] }),
      makeEntry({ id: "e3", headline: "Add dark theme", description: "New `ThemeProvider` component", category: "feature", files_changed: ["theme.tsx"] }),
    ];

    it("filters by headline text", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      const input = screen.getByPlaceholderText("Search changelog...");
      await userEvent.type(input, "migration");
      expect(screen.getByText("Database migration")).toBeInTheDocument();
      expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();
      expect(screen.queryByText("Add dark theme")).not.toBeInTheDocument();
    });

    it("filters by description text", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "auth flow");
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      expect(screen.queryByText("Database migration")).not.toBeInTheDocument();
    });

    it("filters by file name", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "database.rs");
      expect(screen.getByText("Database migration")).toBeInTheDocument();
      expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();
    });

    it("filters by category", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "bugfix");
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      expect(screen.queryByText("Database migration")).not.toBeInTheDocument();
    });

    it("uses AND logic for multi-token queries", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "fix auth");
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      expect(screen.queryByText("Database migration")).not.toBeInTheDocument();
    });

    it("shows result count when filtering", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "migration");
      expect(screen.getByText("1 of 3")).toBeInTheDocument();
    });

    it("shows empty search state when no results", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "nonexistent");
      expect(screen.getByText("No entries match your search")).toBeInTheDocument();
    });

    it("clears search when X button clicked", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "migration");
      expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();

      await userEvent.click(screen.getByTitle("Clear search"));
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      expect(screen.getByText("Database migration")).toBeInTheDocument();
    });

    it("clears search via 'Clear search' link in empty state", async () => {
      setup(entries);
      render(<ChangelogFeed />);
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "zzzzz");
      expect(screen.getByText("No entries match your search")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Clear search"));
      expect(screen.getByText("Database migration")).toBeInTheDocument();
    });
  });

  describe("null safety", () => {
    it("handles entry with null files_changed without crashing", async () => {
      const entry = makeEntry({ id: "e1", headline: "Test" });
      // Simulate runtime null from backend
      (entry as unknown as Record<string, unknown>).files_changed = null;
      setup([entry]);
      render(<ChangelogFeed />);

      // Should render without crashing
      expect(screen.getByPlaceholderText("Search changelog...")).toBeInTheDocument();

      // Search should also work without crashing
      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "test");
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    it("handles entry with undefined files_changed without crashing", async () => {
      const entry = makeEntry({ id: "e1", headline: "Test" });
      (entry as unknown as Record<string, unknown>).files_changed = undefined;
      setup([entry]);
      render(<ChangelogFeed />);

      await userEvent.type(screen.getByPlaceholderText("Search changelog..."), "test");
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    it("handles entry with null technical_details and tools_summary", () => {
      const entry = makeEntry({ id: "e1" });
      (entry as unknown as Record<string, unknown>).technical_details = null;
      (entry as unknown as Record<string, unknown>).tools_summary = null;
      setup([entry]);
      render(<ChangelogFeed />);
      expect(screen.getByText("Added feature")).toBeInTheDocument();
    });
  });
});
