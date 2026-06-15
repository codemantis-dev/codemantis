import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StuckActivityBanner from "./StuckActivityBanner";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import { mockInvoke } from "../../test/helpers/tauri-mock-factory";
import type { Session } from "../../types/session";
import type { AgentId } from "../../types/agent-events";

const SID = "s-banner";

function seedSession(agentId: AgentId | undefined): void {
  const session: Session = {
    id: SID,
    name: "T",
    project_path: "/p",
    status: "connected",
    created_at: "2026-01-01T00:00:00Z",
    model: null,
    icon_index: 0,
    cli_session_id: null,
    agent_id: agentId,
  };
  useSessionStore.getState().addSession(session);
}

describe("StuckActivityBanner", () => {
  beforeEach(() => {
    resetAllStores();
    mockInvoke({ interrupt_session: () => undefined });
  });

  it("renders nothing when the session is not stuck", () => {
    const { container } = render(<StuckActivityBanner sessionId={SID} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a Reopen approval button when reason is pending-approval-not-shown", () => {
    seedSession("claude_code");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/waiting for your approval/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reopen approval/i })).toBeInTheDocument();
  });

  it("renders only Stop session for no-progress (no Reopen button)", () => {
    seedSession("claude_code");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 35_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/hasn't responded for/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reopen approval/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop session/i })).toBeInTheDocument();
  });

  // Regression: stuck banner used to hardcode "Codex" for every agent, so a
  // crash-recovered Claude Code session showed "Codex hasn't responded…".
  // The banner must read `session.agent_id` and label accordingly.
  it("labels a Claude Code session as 'Claude Code' in the no-progress message", () => {
    seedSession("claude_code");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 30_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/Claude Code hasn't responded for/)).toBeInTheDocument();
    expect(screen.queryByText(/Codex hasn't responded/)).not.toBeInTheDocument();
  });

  it("labels a Codex session as 'Codex' in the no-progress message", () => {
    seedSession("codex");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 30_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/Codex hasn't responded for/)).toBeInTheDocument();
    expect(screen.queryByText(/Claude Code hasn't responded/)).not.toBeInTheDocument();
  });

  it("labels Claude Code in the pending-approval message", () => {
    seedSession("claude_code");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(
      screen.getByText(/Claude Code is waiting for your approval/),
    ).toBeInTheDocument();
  });

  it("labels Codex in the pending-approval message", () => {
    seedSession("codex");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(
      screen.getByText(/Codex is waiting for your approval/),
    ).toBeInTheDocument();
  });

  // Legacy fixtures and pre-Phase-2 sessions can have agent_id undefined;
  // the type contract is "default to claude_code". Render must follow.
  it("defaults to 'Claude Code' when the session has no agent_id field", () => {
    seedSession(undefined);
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 30_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/Claude Code hasn't responded for/)).toBeInTheDocument();
  });

  it("Reopen approval button toggles showApprovalModal", () => {
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    useUiStore.getState().setShowApprovalModal(false);
    render(<StuckActivityBanner sessionId={SID} />);
    fireEvent.click(screen.getByRole("button", { name: /Reopen approval/i }));
    expect(useUiStore.getState().showApprovalModal).toBe(true);
  });

  it("Stop session button calls interrupt_session for a Claude Code session", async () => {
    seedSession("claude_code");
    let called = false;
    mockInvoke({
      interrupt_session: (args: unknown) => {
        const { sessionId } = args as { sessionId: string };
        if (sessionId === SID) called = true;
        return undefined;
      },
    });
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 35_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Stop session/i }));
    });

    expect(called).toBe(true);
  });

  // A wedged Codex won't honour a graceful interrupt, so the banner must
  // hard-restart: kill the process (pause) then respawn resuming the same
  // thread (resume). Regression for "Stop session doesn't work in Codex".
  it("Stop session hard-restarts a Codex session (pause + resume) and clears stuck", async () => {
    seedSession("codex");
    const calls: string[] = [];
    mockInvoke({
      pause_session_process: (args: unknown) => {
        calls.push("pause:" + (args as { sessionId: string }).sessionId);
        return undefined;
      },
      resume_session_process: (args: unknown) => {
        calls.push("resume:" + (args as { sessionId: string }).sessionId);
        return undefined;
      },
      interrupt_session: () => {
        calls.push("interrupt");
        return undefined;
      },
    });
    useSessionStore.getState().setSessionBusy(SID, true);
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 35_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Stop session/i }));
    });

    // Hard restart, in order, and NOT the graceful interrupt.
    expect(calls).toEqual([`pause:${SID}`, `resume:${SID}`]);
    expect(calls).not.toContain("interrupt");
    // Busy + stuck cleared so the input returns to normal and the banner hides.
    expect(useSessionStore.getState().sessionBusy.get(SID)).toBe(false);
    expect(useSessionStore.getState().sessionStuck.get(SID)).toBeUndefined();
  });

  // A Codex session stuck WHILE COMPACTING is the upstream-compaction hang.
  // "Stop session" (revive) would re-load the doomed context and re-hang, so
  // the banner must offer "Start fresh thread" as the way out, with copy that
  // names the known OpenAI bug.
  it("offers 'Start fresh thread' (not just Stop) for a Codex session stuck while compacting", async () => {
    seedSession("codex");
    let resetCalled = false;
    mockInvoke({
      summarize_conversation_for_recap: () => "RECAP",
      reset_codex_thread: (args: unknown) => {
        if ((args as { sessionId: string }).sessionId === SID) resetCalled = true;
        return "thr_new";
      },
    });
    useSessionStore.getState().setSessionBusy(SID, true);
    useSessionStore.getState().setSessionCompacting(SID, true);
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 35_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);

    // Compaction-aware copy + the fresh-thread escape.
    expect(screen.getByText(/Codex has been compacting/i)).toBeInTheDocument();
    expect(screen.getByText(/known OpenAI bug/i)).toBeInTheDocument();
    const freshBtn = screen.getByRole("button", { name: /Start fresh thread/i });

    await act(async () => {
      fireEvent.click(freshBtn);
    });

    expect(resetCalled).toBe(true);
  });
});
