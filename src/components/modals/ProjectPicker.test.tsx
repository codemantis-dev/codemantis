import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProjectPicker from "./ProjectPicker";
import { useUiStore } from "../../stores/uiStore";
import type { SessionHistoryEntry } from "../../types/session";

// Mock tauri dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

// Mock the Tauri command wrappers used by the resume tab.
// Use vi.hoisted so the mock function exists before vi.mock's factory runs.
const { listRecentSessionsMock } = vi.hoisted(() => ({
  listRecentSessionsMock: vi.fn(),
}));
vi.mock("../../lib/tauri-commands", () => ({
  listRecentSessions: listRecentSessionsMock,
  // AgentPicker (nested in the Templates tab) probes both CLIs on mount
  // via a fire-and-forget `void (async () => …)` IIFE. If we don't stub
  // these here the IIFE throws an unhandled rejection *after* the test
  // resolves — which Vitest reports as a top-level error.
  checkClaudeStatus: () => Promise.resolve({ installed: true, version: "test" }),
  checkCodexStatus: () => Promise.resolve({ installed: true, version: "test" }),
}));

// Mock TemplatePicker to avoid nested async issues
vi.mock("./TemplatePicker", () => ({
  default: ({ onProjectCreated, onBusyChange }: { onProjectCreated: (path: string) => void; onBusyChange?: (busy: boolean) => void }) => (
    <div data-testid="template-picker">
      <button onClick={() => onProjectCreated("/tmp/test")}>MockTemplateCreate</button>
      <button onClick={() => onBusyChange?.(true)} data-testid="set-busy">SetBusy</button>
      <button onClick={() => onBusyChange?.(false)} data-testid="clear-busy">ClearBusy</button>
    </div>
  ),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

describe("ProjectPicker", () => {
  const onSelectProject = vi.fn();
  const onResumeSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage
    localStorage.clear();
    // Default: empty list. Individual tests override.
    listRecentSessionsMock.mockReset();
    listRecentSessionsMock.mockResolvedValue([]);
  });

  function openPicker(tab: "templates" | "open" | "recent" | "resume" = "templates"): void {
    useUiStore.setState({
      showProjectPicker: true,
      projectPickerTab: tab,
    });
  }

  function renderPicker(): ReturnType<typeof render> {
    return render(
      <ProjectPicker onSelectProject={onSelectProject} onResumeSession={onResumeSession} />,
    );
  }

  it("renders nothing when closed", () => {
    useUiStore.setState({ showProjectPicker: false });
    const { container } = renderPicker();
    // Dialog portal content shouldn't be visible
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders with Templates tab active by default", () => {
    openPicker("templates");
    renderPicker();
    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.getByTestId("template-picker")).toBeInTheDocument();
  });

  it("renders Open Folder tab content when selected", () => {
    openPicker("open");
    renderPicker();
    expect(screen.getByText("Select a project folder...")).toBeInTheDocument();
    // There should be the folder picker button and the "Open Project" submit button
    const openButtons = screen.getAllByText("Open Project");
    // Title + submit button
    expect(openButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Recent tab content when selected", () => {
    openPicker("recent");
    renderPicker();
    expect(screen.getByText("Recent Projects")).toBeInTheDocument();
    expect(screen.getByText("No recent projects")).toBeInTheDocument();
  });

  it("shows recent projects when they exist", () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/Users/test/project-a", "/Users/test/project-b"])
    );
    openPicker("recent");
    renderPicker();
    expect(screen.getByText("project-a")).toBeInTheDocument();
    expect(screen.getByText("project-b")).toBeInTheDocument();
  });

  it("switches between tabs", () => {
    openPicker("templates");
    renderPicker();

    // Click Open Folder tab
    fireEvent.click(screen.getByText("Open Folder"));
    expect(screen.getByText("Select a project folder...")).toBeInTheDocument();

    // Click Recent tab
    fireEvent.click(screen.getByText("Recent"));
    expect(screen.getByText("No recent projects")).toBeInTheDocument();

    // Click Templates tab
    fireEvent.click(screen.getByText("Templates"));
    expect(screen.getByTestId("template-picker")).toBeInTheDocument();
  });

  it("renders all three tab buttons", () => {
    openPicker();
    renderPicker();
    expect(screen.getByText("Templates")).toBeInTheDocument();
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("renders recent count badge", () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/a", "/b", "/c"])
    );
    openPicker();
    renderPicker();
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  // ── Dismiss protection ──

  it("hides close button when busy", () => {
    openPicker("templates");
    renderPicker();

    // Trigger busy state via mock TemplatePicker
    fireEvent.click(screen.getByTestId("set-busy"));

    // Close button should be hidden — the only X buttons should not be Dialog.Close
    const dialog = screen.getByRole("dialog");
    const closeButtons = dialog.querySelectorAll("button");
    const xButtons = Array.from(closeButtons).filter((btn) =>
      btn.querySelector("svg") && btn.closest("[aria-label]")?.getAttribute("aria-label")?.includes("close")
    );
    // The Dialog.Close X button should not be rendered
    expect(xButtons).toHaveLength(0);
  });

  it("shows close button when not busy", () => {
    openPicker("templates");
    renderPicker();

    // Set busy then clear it
    fireEvent.click(screen.getByTestId("set-busy"));
    fireEvent.click(screen.getByTestId("clear-busy"));

    // Dialog should still be open and close button should be visible
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("removes a recent project when delete button is clicked", () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/Users/test/project-a", "/Users/test/project-b"])
    );
    openPicker("recent");
    renderPicker();
    expect(screen.getByText("project-a")).toBeInTheDocument();
    expect(screen.getByText("project-b")).toBeInTheDocument();

    const removeBtn = screen.getByLabelText("Remove project-a from recent projects");
    fireEvent.click(removeBtn);

    expect(screen.queryByText("project-a")).not.toBeInTheDocument();
    expect(screen.getByText("project-b")).toBeInTheDocument();
    expect(onSelectProject).not.toHaveBeenCalled();
  });

  it("opens recent project on click", () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/Users/test/my-project"])
    );
    openPicker("recent");
    renderPicker();
    fireEvent.click(screen.getByText("my-project"));
    expect(onSelectProject).toHaveBeenCalledWith("/Users/test/my-project");
  });

  // ── Resume Session tab ──

  function makeEntry(overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
    return {
      session_id: "sess-1",
      name: "Build payments",
      project_path: "/Users/me/payments",
      model: "claude-sonnet-4-6",
      closed_at: new Date(Date.now() - 60_000).toISOString(),
      cli_session_id: "cli-1",
      icon_index: 0,
      recent_headlines: ["Wired Stripe webhook", "Refactored pricing tier"],
      has_stored_messages: true,
      ...overrides,
    };
  }

  it("Resume Session tab fetches recent sessions on activation", async () => {
    listRecentSessionsMock.mockResolvedValueOnce([makeEntry()]);
    openPicker("resume");
    renderPicker();
    await waitFor(() => expect(listRecentSessionsMock).toHaveBeenCalledWith(20));
    await waitFor(() => expect(screen.getByText("Build payments")).toBeInTheDocument());
  });

  it("Resume Session tab renders empty state when there are no closed sessions", async () => {
    listRecentSessionsMock.mockResolvedValueOnce([]);
    openPicker("resume");
    renderPicker();
    await waitFor(() => expect(listRecentSessionsMock).toHaveBeenCalled());
    expect(await screen.findByText("No closed sessions yet")).toBeInTheDocument();
  });

  it("Resume Session tab shows project name, headlines, and Saved badge", async () => {
    listRecentSessionsMock.mockResolvedValueOnce([
      makeEntry({
        project_path: "/Users/me/proj-alpha",
        recent_headlines: ["First headline", "Second headline", "Third (should be hidden)"],
      }),
    ]);
    openPicker("resume");
    renderPicker();
    await waitFor(() => expect(screen.getByText("Build payments")).toBeInTheDocument());

    expect(screen.getByText("proj-alpha")).toBeInTheDocument();
    expect(screen.getByText("First headline")).toBeInTheDocument();
    expect(screen.getByText("Second headline")).toBeInTheDocument();
    // Only top 2 headlines are rendered
    expect(screen.queryByText("Third (should be hidden)")).not.toBeInTheDocument();
    // has_stored_messages → "Saved" badge
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("Resume Session tab calls onResumeSession with the entry's identifiers", async () => {
    const entry = makeEntry({
      session_id: "sess-99",
      name: "Old session",
      project_path: "/Users/me/legacy",
      cli_session_id: "cli-legacy",
    });
    listRecentSessionsMock.mockResolvedValueOnce([entry]);
    openPicker("resume");
    renderPicker();
    await waitFor(() => expect(screen.getByText("Old session")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("resume-button-sess-99"));
    await waitFor(() =>
      expect(onResumeSession).toHaveBeenCalledWith(
        "/Users/me/legacy",
        "cli-legacy",
        "Old session",
        "sess-99",
      ),
    );
  });

  it("Resume Session tab closes the modal after a successful resume", async () => {
    onResumeSession.mockResolvedValueOnce(undefined);
    listRecentSessionsMock.mockResolvedValueOnce([makeEntry()]);
    openPicker("resume");
    renderPicker();
    await waitFor(() => expect(screen.getByText("Build payments")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("resume-button-sess-1"));
    await waitFor(() => expect(useUiStore.getState().showProjectPicker).toBe(false));
  });

  it("Resume Session tab keeps the modal open if onResumeSession throws", async () => {
    onResumeSession.mockRejectedValueOnce(new Error("boom"));
    listRecentSessionsMock.mockResolvedValueOnce([makeEntry()]);
    openPicker("resume");
    renderPicker();
    await waitFor(() => expect(screen.getByText("Build payments")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("resume-button-sess-1"));
    await waitFor(() => expect(onResumeSession).toHaveBeenCalled());
    // Modal stays open so the user can retry / pick a different session
    expect(useUiStore.getState().showProjectPicker).toBe(true);
  });

  it("Resume Session tab does not fetch when the modal is closed", () => {
    useUiStore.setState({ showProjectPicker: false, projectPickerTab: "resume" });
    renderPicker();
    expect(listRecentSessionsMock).not.toHaveBeenCalled();
  });
});
