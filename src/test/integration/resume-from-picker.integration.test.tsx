/**
 * Integration test: resume a session from the Open Project modal's
 * "Resume Session" tab.
 *
 * This is a cross-module test — it exercises:
 *   ProjectPicker (UI) → onResumeSession callback (App.tsx pattern) →
 *   useClaudeSession.resumeFromHistory → real sessionStore + uiStore +
 *   recent-projects localStorage.
 *
 * Only the Tauri IPC boundary (tauri-commands) is mocked.
 */
import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session, SessionHistoryEntry } from "../../types/session";
import type { AgentId } from "../../types/agent-events";

// Hoisted mocks for module factory closure access.
const { createSessionMock, listRecentSessionsMock, loadSessionMessagesMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  listRecentSessionsMock: vi.fn(),
  loadSessionMessagesMock: vi.fn(),
}));

vi.mock("../../lib/tauri-commands", () => ({
  // Used by the picker resume tab.
  listRecentSessions: listRecentSessionsMock,
  // Used by useClaudeSession.resumeFromHistory.
  createSession: createSessionMock,
  loadSessionMessages: loadSessionMessagesMock,
  closeSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  renameSession: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn().mockResolvedValue(() => {}),
  listenActivityEvents: vi.fn().mockResolvedValue(() => {}),
  initializeSession: vi.fn().mockResolvedValue(undefined),
  saveSessionMessages: vi.fn().mockResolvedValue(undefined),
  closeTerminal: vi.fn().mockResolvedValue(undefined),
  readFileContent: vi.fn().mockResolvedValue(""),
  syncSessionMode: vi.fn().mockResolvedValue(undefined),
  checkProcessAlive: vi.fn().mockResolvedValue(true),
  cleanupOldAttachments: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../lib/event-classifier", () => ({
  handleChatEvent: vi.fn(),
  handleActivityEvent: vi.fn(),
  startStaleDetection: vi.fn(),
  cleanupSession: vi.fn(),
}));

vi.mock("../../lib/error-handler", () => ({
  handleError: vi.fn(),
}));

vi.mock("../../lib/error-messages", () => ({
  translateErrorForToast: vi.fn((m: string) => m),
  translateError: vi.fn(() => ({ title: "Error", details: "test" })),
}));

import ProjectPicker from "../../components/modals/ProjectPicker";
import { useClaudeSession } from "../../hooks/useClaudeSession";

function PickerHarness(): React.ReactElement {
  // Mirrors App.tsx: handleResumeSession composes recent-projects, sessionStore,
  // and the useClaudeSession hook.
  const { resumeFromHistory } = useClaudeSession();

  const handleSelectProject = (path: string): void => {
    // Not exercised in this test, but the prop is required.
    void path;
  };

  const handleResumeSession = async (
    projectPath: string,
    cliSessionId: string,
    name: string,
    sessionId: string,
    agentId: AgentId,
  ): Promise<void> => {
    const { addRecentProject } = await import("../../lib/recent-projects");
    addRecentProject(projectPath);
    useSessionStore.getState().setActiveProject(projectPath);
    // Thread `agentId` exactly as App.tsx does — `cliSessionId` is an
    // agent-specific resume token, so the agent must be re-spawned to match
    // (see project_resume_agent_id_footgun: a missing agent defaults to
    // ClaudeCode and mis-routes a Codex resume).
    await resumeFromHistory(projectPath, cliSessionId, name, sessionId, undefined, agentId);
  };

  return (
    <ProjectPicker
      onSelectProject={handleSelectProject}
      onResumeSession={handleResumeSession}
    />
  );
}

function makeEntry(overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    session_id: "old-sess-1",
    name: "Old session",
    project_path: "/Users/me/old-proj",
    model: "claude-sonnet-4-6",
    closed_at: new Date(Date.now() - 60_000).toISOString(),
    cli_session_id: "cli-old",
    icon_index: 0,
    recent_headlines: ["Headline A", "Headline B"],
    has_stored_messages: true,
    agent_id: "claude_code",
    ...overrides,
  };
}

