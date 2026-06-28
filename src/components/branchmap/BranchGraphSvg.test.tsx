import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BranchGraphSvg from "./BranchGraphSvg";
import type { BranchGraph, GraphCommit, BranchRef } from "../../types/branch-graph";
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

const branch = (name: string, tip: string, extra: Partial<BranchRef> = {}): BranchRef => ({
  name,
  isCurrent: false,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip,
  lane: 0,
  ...extra,
});

function mergeGraph(): BranchGraph {
  return {
    isGitRepo: true,
    head: "main",
    detached: false,
    commits: [
      commit({ hash: "merge", parents: ["mainprogress", "featurework"], lane: 0, isMerge: true, isHead: true }),
      commit({ hash: "mainprogress", parents: ["base"], lane: 0 }),
      commit({ hash: "featurework", parents: ["base"], lane: 1 }),
      commit({ hash: "base", parents: [], lane: 0 }),
    ],
    branches: [
      branch("main", "merge", { isCurrent: true }),
      branch("feature/login-redesign", "featurework", { lane: 1 }),
    ],
    tags: [],
    truncated: false,
    laneCount: 2,
  };
}

describe("BranchGraphSvg", () => {
  it("renders the canvas with a node per commit", () => {
    const { container } = render(
      <BranchGraphSvg graph={mergeGraph()} selectedHash={null} onSelectCommit={() => {}} />,
    );
    expect(screen.getByTestId("branch-graph-canvas")).toBeInTheDocument();
    // Each commit is an SVG <g> with a <title>.
    const titles = container.querySelectorAll("svg title");
    expect(titles.length).toBe(4);
  });

  it("shows the 'You are here' HEAD marker", () => {
    render(<BranchGraphSvg graph={mergeGraph()} selectedHash={null} onSelectCommit={() => {}} />);
    expect(screen.getByText("You are here")).toBeInTheDocument();
  });

  it("labels the trunk lane with the friendly 'main = the version you ship' framing", () => {
    render(<BranchGraphSvg graph={mergeGraph()} selectedHash={null} onSelectCommit={() => {}} />);
    expect(screen.getByText("the version you ship")).toBeInTheDocument();
    // Feature lane is humanized.
    expect(screen.getByText("Login redesign")).toBeInTheDocument();
    // …with the raw git ref shown as the secondary subtitle.
    expect(screen.getByText("feature/login-redesign")).toBeInTheDocument();
  });

  it("calls onSelectCommit when a node is clicked", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <BranchGraphSvg graph={mergeGraph()} selectedHash={null} onSelectCommit={onSelect} />,
    );
    const firstGroup = container.querySelector("svg g");
    expect(firstGroup).toBeTruthy();
    fireEvent.click(firstGroup!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("prefers a changelog headline for the node tooltip when available", () => {
    const changelog = new Map<string, ProjectChangelogEntry>([
      [
        "merge",
        {
          id: "e1",
          session_id: "s",
          session_name: "Login",
          timestamp: "2026-06-01T12:00:00Z",
          headline: "Added Google sign-in",
          description: "",
          category: "feature",
          files_changed: [],
          turn_index: 0,
          technical_details: "",
          tools_summary: "",
        },
      ],
    ]);
    const { container } = render(
      <BranchGraphSvg
        graph={mergeGraph()}
        selectedHash={null}
        onSelectCommit={() => {}}
        changelogByHash={changelog}
      />,
    );
    const titles = Array.from(container.querySelectorAll("svg title")).map((t) => t.textContent);
    expect(titles).toContain("Added Google sign-in");
    // A commit without a changelog entry falls back to the raw git subject.
    expect(titles).toContain("subject base");
  });
});
