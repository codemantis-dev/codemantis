import { describe, it, expect, vi, beforeEach } from "vitest";
import { hydratePersistedOpenSessions } from "./crash-recovery";
import type { Session, SessionHistoryEntry } from "../types/session";

const showToast = vi.fn();
vi.mock("../stores/toastStore", () => ({
  showToast: (msg: string, type: string) => showToast(msg, type),
}));

const listCrashedSessions = vi.fn<() => Promise<SessionHistoryEntry[]>>();
const acknowledgeCrashedSessions = vi.fn<(ids: string[]) => Promise<void>>(() => Promise.resolve());
const consumeWakeRecoveryFlag = vi.fn<() => Promise<boolean>>(() => Promise.resolve(false));
const listLiveSessions = vi.fn<() => Promise<Session[]>>(() => Promise.resolve([]));
vi.mock("./tauri-commands", () => ({
  listCrashedSessions: () => listCrashedSessions(),
  acknowledgeCrashedSessions: (ids: string[]) => acknowledgeCrashedSessions(ids),
  consumeWakeRecoveryFlag: () => consumeWakeRecoveryFlag(),
  listLiveSessions: () => listLiveSessions(),
}));

const readWorkspaceSnapshot = vi.fn(() => null);
const clearWorkspaceSnapshot = vi.fn();
vi.mock("../hooks/useCrashRecoverySnapshot", () => ({
  readWorkspaceSnapshot: () => readWorkspaceSnapshot(),
  clearWorkspaceSnapshot: () => clearWorkspaceSnapshot(),
}));

const setActiveSession = vi.fn();
vi.mock("../stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({ setActiveSession }),
  },
}));

function makeEntry(id: string): SessionHistoryEntry {
  return {
    session_id: id,
    name: id,
    project_path: "/proj",
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    status: "paused",
    was_open: 1,
    icon_index: 0,
    model: null,
  } as unknown as SessionHistoryEntry;
}

function makeLive(id: string, project = "/proj"): Session {
  return {
    id,
    name: id,
    project_path: project,
    status: "connected",
    created_at: new Date().toISOString(),
    model: null,
    icon_index: 0,
  };
}

describe("crash-recovery toast count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeWakeRecoveryFlag.mockResolvedValue(false);
    listLiveSessions.mockResolvedValue([]);
  });

  it("toast counts only sessions that actually restored — not failures", async () => {
    // Regression: previously the toast used orderedEntries.length, which
    // included sessions that threw during restore. User saw "Recovered 3"
    // when only 1 actually came back. Partial failures are now `info`
    // severity (not error) because the user has a clear path to recover the
    // remainder via Open → Resume Session — no actionable error to surface.
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b"), makeEntry("c")]);
    const restorePausedSession = vi.fn(async (entry: SessionHistoryEntry) => {
      if (entry.session_id !== "a") throw new Error("boom");
    });

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(restorePausedSession).toHaveBeenCalledTimes(3);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, severity] = showToast.mock.calls[0];
    expect(message).toContain("Recovered 1 of 3");
    expect(message).toContain("Resume Session");
    expect(severity).toBe("info");
  });

  it("uses the info severity and a clean message when nothing failed", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, severity] = showToast.mock.calls[0];
    expect(message).toBe("Recovered 2 sessions from an unexpected shutdown");
    expect(severity).toBe("info");
  });

  it("reports a pure-failure shutdown with the error severity and Resume Session pointer", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b")]);
    const restorePausedSession = vi.fn(() => Promise.reject(new Error("boom")));

    await hydratePersistedOpenSessions(restorePausedSession);

    const [message, severity] = showToast.mock.calls[0];
    expect(message).toContain("Couldn't auto-restore 2 sessions");
    expect(message).toContain("Resume Session");
    expect(severity).toBe("error");
  });

  it("singularizes correctly for one session", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(showToast.mock.calls[0][0]).toBe("Recovered 1 session from an unexpected shutdown");
  });
});

