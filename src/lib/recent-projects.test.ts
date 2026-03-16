import { describe, it, expect, beforeEach } from "vitest";
import { getRecentProjects, addRecentProject } from "./recent-projects";

const CURRENT_KEY = "codemantis-recent-projects";
const LEGACY_KEY = "claudeforge-recent-projects";

describe("recent-projects", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getRecentProjects returns [] when nothing stored", () => {
    expect(getRecentProjects()).toEqual([]);
  });

  it("addRecentProject stores and retrieves a project", () => {
    addRecentProject("/path/to/project");
    expect(getRecentProjects()).toEqual(["/path/to/project"]);
  });

  it("addRecentProject deduplicates (moves existing to front)", () => {
    addRecentProject("/a");
    addRecentProject("/b");
    addRecentProject("/a");
    expect(getRecentProjects()).toEqual(["/a", "/b"]);
  });

  it("addRecentProject caps at MAX_RECENT=5", () => {
    for (let i = 0; i < 7; i++) {
      addRecentProject(`/project-${i}`);
    }
    const result = getRecentProjects();
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("/project-6");
    expect(result[4]).toBe("/project-2");
  });

  it("migration: reads from legacy key if current key missing", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(["/legacy/path"]));
    expect(getRecentProjects()).toEqual(["/legacy/path"]);
  });

  it("migration: removes legacy key after migration", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(["/legacy/path"]));
    getRecentProjects();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("migration: doesn't affect existing current key data", () => {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(["/current/path"]));
    localStorage.setItem(LEGACY_KEY, JSON.stringify(["/legacy/path"]));
    expect(getRecentProjects()).toEqual(["/current/path"]);
    // Legacy key should remain untouched since current key exists
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("handles corrupt JSON gracefully (returns [])", () => {
    localStorage.setItem(CURRENT_KEY, "not-valid-json{{{");
    expect(getRecentProjects()).toEqual([]);
  });
});
