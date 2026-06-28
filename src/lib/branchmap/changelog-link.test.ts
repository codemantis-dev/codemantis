import { describe, it, expect } from "vitest";
import { linkCommitsToChangelog, humanizeBranchName } from "./changelog-link";
import type { GraphCommit } from "../../types/branch-graph";
import type { ProjectChangelogEntry } from "../../types/changelog";

function commit(hash: string, timestamp: string): GraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    subject: "raw git message",
    author: "Tester",
    timestamp,
    refs: [],
    isHead: false,
    isMerge: false,
    lane: 0,
  };
}

function entry(id: string, timestamp: string, headline: string): ProjectChangelogEntry {
  return {
    id,
    session_id: "s1",
    session_name: "Login session",
    timestamp,
    headline,
    description: "",
    category: "feature",
    files_changed: [],
    turn_index: 0,
    technical_details: "",
    tools_summary: "",
  };
}

describe("linkCommitsToChangelog", () => {
  it("matches a commit to the nearest in-window entry", () => {
    const commits = [commit("abc", "2026-06-01T12:00:30Z")];
    const entries = [
      entry("e1", "2026-06-01T12:00:00Z", "Added sign-in"),
      entry("e2", "2026-06-01T13:00:00Z", "Unrelated later work"),
    ];
    const map = linkCommitsToChangelog(commits, entries);
    expect(map.get("abc")?.id).toBe("e1");
  });

  it("ignores entries outside the window", () => {
    const commits = [commit("abc", "2026-06-01T12:00:00Z")];
    const entries = [entry("e1", "2026-06-01T14:00:00Z", "Way later")];
    const map = linkCommitsToChangelog(commits, entries);
    expect(map.has("abc")).toBe(false);
  });

  it("returns an empty map when there are no entries", () => {
    const map = linkCommitsToChangelog([commit("abc", "2026-06-01T12:00:00Z")], []);
    expect(map.size).toBe(0);
  });

  it("skips commits with unparseable timestamps", () => {
    const commits = [commit("abc", "not-a-date")];
    const entries = [entry("e1", "2026-06-01T12:00:00Z", "x")];
    expect(linkCommitsToChangelog(commits, entries).size).toBe(0);
  });

  it("respects a custom window", () => {
    const commits = [commit("abc", "2026-06-01T12:10:00Z")];
    const entries = [entry("e1", "2026-06-01T12:00:00Z", "x")];
    // 10 min apart: out of a 5-min window, in for 15 min.
    expect(linkCommitsToChangelog(commits, entries, 5 * 60 * 1000).has("abc")).toBe(false);
    expect(linkCommitsToChangelog(commits, entries, 15 * 60 * 1000).has("abc")).toBe(true);
  });
});

describe("humanizeBranchName", () => {
  it("strips a type prefix and title-cases", () => {
    expect(humanizeBranchName("feature/login-redesign")).toBe("Login redesign");
    expect(humanizeBranchName("fix/broken_redirect")).toBe("Broken redirect");
  });

  it("leaves a plain name readable", () => {
    expect(humanizeBranchName("main")).toBe("Main");
  });

  it("returns the input unchanged when empty", () => {
    expect(humanizeBranchName("")).toBe("");
  });
});
