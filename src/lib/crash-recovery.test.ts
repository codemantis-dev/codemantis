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
    // when only 1 actually came back.
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b"), makeEntry("c")]);
    const restorePausedSession = vi.fn(async (entry: SessionHistoryEntry) => {
      if (entry.session_id !== "a") throw new Error("boom");
    });

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(restorePausedSession).toHaveBeenCalledTimes(3);
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, severity] = showToast.mock.calls[0];
    expect(message).toContain("Recovered 1 session");
    expect(message).toContain("2 failed");
    expect(severity).toBe("error");
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

  it("reports a pure-failure shutdown with the error severity", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a"), makeEntry("b")]);
    const restorePausedSession = vi.fn(() => Promise.reject(new Error("boom")));

    await hydratePersistedOpenSessions(restorePausedSession);

    const [message, severity] = showToast.mock.calls[0];
    expect(message).toContain("Failed to recover 2 sessions");
    expect(severity).toBe("error");
  });

  it("singularizes correctly for one session", async () => {
    listCrashedSessions.mockResolvedValue([makeEntry("a")]);
    const restorePausedSession = vi.fn(() => Promise.resolve());

    await hydratePersistedOpenSessions(restorePausedSession);

    expect(showToast.mock.calls[0][0]).toBe("Recovered 1 session from an unexpected shutdown");
  });
});