describe("Resume Session from Open Project modal — integration", () => {
  beforeEach(() => {
    resetAllStores();
    localStorage.clear();
    // Settings need to be loaded for useClaudeSession to read defaults.
    useSettingsStore.setState({ loaded: true });

    listRecentSessionsMock.mockReset();
    createSessionMock.mockReset();
    loadSessionMessagesMock.mockReset();

    listRecentSessionsMock.mockResolvedValue([]);
    loadSessionMessagesMock.mockResolvedValue([]);
    createSessionMock.mockImplementation(
      async (projectPath: string, name: string | undefined): Promise<Session> => ({
        id: `new-${Math.random().toString(36).slice(2, 8)}`,
        name: name ?? "Resumed",
        project_path: projectPath,
        status: "connected",
        created_at: new Date().toISOString(),
        model: "claude-sonnet-4-6",
        icon_index: 0,
      }),
    );

    useUiStore.setState({
      showProjectPicker: true,
      projectPickerTab: "resume",
    });
  });

  it("clicking Resume on a row from another project switches active project and resumes the CLI session", async () => {
    const rowOne = makeEntry({
      session_id: "old-sess-A",
      name: "Old session A",
      project_path: "/Users/me/proj-A",
      cli_session_id: "cli-A",
    });
    const rowTwo = makeEntry({
      session_id: "old-sess-B",
      name: "Old session B",
      project_path: "/Users/me/proj-B",
      cli_session_id: "cli-B",
    });
    listRecentSessionsMock.mockResolvedValueOnce([rowOne, rowTwo]);

    render(<PickerHarness />);

    // Wait for the resume tab to render entries.
    await waitFor(() => expect(screen.getByText("Old session B")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("resume-button-old-sess-B"));

    // resumeFromHistory eventually calls createSession with the resume cli id
    // AND the row's agent_id — the agent must be threaded so a Codex thread-id
    // isn't mis-routed to a default ClaudeCode process.
    await waitFor(() =>
      expect(createSessionMock).toHaveBeenCalledWith(
        "/Users/me/proj-B",
        expect.any(String),
        "cli-B",
        "claude_code",
      ),
    );

    // Stored messages from the original session should be loaded for restore.
    await waitFor(() => expect(loadSessionMessagesMock).toHaveBeenCalledWith("old-sess-B"));

    // Active project flipped to the row's project.
    await waitFor(() =>
      expect(useSessionStore.getState().activeProjectPath).toBe("/Users/me/proj-B"),
    );

    // The new session was added to the session store.
    await waitFor(() => expect(useSessionStore.getState().tabOrder.length).toBe(1));

    // Project added to localStorage recent list.
    const recent = JSON.parse(localStorage.getItem("codemantis-recent-projects") ?? "[]");
    expect(recent[0]).toBe("/Users/me/proj-B");

    // Modal closes after success.
    await waitFor(() => expect(useUiStore.getState().showProjectPicker).toBe(false));

    cleanup();
  });

  it("resuming a Codex row threads agent_id='codex' so the thread-id isn't mis-routed to ClaudeCode", async () => {
    // Regression guard for project_resume_agent_id_footgun: a Codex resume
    // token (a thread id) MUST re-spawn a Codex process. If agent_id is
    // dropped, Rust create_session defaults to ClaudeCode and rejects the
    // thread id with "No conversation found with session ID".
    const codexRow = makeEntry({
      session_id: "old-sess-CX",
      name: "Old Codex session",
      project_path: "/Users/me/proj-CX",
      cli_session_id: "thr-codex-1",
      agent_id: "codex",
    });
    listRecentSessionsMock.mockResolvedValueOnce([codexRow]);

    render(<PickerHarness />);
    await waitFor(() => expect(screen.getByText("Old Codex session")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("resume-button-old-sess-CX"));

    await waitFor(() =>
      expect(createSessionMock).toHaveBeenCalledWith(
        "/Users/me/proj-CX",
        expect.any(String),
        "thr-codex-1",
        "codex",
      ),
    );

    cleanup();
  });

  it("does NOT change active project or close the modal when no row is clicked", async () => {
    listRecentSessionsMock.mockResolvedValueOnce([makeEntry()]);
    render(<PickerHarness />);
    await waitFor(() => expect(screen.getByText("Old session")).toBeInTheDocument());

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().activeProjectPath).toBeNull();
    expect(useUiStore.getState().showProjectPicker).toBe(true);

    cleanup();
  });
});
