import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CommitDetailRail from "./CommitDetailRail";
import type { BranchGraph, GraphCommit } from "../../types/branch-graph";
import type { ProjectChangelogEntry } from "../../types/changelog";

function commit(p: Partial<GraphCommit> & { hash: string }): GraphCommit {
  return {
    shortHash: p.hash.slice(0, 7),
    parents: [],
    subject: `subject ${p.hash}`,
    author: "Tester",
    timestamp: "2026-06-01T12:00:00Z",
    refs: [],
    isHead: false,
    isMerge: false,
    lane: 0,
    ...p,
  };
}

const graph: BranchGraph = {
  isGitRepo: true,
  head: "main",
  detached: false,
  commits: [
    commit({ hash: "c2", parents: ["c1"], isHead: true }),
    commit({ hash: "c1", parents: [] }),
  ],
  branches: [],
  tags: [],
  truncated: false,
  laneCount: 1,
};

const entry: ProjectChangelogEntry = {
  id: "e1",
  session_id: "s",
  session_name: "Login session",
  timestamp: "2026-06-01T12:00:00Z",
  headline: "Added Google sign-in",
  description: "Wired OAuth",
  category: "feature",
  files_changed: ["src/auth/google.ts"],
  turn_index: 0,
  technical_details: "",
  tools_summary: "",
};

describe("CommitDetailRail", () => {
  it("prompts to pick a commit when nothing is selected", () => {
    render(<CommitDetailRail graph={graph} selectedHash={null} onSelectCommit={() => {}} />);
    expect(screen.getByText(/Click a dot to see what changed/i)).toBeInTheDocument();
  });

  it("shows the friendly changelog headline + files for a selected commit", () => {
    render(
      <CommitDetailRail
        graph={graph}
        selectedHash="c2"
        onSelectCommit={() => {}}
        changelogByHash={new Map([["c2", entry]])}
      />,
    );
    // Headline shows in both the detail card and the selected commit's rail row.
    expect(screen.getAllByText("Added Google sign-in").length).toBeGreaterThan(0);
    expect(screen.getByText("Login session")).toBeInTheDocument();
    expect(screen.getByText("google.ts")).toBeInTheDocument(); // basename chip
  });

  it("falls back to the raw git subject when there's no changelog entry", () => {
    render(<CommitDetailRail graph={graph} selectedHash="c1" onSelectCommit={() => {}} />);
    expect(screen.getAllByText("subject c1").length).toBeGreaterThan(0);
  });

  it("lists the lane's checkpoints and selects on click", () => {
    const onSelect = vi.fn();
    render(<CommitDetailRail graph={graph} selectedHash="c2" onSelectCommit={onSelect} />);
    expect(screen.getByText(/This branch's checkpoints/i)).toBeInTheDocument();
    // Clicking the older commit's row selects it.
    fireEvent.click(screen.getByText("subject c1"));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });
});
