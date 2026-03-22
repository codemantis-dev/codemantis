import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ProjectLogFeed from "./ProjectLogFeed";
import { useSessionStore } from "../../stores/sessionStore";
import { useChangelogStore } from "../../stores/changelogStore";
import type { ProjectChangelogEntry } from "../../types/changelog";

const PROJECT_PATH = "/tmp/project";

function makeEntry(overrides: Partial<ProjectChangelogEntry> & { id: string }): ProjectChangelogEntry {
  return {
    session_id: "s1",
    session_name: "Session 1",
    timestamp: "2026-01-15T14:30:00Z",
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

function setup(entries?: ProjectChangelogEntry[]): void {
  useSessionStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    activeProjectPath: PROJECT_PATH,
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    tabOrder: [],
  });
  useChangelogStore.setState({
    sessionEntries: new Map(),
    generating: new Map(),
    projectEntries: entries !== undefined
      ? new Map([[PROJECT_PATH, entries]])
      : new Map(),
    loadProjectEntries: vi.fn().mockResolvedValue(undefined),
  });
}

describe("ProjectLogFeed", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      activeProjectPath: null,
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionContext: new Map(),
      tabOrder: [],
    });
    useChangelogStore.setState({
      sessionEntries: new Map(),
      generating: new Map(),
      projectEntries: new Map(),
      loadProjectEntries: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("shows 'No project selected' when no active project", () => {
    render(<ProjectLogFeed />);
    expect(screen.getByText("No project selected")).toBeInTheDocument();
  });

  it("shows empty state when project has no entries", async () => {
    setup([]);
    render(<ProjectLogFeed />);
    await waitFor(() => {
      expect(screen.getByText("No changelog entries yet")).toBeInTheDocument();
    });
  });

  it("renders entries with headline and description", () => {
    setup([makeEntry({ id: "e1", headline: "Refactored auth", description: "Simplified login flow" })]);
    render(<ProjectLogFeed />);
    expect(screen.getByText("Refactored auth")).toBeInTheDocument();
    expect(screen.getByText("Simplified login flow")).toBeInTheDocument();
  });

  it("shows entry count in header", () => {
    setup([makeEntry({ id: "e1" }), makeEntry({ id: "e2" })]);
    render(<ProjectLogFeed />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("displays session name badge", () => {
    setup([makeEntry({ id: "e1", session_name: "My Session" })]);
    render(<ProjectLogFeed />);
    expect(screen.getByText("My Session")).toBeInTheDocument();
  });

  it("displays category badge", () => {
    setup([makeEntry({ id: "e1", category: "bugfix" })]);
    render(<ProjectLogFeed />);
    expect(screen.getByText("Bug Fix")).toBeInTheDocument();
  });

  it("displays file change badges", () => {
    setup([makeEntry({ id: "e1", files_changed: ["src/components/App.tsx", "src/utils/helpers.ts"] })]);
    render(<ProjectLogFeed />);
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
    expect(screen.getByText("helpers.ts")).toBeInTheDocument();
  });

  it("handles entry with null files_changed without crashing", () => {
    const entry = makeEntry({ id: "e1" });
    (entry as unknown as Record<string, unknown>).files_changed = null;
    setup([entry]);
    render(<ProjectLogFeed />);
    expect(screen.getByText("Added feature")).toBeInTheDocument();
  });

  describe("copy button", () => {
    let clipboardWriteMock: ReturnType<typeof vi.fn>;
    let clipboardWriteTextMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Polyfill ClipboardItem for jsdom
      if (typeof globalThis.ClipboardItem === "undefined") {
        globalThis.ClipboardItem = class ClipboardItem {
          readonly types: string[];
          constructor(private items: Record<string, Blob>) {
            this.types = Object.keys(items);
          }
          getType(type: string): Promise<Blob> {
            return Promise.resolve(this.items[type]);
          }
        } as unknown as typeof ClipboardItem;
      }
      clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
      clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          write: clipboardWriteMock,
          writeText: clipboardWriteTextMock,
        },
      });
    });

    it("renders copy button for each entry", () => {
      setup([makeEntry({ id: "e1" }), makeEntry({ id: "e2" })]);
      render(<ProjectLogFeed />);
      const copyButtons = screen.getAllByTitle("Copy entry");
      expect(copyButtons).toHaveLength(2);
    });

    it("copies headline and description as rich text on click", async () => {
      setup([makeEntry({ id: "e1", headline: "My headline", description: "My description" })]);
      render(<ProjectLogFeed />);
      await userEvent.click(screen.getByTitle("Copy entry"));
      expect(clipboardWriteMock).toHaveBeenCalledOnce();
      const items = clipboardWriteMock.mock.calls[0][0];
      expect(items).toHaveLength(1);
    });

    it("falls back to writeText when clipboard.write fails", async () => {
      clipboardWriteMock.mockRejectedValueOnce(new Error("not supported"));
      setup([makeEntry({ id: "e1", headline: "Headline", description: "Desc" })]);
      render(<ProjectLogFeed />);
      await userEvent.click(screen.getByTitle("Copy entry"));
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("Headline\nDesc");
    });
  });

  describe("refresh", () => {
    it("calls loadProjectEntries on refresh click", async () => {
      const loadMock = vi.fn().mockResolvedValue(undefined);
      setup([makeEntry({ id: "e1" })]);
      useChangelogStore.setState({ loadProjectEntries: loadMock });
      render(<ProjectLogFeed />);
      // loadProjectEntries is called once on mount, then once on refresh
      await userEvent.click(screen.getByTitle("Refresh"));
      expect(loadMock).toHaveBeenCalledWith(PROJECT_PATH);
    });
  });
});
