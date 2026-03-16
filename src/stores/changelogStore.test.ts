import { describe, it, expect, beforeEach, vi } from "vitest";
import { useChangelogStore } from "./changelogStore";
import { useSessionStore } from "./sessionStore";
import type { ChangelogEntry } from "../types/changelog";
import type { Session } from "../types/session";

vi.mock("../lib/tauri-commands", () => ({
  getProjectChangelogEntries: vi.fn().mockResolvedValue([]),
}));

const TEST_SESSION: Session = {
  id: "s1",
  name: "Test Session",
  project_path: "/tmp/test-project",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: "sonnet",
  icon_index: 0,
};

function makeEntry(id: string, sessionId: string = "s1"): ChangelogEntry {
  return {
    id,
    session_id: sessionId,
    timestamp: "2026-01-01T00:00:00Z",
    headline: `Entry ${id}`,
    description: "Test description",
    category: "feature",
    files_changed: ["file.ts"],
    turn_index: 1,
    technical_details: "",
    tools_summary: "",
  };
}

function resetStores(): void {
  useChangelogStore.setState({
    sessionEntries: new Map(),
    generating: new Map(),
    projectEntries: new Map(),
  });
  useSessionStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    activeSubAgents: new Map(),
    tabOrder: [],
  });
}

describe("changelogStore", () => {
  beforeEach(resetStores);

  it("starts with empty maps", () => {
    const state = useChangelogStore.getState();
    expect(state.sessionEntries.size).toBe(0);
    expect(state.generating.size).toBe(0);
    expect(state.projectEntries.size).toBe(0);
  });

  it("addEntry adds to session entries", () => {
    const entry = makeEntry("e1");
    useChangelogStore.getState().addEntry("s1", entry);

    const entries = useChangelogStore.getState().sessionEntries.get("s1");
    expect(entries).toHaveLength(1);
    expect(entries![0].id).toBe("e1");
  });

  it("addEntry also adds to projectEntries if loaded for that project", () => {
    // Set up session in sessionStore so changelogStore can find project_path
    useSessionStore.getState().addSession(TEST_SESSION);

    // Pre-load project entries (simulates loadProjectEntries having run)
    useChangelogStore.setState({
      projectEntries: new Map([["/tmp/test-project", []]]),
    });

    const entry = makeEntry("e1");
    useChangelogStore.getState().addEntry("s1", entry);

    const projectEntries = useChangelogStore.getState().projectEntries.get("/tmp/test-project");
    expect(projectEntries).toHaveLength(1);
    expect(projectEntries![0].id).toBe("e1");
    expect(projectEntries![0].session_name).toBe("Test Session");
  });

  it("removeEntry removes from session entries", () => {
    const e1 = makeEntry("e1");
    const e2 = makeEntry("e2");
    useChangelogStore.getState().addEntry("s1", e1);
    useChangelogStore.getState().addEntry("s1", e2);

    useChangelogStore.getState().removeEntry("s1", "e1");

    const entries = useChangelogStore.getState().sessionEntries.get("s1");
    expect(entries).toHaveLength(1);
    expect(entries![0].id).toBe("e2");
  });

  it("removeEntry also removes from projectEntries if loaded", () => {
    useSessionStore.getState().addSession(TEST_SESSION);
    useChangelogStore.setState({
      projectEntries: new Map([["/tmp/test-project", []]]),
    });

    const entry = makeEntry("e1");
    useChangelogStore.getState().addEntry("s1", entry);
    useChangelogStore.getState().removeEntry("s1", "e1");

    const projectEntries = useChangelogStore.getState().projectEntries.get("/tmp/test-project");
    expect(projectEntries).toHaveLength(0);
  });

  it("setEntries replaces entries for session", () => {
    const e1 = makeEntry("e1");
    useChangelogStore.getState().addEntry("s1", e1);

    const e2 = makeEntry("e2");
    const e3 = makeEntry("e3");
    useChangelogStore.getState().setEntries("s1", [e2, e3]);

    const entries = useChangelogStore.getState().sessionEntries.get("s1");
    expect(entries).toHaveLength(2);
    expect(entries!.map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("setGenerating sets and gets generating state", () => {
    useChangelogStore.getState().setGenerating("s1", true);
    expect(useChangelogStore.getState().generating.get("s1")).toBe(true);

    useChangelogStore.getState().setGenerating("s1", false);
    expect(useChangelogStore.getState().generating.get("s1")).toBe(false);
  });

  it("clearSession removes entries and generating state", () => {
    useChangelogStore.getState().addEntry("s1", makeEntry("e1"));
    useChangelogStore.getState().setGenerating("s1", true);

    useChangelogStore.getState().clearSession("s1");

    expect(useChangelogStore.getState().sessionEntries.has("s1")).toBe(false);
    expect(useChangelogStore.getState().generating.has("s1")).toBe(false);
  });
});