describe("crash-recovery acknowledge semantics — Bug 2 regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeWakeRecoveryFlag.mockResolvedValue(false);
    listLiveSessions.mockResolvedValue([]);
  });

  it("acknowledges ONLY the sessions that actually restored", async () => {
    // Bug 2: previously the recovery code called acknowledgeCrashedSessions
    // on every entry from listCrashedSessions, including ones that threw.
    // A transient frontend error would clear was_open=0 → the session
    // permanently disappeared from every UI surface. The fix is to only
    // acknowledge the restoredIds list.
    listCrashedSessions.mockResolvedValue([
      makeEntry("ok-1"),
      makeEntry("ok-2"),
      makeEntry("threw"),
    ]);
    const restorePausedSession = vi.fn(async (entry: SessionHistoryEntry) => {
      if (entry.session_id === "threw") throw new Error("restore broke");
    });

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(acknowledgeCrashedSessions).toHaveBeenCalledTimes(1);
    const acked = acknowledgeCrashedSessions.mock.calls[0][0];
    expect(acked).toEqual(["ok-1", "ok-2"]);
    expect(acked).not.toContain("threw");
  });

  it("does NOT call acknowledgeCrashedSessions when EVERY restore failed", async () => {
    // No restoredIds → no acknowledge call. The was_open=1 rows stay set in
    // SQLite and remain visible in the Resume Session tab (database.rs
    // accepts was_open=1 alongside status='closed').
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b")]);
    const restorePausedSession = vi.fn(() => Promise.reject(new Error("boom")));

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(acknowledgeCrashedSessions).not.toHaveBeenCalled();
  });

  it("survives an acknowledge() throw without obscuring the restore outcome", async () => {
    // If the backend errors during acknowledge, the user still gets the
    // recovered-session toast (their sessions are visually restored). The
    // acknowledge failure is logged but does NOT downgrade the toast — the
    // worst case is the same session resurfaces on next boot as a duplicate
    // recovery entry, which is recoverable.
    listCrashedSessions.mockResolvedValue([makeEntry("a")]);
    acknowledgeCrashedSessions.mockRejectedValueOnce(new Error("ack failed"));
    const restorePausedSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(showToast).toHaveBeenCalledWith(
      "Recovered 1 session from an unexpected shutdown",
      "info",
    );
  });
});

