import { beforeEach, describe, expect, it } from "vitest";

import type { RecallHealth, RecallEnrichmentRow } from "../types/recall";
import { useRecallStore } from "./recallStore";

const PROJECT = "/tmp/test-project";

function reset() {
  useRecallStore.setState({
    byProject: new Map(),
    loadingByProject: new Map(),
    notesForPaths: new Map(),
  });
}

function fakeHealth(): RecallHealth {
  return {
    noteCount: 7,
    noteCountsByType: [
      ["landmine", 3],
      ["decision", 2],
      ["pattern", 2],
    ],
    harvestsTotal: 12,
    lastIndexedAt: "2026-06-01T12:00:00Z",
    vaultPath: "/tmp/test-project/.recall",
  };
}

function fakeEnrichment(occurredAt: string): RecallEnrichmentRow {
  return {
    occurredAt,
    promptSummary: "fix the credentials helper",
    notesInjectedJson: '["pgcrypto-landmine"]',
    briefTokens: 412,
    modelUsed: "gemini-3.1-flash-lite",
    costUsd: 0.0001,
  };
}

describe("recallStore", () => {
  beforeEach(reset);

  it("setProject seeds a new per-project entry with fetchedAt", () => {
    useRecallStore.getState().setProject(PROJECT, { health: fakeHealth() });
    const s = useRecallStore.getState().byProject.get(PROJECT)!;
    expect(s.health?.noteCount).toBe(7);
    expect(s.enrichments).toEqual([]);
    expect(s.harvests).toEqual([]);
    expect(s.fetchedAt).toBeGreaterThan(0);
  });

  it("setProject merges into an existing entry without overwriting unrelated fields", () => {
    const store = useRecallStore.getState();
    store.setProject(PROJECT, { health: fakeHealth() });
    store.setProject(PROJECT, { enrichments: [fakeEnrichment("2026-06-01T12:00:00Z")] });
    const s = useRecallStore.getState().byProject.get(PROJECT)!;
    expect(s.health?.noteCount).toBe(7);
    expect(s.enrichments).toHaveLength(1);
  });

  it("setProject scopes state per project_path", () => {
    const store = useRecallStore.getState();
    store.setProject(PROJECT, { health: fakeHealth() });
    store.setProject("/other-project", {
      health: { ...fakeHealth(), noteCount: 2 },
    });
    const all = useRecallStore.getState().byProject;
    expect(all.get(PROJECT)?.health?.noteCount).toBe(7);
    expect(all.get("/other-project")?.health?.noteCount).toBe(2);
  });

  it("setLoading toggles per-project loading flag", () => {
    const store = useRecallStore.getState();
    store.setLoading(PROJECT, true);
    expect(useRecallStore.getState().loadingByProject.get(PROJECT)).toBe(true);
    store.setLoading(PROJECT, false);
    expect(useRecallStore.getState().loadingByProject.get(PROJECT)).toBeUndefined();
  });

  it("setNotesForPaths replaces the cached list for the project", () => {
    const store = useRecallStore.getState();
    store.setNotesForPaths(PROJECT, [
      {
        rowId: 1,
        vaultId: 1,
        noteId: "x",
        noteType: "landmine",
        title: "x",
        status: "active",
        trust: "high",
        severity: null,
        filePath: "notes/landmines/x.md",
      },
    ]);
    expect(useRecallStore.getState().notesForPaths.get(PROJECT)).toHaveLength(1);

    store.setNotesForPaths(PROJECT, []);
    expect(useRecallStore.getState().notesForPaths.get(PROJECT)).toEqual([]);
  });

  it("clearProject removes all per-project entries", () => {
    const store = useRecallStore.getState();
    store.setProject(PROJECT, { health: fakeHealth() });
    store.setLoading(PROJECT, true);
    store.setNotesForPaths(PROJECT, []);
    store.clearProject(PROJECT);
    const s = useRecallStore.getState();
    expect(s.byProject.has(PROJECT)).toBe(false);
    expect(s.loadingByProject.has(PROJECT)).toBe(false);
    expect(s.notesForPaths.has(PROJECT)).toBe(false);
  });

  it("clearProject only removes the targeted project", () => {
    const store = useRecallStore.getState();
    store.setProject(PROJECT, { health: fakeHealth() });
    store.setProject("/other", { health: fakeHealth() });
    store.clearProject(PROJECT);
    const s = useRecallStore.getState();
    expect(s.byProject.has(PROJECT)).toBe(false);
    expect(s.byProject.has("/other")).toBe(true);
  });
});
