import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ActivityOverview from "./ActivityOverview";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import type { Session } from "../../types/session";

vi.mock("../../lib/tauri-commands", () => ({}));

function session(id: string, projectPath: string, name = id): Session {
  return {
    id,
    name,
    project_path: projectPath,
    status: "connected",
    created_at: "",
    model: null,
    icon_index: 0,
  };
}

/** Two projects: /alpha has two busy sessions, /beta has one idle session. */
function seedSessions(): void {
  useSessionStore.setState({
    projectOrder: ["/alpha", "/beta"],
    tabOrder: ["a1", "a2", "b1"],
    sessions: new Map([
      ["a1", session("a1", "/alpha", "Routing")],
      ["a2", session("a2", "/alpha", "Tests")],
      ["b1", session("b1", "/beta", "Idle one")],
    ]),
    sessionBusy: new Map([
      ["a1", true],
      ["a2", true],
    ]),
    sessionStuck: new Map(),
    sessionCompacting: new Map(),
    busySince: new Map([
      ["a1", Date.now() - 12_000],
      ["a2", Date.now() - 42_000],
    ]),
    activeSubAgents: new Map(),
    sessionActivity: new Map([
      ["a1", { label: "Editing code...", toolName: "Edit", toolElapsed: 0, filePath: "/alpha/src/routing.ts" }],
      ["a2", { label: "Running command...", toolName: "Bash", toolElapsed: 0, filePath: null }],
    ]),
  });
}

describe("ActivityOverview", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("shows the active-session count badge on the trigger and hides the panel when closed", () => {
    seedSessions();
    render(<ActivityOverview />);
    // Badge reflects the two busy sessions.
    expect(screen.getByText("2")).toBeInTheDocument();
    // Panel header is not rendered while closed.
    expect(screen.queryByText("Activity Overview")).not.toBeInTheDocument();
  });

  it("lists only working / attention sessions grouped by project when opened", () => {
    seedSessions();
    useUiStore.getState().setShowActivityOverview(true);
    render(<ActivityOverview />);

    expect(screen.getByText("Activity Overview")).toBeInTheDocument();
    // /alpha appears with its two working sessions + their activity one-liners.
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("2 working")).toBeInTheDocument();
    expect(screen.getByText("Routing")).toBeInTheDocument();
    expect(screen.getByText("Editing routing.ts")).toBeInTheDocument();
    expect(screen.getByText("Running command...")).toBeInTheDocument();
    // The idle /beta session is not listed.
    expect(screen.queryByText("Idle one")).not.toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("jumps to a session and closes the panel when a row is clicked", () => {
    seedSessions();
    useUiStore.getState().setShowActivityOverview(true);
    render(<ActivityOverview />);

    fireEvent.click(screen.getByText("Tests"));
    expect(useSessionStore.getState().activeSessionId).toBe("a2");
    expect(useSessionStore.getState().activeProjectPath).toBe("/alpha");
    expect(useUiStore.getState().showActivityOverview).toBe(false);
  });

  it("jumps to a project when its header is clicked", () => {
    seedSessions();
    // Give /alpha a remembered active session so header-click resolves it.
    useSessionStore.setState({
      projectActiveSession: new Map([["/alpha", "a1"]]),
    });
    useUiStore.getState().setShowActivityOverview(true);
    render(<ActivityOverview />);

    fireEvent.click(screen.getByText("alpha"));
    expect(useSessionStore.getState().activeProjectPath).toBe("/alpha");
    expect(useUiStore.getState().showActivityOverview).toBe(false);
  });

  it("surfaces a stuck session under attention", () => {
    seedSessions();
    useSessionStore.setState({
      sessionStuck: new Map([["a1", { since: Date.now(), reason: "no-progress" }]]),
    });
    useUiStore.getState().setShowActivityOverview(true);
    render(<ActivityOverview />);
    expect(screen.getByText("No progress — may be stuck")).toBeInTheDocument();
  });

  it("surfaces an awaiting-approval session under attention", () => {
    seedSessions();
    useActivityStore.setState({
      approvalQueue: [
        { requestId: "r1", toolUseId: "t1", toolName: "Bash", toolInput: {}, sessionId: "a1", timestamp: "" },
      ],
    });
    useUiStore.getState().setShowActivityOverview(true);
    render(<ActivityOverview />);
    expect(screen.getByText("Needs approval")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is active", () => {
    useSessionStore.setState({
      projectOrder: ["/beta"],
      tabOrder: ["b1"],
      sessions: new Map([["b1", session("b1", "/beta")]]),
      sessionBusy: new Map(),
    });
    useUiStore.getState().setShowActivityOverview(true);
    render(<ActivityOverview />);
    expect(screen.getByText("No active jobs")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    seedSessions();
    useUiStore.getState().setShowActivityOverview(true);
    render(<ActivityOverview />);
    expect(screen.getByText("Activity Overview")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useUiStore.getState().showActivityOverview).toBe(false);
  });

  it("toggles open when the trigger button is clicked", () => {
    seedSessions();
    render(<ActivityOverview />);
    expect(screen.queryByText("Activity Overview")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Activity Overview"));
    expect(useUiStore.getState().showActivityOverview).toBe(true);
    // The panel now shows the grouped list.
    expect(screen.getByText("Activity Overview")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