describe("wake-recovery branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeWakeRecoveryFlag.mockResolvedValue(false);
    listLiveSessions.mockResolvedValue([]);
    acknowledgeCrashedSessions.mockResolvedValue(undefined);
    setActiveSession.mockClear();
    readWorkspaceSnapshot.mockReturnValue(null);
  });

  it("does NOT consult listLiveSessions when no reattachLiveSession callback is supplied", async () => {
    // Backwards-compat guard: callers that don't pass the second arg
    // (older code, focused unit tests) must take the legacy crash path
    // even if the backend would have reported a wake-recovery reload.
    // Otherwise old call sites silently change behaviour on upgrade.
    consumeWakeRecoveryFlag.mockResolvedValue(true);
    listCrashedSessions.mockResolvedValue([makeEntry("a")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(consumeWakeRecoveryFlag).not.toHaveBeenCalled();
    expect(listLiveSessions).not.toHaveBeenCalled();
    expect(restorePausedSession).toHaveBeenCalledTimes(1);
  });

  it("re-attaches live sessions in place without routing them through restorePausedSession", async () => {
    // The headline wake-recovery scenario: WebContent hung after wake,
    // the Rust observer reloaded the renderer, and the CLI subprocesses
    // for all 3 sessions are still alive in AppState.processes. The
    // frontend must re-attach via the live path — no --resume spawn,
    // no paused-recovered tab.
    consumeWakeRecoveryFlag.mockResolvedValue(true);
    listLiveSessions.mockResolvedValue([makeLive("a"), makeLive("b"), makeLive("c")]);
    listCrashedSessions.mockResolvedValue([]);
    const restorePausedSession = vi.fn(() => Promise.resolve());
    const reattachLiveSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession, reattachLiveSession);

    expect(reattachLiveSession).toHaveBeenCalledTimes(3);
    expect(restorePausedSession).not.toHaveBeenCalled();
    // Toast confirms the "still running" path — the win the
    // wake_state_must_restore rule asks for.
    const [msg, severity] = showToast.mock.calls[0];
    expect(msg).toContain("still running");
    expect(severity).toBe("info");
  });

  it("falls back to restorePausedSession for dead CLI processes on the wake branch", async () => {
    // Mixed scenario: 2 sessions still alive, 1 died while WebContent
    // was hung (e.g. the user's Mac OOM-killed it during sleep). The
    // dead one must still come back — just via the existing
    // paused-recovered tab path so the user can decide to --resume.
    consumeWakeRecoveryFlag.mockResolvedValue(true);
    listLiveSessions.mockResolvedValue([makeLive("a"), makeLive("b")]);
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b"), makeEntry("c")]);
    const restorePausedSession = vi.fn(async (_e: SessionHistoryEntry) => {});
    const reattachLiveSession = vi.fn(async (_s: Session) => {});

    await hydratePersistedOpenSessions(restorePausedSession, reattachLiveSession);

    expect(reattachLiveSession).toHaveBeenCalledTimes(2);
    // Only the dead session takes the paused path; the two live ones
    // must NOT — otherwise we'd briefly show a Resume banner on a
    // running session, which is exactly what the rule forbids.
    expect(restorePausedSession).toHaveBeenCalledTimes(1);
    expect(restorePausedSession.mock.calls[0][0].session_id).toBe("c");
  });

  it("acknowledges only the live sessions that have a crashed-list row to clear", async () => {
    // A session that is live but never had was_open=1 set (rare: brand-new
    // session created between snapshot and reload) doesn't need to be
    // acknowledged. Acknowledging an id that isn't in the crashed list
    // is harmless but wasteful — verify we don't bother.
    consumeWakeRecoveryFlag.mockResolvedValue(true);
    listLiveSessions.mockResolvedValue([makeLive("live-only"), makeLive("live-and-crashed")]);
    listCrashedSessions.mockResolvedValue([makeEntry("live-and-crashed")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());
    const reattachLiveSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession, reattachLiveSession);

    expect(acknowledgeCrashedSessions).toHaveBeenCalledTimes(1);
    expect(acknowledgeCrashedSessions.mock.calls[0][0]).toEqual(["live-and-crashed"]);
  });

  it("keeps was_open=1 for a session whose re-attach throws", async () => {
    // Same failure semantics as the crash branch: a session that throws
    // during re-attach must NOT be acknowledged. It stays in was_open=1
    // so the user finds it in Open → Resume Session on next launch.
    consumeWakeRecoveryFlag.mockResolvedValue(true);
    listLiveSessions.mockResolvedValue([makeLive("ok"), makeLive("broken")]);
    listCrashedSessions.mockResolvedValue([makeEntry("ok"), makeEntry("broken")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());
    const reattachLiveSession = vi.fn(async (s: Session) => {
      if (s.id === "broken") throw new Error("re-attach blew up");
    });

    await hydratePersistedOpenSessions(restorePausedSession, reattachLiveSession);

    expect(acknowledgeCrashedSessions).toHaveBeenCalledTimes(1);
    const acked = acknowledgeCrashedSessions.mock.calls[0][0];
    expect(acked).toEqual(["ok"]);
    expect(acked).not.toContain("broken");
  });

  it("treats a consumeWakeRecoveryFlag throw as 'not a wake recovery' and proceeds normally", async () => {
    // Defensive: the new Tauri command must never wedge crash-recovery.
    // If it errors (backend mismatch, IPC race), fall through to the
    // legacy crash path so the user still gets their sessions back.
    consumeWakeRecoveryFlag.mockRejectedValueOnce(new Error("ipc dead"));
    listCrashedSessions.mockResolvedValue([makeEntry("a")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());
    const reattachLiveSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession, reattachLiveSession);

    expect(reattachLiveSession).not.toHaveBeenCalled();
    expect(restorePausedSession).toHaveBeenCalledTimes(1);
  });

  it("uses the workspace-snapshot active selection after a wake-recovery reload", async () => {
    // The wake_state_must_restore rule covers active selection, not just
    // tab presence — landing on the wrong tab after a reload is still a
    // regression. Verify the snapshot's activeSessionId is honoured even
    // on the wake branch.
    consumeWakeRecoveryFlag.mockResolvedValue(true);
    listLiveSessions.mockResolvedValue([makeLive("a"), makeLive("b")]);
    listCrashedSessions.mockResolvedValue([]);
    readWorkspaceSnapshot.mockReturnValue({
      version: 1,
      savedAt: 0,
      tabOrder: ["b", "a"],
      projectOrder: ["/proj"],
      activeSessionId: "b",
      activeProjectPath: "/proj",
      projectActiveSession: [],
    } as unknown as ReturnType<typeof readWorkspaceSnapshot>);
    const restorePausedSession = vi.fn(() => Promise.resolve());
    const reattachLiveSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession, reattachLiveSession);

    expect(setActiveSession).toHaveBeenCalledWith("b");
  });
});

