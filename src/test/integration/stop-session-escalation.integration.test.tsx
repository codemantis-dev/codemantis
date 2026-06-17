/**
 * Integration test: unified Stop escalation across the input area, the
 * session store, and the stuck banner.
 *
 * Before this change there were two disconnected stop controls: the in-chat
 * Stop (graceful interrupt only — useless against a wedged CLI) and the
 * stuck-banner "Stop session" (forceful, but only after a 30s watchdog delay).
 * Now a single escalating path lives in useStopSession, driven by the in-chat
 * Stop / Esc:
 *
 *   1. Wedged CLI: Stop sends a graceful interrupt; the CLI never emits
 *      turn_complete; after FORCE_STOP_TIMEOUT_MS the hook force-stops
 *      (Codex: kill+respawn) and locally clears busy — the input returns to
 *      Send and the stuck banner hides, WITHOUT the user touching the banner.
 *   2. Healthy CLI: Stop sends a graceful interrupt; turn_complete arrives and
 *      clears busy; the pending escalation is cancelled (no force / no respawn).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import InputArea from "../../components/input/InputArea";
import StuckActivityBanner from "../../components/chat/StuckActivityBanner";
import { useSessionStore } from "../../stores/sessionStore";
import { resetAllStores } from "../helpers/store-reset";
import { mockInvoke } from "../helpers/tauri-mock-factory";
import { FORCE_STOP_TIMEOUT_MS } from "../../hooks/useStopSession";
import type { Session } from "../../types/session";
import type { AgentId } from "../../types/agent-events";

const SID = "s-int-stop";

function seedBusySession(agentId: AgentId, cliSessionId: string | null): void {
  const session: Session = {
    id: SID,
    name: "T",
    project_path: "/p",
    status: "connected",
    created_at: "2026-01-01T00:00:00Z",
    model: null,
    icon_index: 0,
    cli_session_id: cliSessionId,
    agent_id: agentId,
  };
  const store = useSessionStore.getState();
  store.addSession(session);
  store.setActiveSession(SID);
  store.setSessionBusy(SID, true);
}

function Harness(): React.JSX.Element {
  return (
    <div>
      <StuckActivityBanner sessionId={SID} />
      <InputArea />
    </div>
  );
}

describe("stop-session escalation (integration)", () => {
  beforeEach(() => {
    resetAllStores();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("wedged Codex: in-chat Stop escalates to force-stop and hides the stuck banner — no banner click", async () => {
    const calls: string[] = [];
    mockInvoke({
      interrupt_session: () => { calls.push("interrupt"); return undefined; },
      pause_session_process: () => { calls.push("pause"); return undefined; },
      resume_session_process: () => { calls.push("resume"); return undefined; },
    });
    seedBusySession("codex", "thr_int");
    // The watchdog has already flagged this session as stuck (the banner shows).
    useSessionStore.getState().setSessionStuck(SID, { since: Date.now(), reason: "no-progress" });

    render(<Harness />);
    expect(screen.getByText(/hasn't responded for/i)).toBeInTheDocument();
    // The banner no longer offers its own generic stop button.
    expect(screen.queryByRole("button", { name: /Stop session/i })).not.toBeInTheDocument();

    // User clicks the in-chat Stop. The (wedged) CLI never emits turn_complete.
    act(() => { fireEvent.click(screen.getByText("Stop").closest("button")!); });
    expect(calls).toEqual(["interrupt"]);

    await act(async () => { vi.advanceTimersByTime(FORCE_STOP_TIMEOUT_MS); });

    // Escalated: process killed + respawned, busy cleared, banner gone, Send back.
    expect(calls).toEqual(["interrupt", "pause", "resume"]);
    expect(useSessionStore.getState().sessionBusy.get(SID)).toBe(false);
    expect(useSessionStore.getState().sessionStuck.get(SID)).toBeUndefined();
    expect(screen.queryByText(/hasn't responded for/i)).not.toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("healthy CLI: turn_complete clears busy before the timeout, cancelling the force escalation", async () => {
    const calls: string[] = [];
    mockInvoke({
      interrupt_session: () => { calls.push("interrupt"); return undefined; },
      pause_session_process: () => { calls.push("pause"); return undefined; },
      resume_session_process: () => { calls.push("resume"); return undefined; },
    });
    seedBusySession("codex", "thr_ok");

    render(<Harness />);
    act(() => { fireEvent.click(screen.getByText("Stop").closest("button")!); });
    expect(screen.getByText("Stopping...")).toBeInTheDocument();

    // The CLI honours the graceful interrupt: turn_complete → busy cleared.
    act(() => { useSessionStore.getState().setSessionBusy(SID, false); });

    await act(async () => { vi.advanceTimersByTime(FORCE_STOP_TIMEOUT_MS); });

    // Graceful only — no kill/respawn happened.
    expect(calls).toEqual(["interrupt"]);
    expect(useSessionStore.getState().sessionBusy.get(SID)).toBe(false);
    expect(screen.getByText("Send")).toBeInTheDocument();
  });
});
