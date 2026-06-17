import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useStopSession,
  FORCE_STOP_TIMEOUT_MS,
  STOPPING_LABEL,
  FORCE_STOPPING_LABEL,
} from "./useStopSession";
import { useSessionStore } from "../stores/sessionStore";
import { resetAllStores } from "../test/helpers/store-reset";
import { mockInvoke } from "../test/helpers/tauri-mock-factory";
import type { Session } from "../types/session";
import type { AgentId } from "../types/agent-events";

const SID = "s-stop";

function seedBusySession(agentId: AgentId, cliSessionId: string | null = null): void {
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
  useSessionStore.getState().addSession(session);
  useSessionStore.getState().setSessionBusy(SID, true);
}

/** Records the order of relevant Tauri commands. */
function trackInvoke(): string[] {
  const calls: string[] = [];
  mockInvoke({
    interrupt_session: () => {
      calls.push("interrupt");
      return undefined;
    },
    pause_session_process: (args: unknown) => {
      calls.push("pause:" + (args as { sessionId: string }).sessionId);
      return undefined;
    },
    resume_session_process: (args: unknown) => {
      const a = args as { sessionId: string; cliSessionId?: string | null };
      calls.push(`resume:${a.sessionId}:${a.cliSessionId ?? "null"}`);
      return undefined;
    },
  });
  return calls;
}

describe("useStopSession", () => {
  beforeEach(() => {
    resetAllStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("phase 1 sends a single graceful interrupt and shows 'Stopping...'", () => {
    const calls = trackInvoke();
    seedBusySession("claude_code");
    const { result } = renderHook(() => useStopSession());

    act(() => result.current.stopSession(SID));

    expect(calls).toEqual(["interrupt"]);
    expect(result.current.getStopPhase(SID)).toBe("stopping");
    expect(useSessionStore.getState().sessionActivity.get(SID)?.label).toBe(STOPPING_LABEL);
    // Busy stays true — we are waiting for the CLI to acknowledge.
    expect(useSessionStore.getState().sessionBusy.get(SID)).toBe(true);
  });

  it("auto-forces a Claude session after the timeout (no pause/resume) and clears busy", async () => {
    const calls = trackInvoke();
    seedBusySession("claude_code");
    const { result } = renderHook(() => useStopSession());

    act(() => result.current.stopSession(SID));
    await act(async () => {
      vi.advanceTimersByTime(FORCE_STOP_TIMEOUT_MS);
    });

    // Claude force path never kills the process — just clears local state.
    expect(calls).toEqual(["interrupt"]);
    expect(useSessionStore.getState().sessionBusy.get(SID)).toBe(false);
    expect(result.current.getStopPhase(SID)).toBe("idle");
  });

  it("auto-forces a Codex session via pause+resume (in order, with cli_session_id) and clears stuck", async () => {
    const calls = trackInvoke();
    seedBusySession("codex", "thr_42");
    useSessionStore.getState().setSessionStuck(SID, { since: Date.now(), reason: "no-progress" });
    const { result } = renderHook(() => useStopSession());

    act(() => result.current.stopSession(SID));
    await act(async () => {
      vi.advanceTimersByTime(FORCE_STOP_TIMEOUT_MS);
    });

    expect(calls).toEqual(["interrupt", `pause:${SID}`, `resume:${SID}:thr_42`]);
    expect(useSessionStore.getState().sessionBusy.get(SID)).toBe(false);
    expect(useSessionStore.getState().sessionStuck.get(SID)).toBeUndefined();
  });

  it("finalizes a dangling streaming bubble when forcing", async () => {
    trackInvoke();
    seedBusySession("claude_code");
    useSessionStore.getState().startStreaming(SID, "m1");
    expect(useSessionStore.getState().sessionStreaming.get(SID)?.isStreaming).toBe(true);
    const { result } = renderHook(() => useStopSession());

    act(() => result.current.stopSession(SID));
    await act(async () => {
      vi.advanceTimersByTime(FORCE_STOP_TIMEOUT_MS);
    });

    expect(useSessionStore.getState().sessionStreaming.get(SID)?.isStreaming).toBeFalsy();
  });

  it("a second press while 'stopping' escalates immediately, without waiting for the timer", async () => {
    const calls = trackInvoke();
    seedBusySession("codex", "thr_9");
    const { result } = renderHook(() => useStopSession());

    act(() => result.current.stopSession(SID));
    expect(calls).toEqual(["interrupt"]);

    await act(async () => {
      result.current.stopSession(SID); // re-click — escalate now
    });

    // Force fired without any timer advance.
    expect(calls).toEqual(["interrupt", `pause:${SID}`, `resume:${SID}:thr_9`]);
    expect(useSessionStore.getState().sessionBusy.get(SID)).toBe(false);
  });

  it("cancels the escalation when the CLI clears busy first (happy path) — no force calls", async () => {
    const calls = trackInvoke();
    seedBusySession("codex", "thr_1");
    const { result } = renderHook(() => useStopSession());

    act(() => result.current.stopSession(SID));
    // Simulate turn_complete arriving: busy goes false before the timeout.
    act(() => useSessionStore.getState().setSessionBusy(SID, false));

    await act(async () => {
      vi.advanceTimersByTime(FORCE_STOP_TIMEOUT_MS);
    });

    expect(calls).toEqual(["interrupt"]); // never escalated → no pause/resume
    expect(result.current.getStopPhase(SID)).toBe("idle");
  });

  it("is a no-op when the session is not busy", () => {
    const calls = trackInvoke();
    seedBusySession("claude_code");
    useSessionStore.getState().setSessionBusy(SID, false);
    const { result } = renderHook(() => useStopSession());

    act(() => result.current.stopSession(SID));

    expect(calls).toEqual([]);
    expect(result.current.getStopPhase(SID)).toBe("idle");
  });

  it("leaks no timer after unmount — advancing time does nothing", async () => {
    const calls = trackInvoke();
    seedBusySession("claude_code");
    const { result, unmount } = renderHook(() => useStopSession());

    act(() => result.current.stopSession(SID));
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(FORCE_STOP_TIMEOUT_MS * 2);
    });

    // Only the graceful interrupt ran; the unmount cleared the pending force.
    expect(calls).toEqual(["interrupt"]);
    expect(useSessionStore.getState().sessionBusy.get(SID)).toBe(true);
  });

  it("does not pause/resume twice when stopSession is mashed during a force", async () => {
    const calls = trackInvoke();
    seedBusySession("codex", "thr_2");
    const { result } = renderHook(() => useStopSession());

    await act(async () => {
      result.current.stopSession(SID); // phase 1
      result.current.stopSession(SID); // escalate → forcing
      result.current.stopSession(SID); // ignored (already forcing)
    });

    expect(calls.filter((c) => c.startsWith("pause:"))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("resume:"))).toHaveLength(1);
  });

  it("surfaces the Force-stopping label during the forceful phase", async () => {
    trackInvoke();
    seedBusySession("codex", "thr_3");
    // Capture the label set right when forcing begins (before busy is cleared).
    let labelDuringForce: string | undefined;
    mockInvoke({
      interrupt_session: () => undefined,
      pause_session_process: () => {
        labelDuringForce = useSessionStore.getState().sessionActivity.get(SID)?.label;
        return undefined;
      },
      resume_session_process: () => undefined,
    });
    const { result } = renderHook(() => useStopSession());

    await act(async () => {
      result.current.stopSession(SID);
      result.current.stopSession(SID); // escalate
    });

    expect(labelDuringForce).toBe(FORCE_STOPPING_LABEL);
  });
});