describe("crash-recovery auto-resume active tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeWakeRecoveryFlag.mockResolvedValue(false);
    listLiveSessions.mockResolvedValue([]);
    acknowledgeCrashedSessions.mockResolvedValue(undefined);
    readWorkspaceSnapshot.mockReturnValue(null);
  });

  it("auto-resumes ONLY the snapshot's active tab, not the idle ones", async () => {
    // The focused chat should come back live without a click; idle tabs stay
    // paused (lazy) to avoid one CLI spawn per tab on launch.
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b"), makeEntry("c")]);
    readWorkspaceSnapshot.mockReturnValue({
      version: 1,
      savedAt: 0,
      tabOrder: ["a", "b", "c"],
      projectOrder: ["/proj"],
      activeSessionId: "b",
      activeProjectPath: "/proj",
      projectActiveSession: [],
    } as unknown as ReturnType<typeof readWorkspaceSnapshot>);
    const restorePausedSession = vi.fn(() => Promise.resolve());
    const resumeRecoveredSession = vi.fn(() => Promise.resolve("b-live"));

    await hydratePersistedOpenSessions(
      restorePausedSession,
      undefined,
      resumeRecoveredSession,
    );

    expect(resumeRecoveredSession).toHaveBeenCalledTimes(1);
    expect(resumeRecoveredSession).toHaveBeenCalledWith("b");
  });

  it("falls back to the first restored tab when no snapshot active selection exists", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());
    const resumeRecoveredSession = vi.fn(() => Promise.resolve("a-live"));

    await hydratePersistedOpenSessions(
      restorePausedSession,
      undefined,
      resumeRecoveredSession,
    );

    expect(resumeRecoveredSession).toHaveBeenCalledTimes(1);
    expect(resumeRecoveredSession).toHaveBeenCalledWith("a");
  });

  it("falls back to the first restored tab when the snapshot's active tab failed to restore", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b")]);
    readWorkspaceSnapshot.mockReturnValue({
      version: 1,
      savedAt: 0,
      tabOrder: ["a", "b"],
      projectOrder: ["/proj"],
      activeSessionId: "b",
      activeProjectPath: "/proj",
      projectActiveSession: [],
    } as unknown as ReturnType<typeof readWorkspaceSnapshot>);
    // "b" throws during restore → it never lands in restoredIds, so the active
    // selection must fall through to the first session that DID restore.
    const restorePausedSession = vi.fn(async (entry: SessionHistoryEntry) => {
      if (entry.session_id === "b") throw new Error("boom");
    });
    const resumeRecoveredSession = vi.fn(() => Promise.resolve("a-live"));

    await hydratePersistedOpenSessions(
      restorePausedSession,
      undefined,
      resumeRecoveredSession,
    );

    expect(resumeRecoveredSession).toHaveBeenCalledTimes(1);
    expect(resumeRecoveredSession).toHaveBeenCalledWith("a");
  });

  it("does NOT auto-resume when nothing restored", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a")]);
    const restorePausedSession = vi.fn(() => Promise.reject(new Error("boom")));
    const resumeRecoveredSession = vi.fn(() => Promise.resolve("x"));

    await hydratePersistedOpenSessions(
      restorePausedSession,
      undefined,
      resumeRecoveredSession,
    );

    expect(resumeRecoveredSession).not.toHaveBeenCalled();
  });

  it("treats a resume failure as non-fatal — recovery toast still fires, no throw", async () => {
    // If the auto-resume spawn fails, the tab simply stays paused with its
    // Resume banner. Recovery must not be derailed.
    listCrashedSessions.mockResolvedValue([makeEntry("a")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());
    const resumeRecoveredSession = vi.fn(() => Promise.reject(new Error("spawn failed")));

    await expect(
      hydratePersistedOpenSessions(restorePausedSession, undefined, resumeRecoveredSession),
    ).resolves.toBeUndefined();

    expect(showToast).toHaveBeenCalledWith(
      "Recovered 1 session from an unexpected shutdown",
      "info",
    );
  });

  it("is a no-op when no resumeRecoveredSession callback is supplied (backward compatible)", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());

    await expect(
      hydratePersistedOpenSessions(restorePausedSession),
    ).resolves.toBeUndefined();

    expect(showToast).toHaveBeenCalledWith(
      "Recovered 1 session from an unexpected shutdown",
      "info",
    );
  });
});
