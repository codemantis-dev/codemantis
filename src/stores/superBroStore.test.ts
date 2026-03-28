import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSuperBroStore } from "./superBroStore";
import type { SuperBroMessage, Observation } from "../types/super-bro";

vi.mock("../lib/tauri-commands", () => ({
  saveObservation: vi.fn().mockResolvedValue(undefined),
  loadObservations: vi.fn().mockResolvedValue([]),
  deleteObservation: vi.fn().mockResolvedValue(undefined),
}));

import {
  saveObservation,
  loadObservations,
  deleteObservation,
} from "../lib/tauri-commands";

const PROJECT = "/test/project";

function makeMessage(overrides: Partial<SuperBroMessage> = {}): SuperBroMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    guidance: "You should run the tests before committing.",
    suggestedPrompt: "pnpm test",
    fileCheckRequest: null,
    trigger: "claude_response",
    timestamp: new Date().toISOString(),
    dismissed: false,
    ...overrides,
  };
}

function makeObservation(
  overrides: Partial<Observation> = {},
): Observation {
  return {
    id: `obs-${Date.now()}-${Math.random()}`,
    text: "User prefers functional components",
    category: "preference",
    createdAt: new Date().toISOString(),
    lastReferencedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("superBroStore", () => {
  beforeEach(() => {
    useSuperBroStore.setState({
      enabledProjects: new Map(),
      projectMessages: new Map(),
      projectThinking: new Map(),
      projectCheckResult: new Map(),
      projectObservations: new Map(),
      isPaused: false,
      messageHistory: [],
      log: [],
    });
    vi.clearAllMocks();
  });

  // ── 1. Initial state ──────────────────────────────────────────────

  it("has correct initial state", () => {
    const state = useSuperBroStore.getState();
    expect(state.projectMessages).toEqual(new Map());
    expect(state.projectThinking).toEqual(new Map());
    expect(state.projectCheckResult).toEqual(new Map());
    expect(state.isPaused).toBe(false);
    expect(state.enabledProjects).toEqual(new Map());
    expect(state.projectObservations).toEqual(new Map());
    expect(state.messageHistory).toEqual([]);
    expect(state.log).toEqual([]);
  });

  // ── setAllGood / clearCheckResult ─────────────────────────────

  it("setAllGood sets per-project checkResult and clears thinking", () => {
    useSuperBroStore.getState().setThinking(PROJECT, true);
    useSuperBroStore.getState().setAllGood(PROJECT);
    const state = useSuperBroStore.getState();
    expect(state.projectCheckResult.get(PROJECT)).toBe("all_good");
    expect(state.projectThinking.get(PROJECT)).toBe(false);
  });

  it("clearCheckResult resets per-project checkResult to null", () => {
    useSuperBroStore.getState().setAllGood(PROJECT);
    useSuperBroStore.getState().clearCheckResult(PROJECT);
    expect(useSuperBroStore.getState().projectCheckResult.get(PROJECT)).toBeNull();
  });

  // ── addLog ────────────────────────────────────────────────────

  it("addLog adds entries to log", () => {
    useSuperBroStore.getState().addLog("trigger", "claude_response event");
    useSuperBroStore.getState().addLog("api_call", "Calling OpenAI");
    const log = useSuperBroStore.getState().log;
    expect(log.length).toBe(2);
    expect(log[0].message).toBe("Calling OpenAI");
    expect(log[1].message).toBe("claude_response event");
  });

  it("addLog caps at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      useSuperBroStore.getState().addLog("trigger", `entry ${i}`);
    }
    expect(useSuperBroStore.getState().log.length).toBe(50);
  });

  // ── 2. setMessage ─────────────────────────────────────────────────

  it("setMessage sets per-project message and adds to messageHistory", () => {
    const msg = makeMessage({ id: "msg-1" });
    useSuperBroStore.getState().setMessage(PROJECT, msg);

    const state = useSuperBroStore.getState();
    expect(state.projectMessages.get(PROJECT)).toEqual(msg);
    expect(state.messageHistory).toHaveLength(1);
    expect(state.messageHistory[0]).toEqual(msg);
  });

  it("setMessage clears thinking for that project", () => {
    useSuperBroStore.getState().setThinking(PROJECT, true);
    expect(useSuperBroStore.getState().projectThinking.get(PROJECT)).toBe(true);

    useSuperBroStore.getState().setMessage(PROJECT, makeMessage());
    expect(useSuperBroStore.getState().projectThinking.get(PROJECT)).toBe(false);
  });

  it("setMessage prepends to messageHistory (newest first)", () => {
    const msg1 = makeMessage({ id: "msg-1" });
    const msg2 = makeMessage({ id: "msg-2" });

    useSuperBroStore.getState().setMessage(PROJECT, msg1);
    useSuperBroStore.getState().setMessage(PROJECT, msg2);

    const history = useSuperBroStore.getState().messageHistory;
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("msg-2");
    expect(history[1].id).toBe("msg-1");
  });

  // ── 3. dismissMessage ─────────────────────────────────────────────

  it("dismissMessage clears per-project message", () => {
    useSuperBroStore.getState().setMessage(PROJECT, makeMessage());
    expect(useSuperBroStore.getState().projectMessages.get(PROJECT)).not.toBeNull();

    useSuperBroStore.getState().dismissMessage(PROJECT);
    expect(useSuperBroStore.getState().projectMessages.get(PROJECT)).toBeNull();
  });

  it("dismissMessage is a no-op when no message exists", () => {
    useSuperBroStore.getState().dismissMessage(PROJECT);
    expect(useSuperBroStore.getState().projectMessages.get(PROJECT)).toBeUndefined();
  });

  // ── 4. Messages are isolated per project ──────────────────────────

  it("messages are independent per project", () => {
    const msgA = makeMessage({ id: "msg-a", guidance: "For project A" });
    const msgB = makeMessage({ id: "msg-b", guidance: "For project B" });

    useSuperBroStore.getState().setMessage("/project/a", msgA);
    useSuperBroStore.getState().setMessage("/project/b", msgB);

    expect(useSuperBroStore.getState().projectMessages.get("/project/a")?.guidance).toBe("For project A");
    expect(useSuperBroStore.getState().projectMessages.get("/project/b")?.guidance).toBe("For project B");

    useSuperBroStore.getState().dismissMessage("/project/a");
    expect(useSuperBroStore.getState().projectMessages.get("/project/a")).toBeNull();
    expect(useSuperBroStore.getState().projectMessages.get("/project/b")?.guidance).toBe("For project B");
  });

  // ── 5. setThinking ────────────────────────────────────────────────

  it("setThinking sets per-project thinking flag", () => {
    useSuperBroStore.getState().setThinking(PROJECT, true);
    expect(useSuperBroStore.getState().projectThinking.get(PROJECT)).toBe(true);

    useSuperBroStore.getState().setThinking(PROJECT, false);
    expect(useSuperBroStore.getState().projectThinking.get(PROJECT)).toBe(false);
  });

  // ── 6. pause / resume ─────────────────────────────────────────────

  it("pause sets isPaused to true", () => {
    useSuperBroStore.getState().pause();
    expect(useSuperBroStore.getState().isPaused).toBe(true);
  });

  it("resume sets isPaused to false", () => {
    useSuperBroStore.getState().pause();
    expect(useSuperBroStore.getState().isPaused).toBe(true);

    useSuperBroStore.getState().resume();
    expect(useSuperBroStore.getState().isPaused).toBe(false);
  });

  // ── 7. toggle ─────────────────────────────────────────────────────

  it("toggle flips enabled state for a project", () => {
    // Default is true, first toggle should set to false
    useSuperBroStore.getState().toggle(PROJECT);
    expect(useSuperBroStore.getState().enabledProjects.get(PROJECT)).toBe(false);

    // Second toggle should set back to true
    useSuperBroStore.getState().toggle(PROJECT);
    expect(useSuperBroStore.getState().enabledProjects.get(PROJECT)).toBe(true);
  });

  it("toggle is independent per project", () => {
    const project2 = "/other/project";
    useSuperBroStore.getState().toggle(PROJECT);

    expect(useSuperBroStore.getState().enabledProjects.get(PROJECT)).toBe(false);
    expect(useSuperBroStore.getState().enabledProjects.get(project2)).toBeUndefined();
  });

  // ── 8. isEnabled ──────────────────────────────────────────────────

  it("isEnabled returns true by default for unknown projects", () => {
    expect(useSuperBroStore.getState().isEnabled(PROJECT)).toBe(true);
  });

  it("isEnabled returns false after toggle", () => {
    useSuperBroStore.getState().toggle(PROJECT);
    expect(useSuperBroStore.getState().isEnabled(PROJECT)).toBe(false);
  });

  it("isEnabled returns true after double toggle", () => {
    useSuperBroStore.getState().toggle(PROJECT);
    useSuperBroStore.getState().toggle(PROJECT);
    expect(useSuperBroStore.getState().isEnabled(PROJECT)).toBe(true);
  });

  // ── 9. addObservation ─────────────────────────────────────────────

  it("addObservation adds to project observations and calls saveObservation", () => {
    const obs = makeObservation({ id: "obs-1" });
    useSuperBroStore.getState().addObservation(PROJECT, obs);

    const observations = useSuperBroStore.getState().projectObservations.get(PROJECT);
    expect(observations).toHaveLength(1);
    expect(observations![0]).toEqual(obs);

    expect(saveObservation).toHaveBeenCalledWith(
      obs.id,
      PROJECT,
      obs.text,
      obs.category,
      obs.createdAt,
      obs.lastReferencedAt,
    );
  });

  it("addObservation prepends (newest first)", () => {
    const obs1 = makeObservation({ id: "obs-1" });
    const obs2 = makeObservation({ id: "obs-2" });
    const store = useSuperBroStore.getState();

    store.addObservation(PROJECT, obs1);
    useSuperBroStore.getState().addObservation(PROJECT, obs2);

    const observations = useSuperBroStore.getState().projectObservations.get(PROJECT)!;
    expect(observations[0].id).toBe("obs-2");
    expect(observations[1].id).toBe("obs-1");
  });

  // ── 10. addObservation caps at 50 ────────────────────────────────

  it("addObservation caps at 50 observations", () => {
    for (let i = 0; i < 55; i++) {
      useSuperBroStore
        .getState()
        .addObservation(PROJECT, makeObservation({ id: `obs-${i}` }));
    }

    const observations = useSuperBroStore.getState().projectObservations.get(PROJECT)!;
    expect(observations).toHaveLength(50);
    // Newest should be first (obs-54), oldest kept should be obs-5
    expect(observations[0].id).toBe("obs-54");
    expect(observations[49].id).toBe("obs-5");
  });

  // ── 11. getObservations ───────────────────────────────────────────

  it("getObservations returns empty array for unknown project", () => {
    expect(useSuperBroStore.getState().getObservations("/unknown")).toEqual([]);
  });

  it("getObservations returns observations for known project", () => {
    const obs = makeObservation({ id: "obs-1" });
    useSuperBroStore.getState().addObservation(PROJECT, obs);

    expect(useSuperBroStore.getState().getObservations(PROJECT)).toEqual([obs]);
  });

  // ── 12. loadObservations ──────────────────────────────────────────

  it("loadObservations loads from tauri and updates store", async () => {
    const rows = [
      {
        id: "obs-remote-1",
        projectPath: PROJECT,
        text: "Loaded from DB",
        category: "pattern",
        createdAt: "2026-01-01T00:00:00Z",
        lastReferencedAt: "2026-01-02T00:00:00Z",
      },
      {
        id: "obs-remote-2",
        projectPath: PROJECT,
        text: "Another from DB",
        category: "issue",
        createdAt: "2026-01-03T00:00:00Z",
        lastReferencedAt: "2026-01-04T00:00:00Z",
      },
    ];

    vi.mocked(loadObservations).mockResolvedValueOnce(rows);

    await useSuperBroStore.getState().loadObservations(PROJECT);

    expect(loadObservations).toHaveBeenCalledWith(PROJECT);

    const observations = useSuperBroStore.getState().projectObservations.get(PROJECT)!;
    expect(observations).toHaveLength(2);
    expect(observations[0]).toEqual({
      id: "obs-remote-1",
      text: "Loaded from DB",
      category: "pattern",
      createdAt: "2026-01-01T00:00:00Z",
      lastReferencedAt: "2026-01-02T00:00:00Z",
    });
    expect(observations[1]).toEqual({
      id: "obs-remote-2",
      text: "Another from DB",
      category: "issue",
      createdAt: "2026-01-03T00:00:00Z",
      lastReferencedAt: "2026-01-04T00:00:00Z",
    });
  });

  it("loadObservations handles errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadObservations).mockRejectedValueOnce(new Error("DB error"));

    await useSuperBroStore.getState().loadObservations(PROJECT);

    // Should not crash, observations should remain empty
    expect(useSuperBroStore.getState().projectObservations.get(PROJECT)).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to load observations:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  // ── 13. removeObservation ─────────────────────────────────────────

  it("removeObservation removes from list and calls deleteObservation", () => {
    const obs1 = makeObservation({ id: "obs-1" });
    const obs2 = makeObservation({ id: "obs-2" });
    useSuperBroStore.getState().addObservation(PROJECT, obs1);
    useSuperBroStore.getState().addObservation(PROJECT, obs2);

    useSuperBroStore.getState().removeObservation("obs-1", PROJECT);

    const observations = useSuperBroStore.getState().projectObservations.get(PROJECT)!;
    expect(observations).toHaveLength(1);
    expect(observations[0].id).toBe("obs-2");
    expect(deleteObservation).toHaveBeenCalledWith("obs-1");
  });

  it("removeObservation is safe for unknown project", () => {
    // Should not throw
    useSuperBroStore.getState().removeObservation("obs-999", "/unknown");
    expect(deleteObservation).toHaveBeenCalledWith("obs-999");
  });

  // ── 14. messageHistory caps at 20 ────────────────────────────────

  it("messageHistory caps at 20 messages", () => {
    for (let i = 0; i < 25; i++) {
      useSuperBroStore
        .getState()
        .setMessage(PROJECT, makeMessage({ id: `msg-${i}` }));
    }

    const history = useSuperBroStore.getState().messageHistory;
    expect(history).toHaveLength(20);
    // Newest should be first (msg-24), oldest kept should be msg-5
    expect(history[0].id).toBe("msg-24");
    expect(history[19].id).toBe("msg-5");
  });
});
