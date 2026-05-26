import { describe, it, expect, vi, beforeEach } from "vitest";
import { hydratePersistedOpenSessions } from "./crash-recovery";
import type { SessionHistoryEntry } from "../types/session";

const showToast = vi.fn();
vi.mock("../stores/toastStore", () => ({
  showToast: (msg: string, type: string) => showToast(msg, type),
}));

const listCrashedSessions = vi.fn<() => Promise<SessionHistoryEntry[]>>();
const acknowledgeCrashedSessions = vi.fn<(ids: string[]) => Promise<void>>(() => Promise.resolve());
vi.mock("./tauri-commands", () => ({
  listCrashedSessions: () => listCrashedSessions(),
  acknowledgeCrashedSessions: (ids: string[]) => acknowledgeCrashedSessions(ids),
}));

const readWorkspaceSnapshot = vi.fn(() => null);
const clearWorkspaceSnapshot = vi.fn();
vi.mock("../hooks/useCrashRecoverySnapshot", () => ({
  readWorkspaceSnapshot: () => readWorkspaceSnapshot(),
  clearWorkspaceSnapshot: () => clearWorkspaceSnapshot(),
}));

vi.mock("../stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({ setActiveSession: vi.fn() }),
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

describe("crash-recovery toast count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
