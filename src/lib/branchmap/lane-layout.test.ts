import { describe, it, expect } from "vitest";
import { layoutBranchGraph, colX, laneY } from "./lane-layout";
import { COL_W, LANE_H, PAD_X, PAD_Y } from "./constants";
import { MAIN_COLOR, laneColor } from "./lane-palette";
import type { BranchGraph, GraphCommit, BranchRef } from "../../types/branch-graph";

function commit(partial: Partial<GraphCommit> & { hash: string }): GraphCommit {
  return {
    shortHash: partial.hash.slice(0, 7),
    parents: [],
    subject: "subject",
    author: "Tester",
    timestamp: "2026-06-01T12:00:00Z",
    refs: [],
    isHead: false,
    isMerge: false,
    lane: 0,
    ...partial,
  };
}

function graph(partial: Partial<BranchGraph> & { commits: GraphCommit[] }): BranchGraph {
  const laneCount =
    partial.laneCount ??
    (partial.commits.length === 0
      ? 0
      : Math.max(...partial.commits.map((c) => c.lane)) + 1);
  return {
    isGitRepo: true,
    head: "main",
    detached: false,
    branches: [],
    tags: [],
    truncated: false,
    laneCount,
    ...partial,
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

describe("colX / laneY", () => {
  it("places column 0 at the left gutter and steps right by COL_W", () => {
    expect(colX(0)).toBe(PAD_X);
    expect(colX(3)).toBe(PAD_X + 3 * COL_W);
  });

  it("places lane 0 at the bottom and steps up by LANE_H", () => {
    const height = 200;
    expect(laneY(0, height)).toBe(height - PAD_Y);
    expect(laneY(2, height)).toBe(height - PAD_Y - 2 * LANE_H);
  });
});

describe("layoutBranchGraph — empty", () => {
  it("produces no nodes or edges and a sane canvas", () => {
    const out = layoutBranchGraph(graph({ commits: [], laneCount: 0 }));
    expect(out.nodes).toHaveLength(0);
    expect(out.edges).toHaveLength(0);
    expect(out.lanes).toHaveLength(0);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});

describe("layoutBranchGraph — linear history", () => {
  const g = graph({
    commits: [
      commit({ hash: "c3", parents: ["c2"], isHead: true }),
      commit({ hash: "c2", parents: ["c1"] }),
      commit({ hash: "c1", parents: [] }),
    ],
  });

  it("places oldest at the left, newest at the right, all on one row", () => {
    const out = layoutBranchGraph(g);
    const c1 = out.nodes.find((n) => n.hash === "c1")!;
    const c3 = out.nodes.find((n) => n.hash === "c3")!;
    expect(c1.x).toBe(PAD_X); // oldest = leftmost column
    expect(c3.x).toBe(PAD_X + 2 * COL_W); // newest = rightmost
    expect(c1.y).toBe(c3.y); // single lane → same row
  });

  it("colors trunk nodes with the accent and marks HEAD", () => {
    const out = layoutBranchGraph(g);
    const c3 = out.nodes.find((n) => n.hash === "c3")!;
    expect(c3.colorVar).toBe(MAIN_COLOR);
    expect(c3.isHead).toBe(true);
  });

  it("draws only same-lane straight edges", () => {
    const out = layoutBranchGraph(g);
    expect(out.edges).toHaveLength(2);
    expect(out.edges.every((e) => e.kind === "same-lane")).toBe(true);
    // Straight segments use an L command, not a curve.
    expect(out.edges.every((e) => e.d.includes(" L "))).toBe(true);
  });

  it("reports a single lane", () => {
    const out = layoutBranchGraph(g);
    expect(out.lanes).toHaveLength(1);
    expect(out.lanes[0].lane).toBe(0);
  });
});

describe("layoutBranchGraph — branch off and merge", () => {
  // base ← mainprogress ← merge (lane 0); featurework on lane 1, merged in.
  const g = graph({
    commits: [
      commit({
        hash: "merge",
        parents: ["mainprogress", "featurework"],
        lane: 0,
        isMerge: true,
        isHead: true,
      }),
      commit({ hash: "mainprogress", parents: ["base"], lane: 0 }),
      commit({ hash: "featurework", parents: ["base"], lane: 1 }),
      commit({ hash: "base", parents: [], lane: 0 }),
    ],
    branches: [
      branch("main", "merge", { isCurrent: true }),
      branch("feature", "featurework", { lane: 1 }),
    ],
    laneCount: 2,
  });

  it("classifies a branch-off and a merge edge", () => {
    const out = layoutBranchGraph(g);
    const branchOff = out.edges.find((e) => e.kind === "branch-off");
    const merge = out.edges.find((e) => e.kind === "merge");
    expect(branchOff).toBeDefined();
    expect(merge).toBeDefined();
    // branch-off rises from base (trunk) to the first feature commit.
    expect(branchOff!.fromHash).toBe("base");
    expect(branchOff!.toHash).toBe("featurework");
    // merge brings the feature tip into the merge commit.
    expect(merge!.fromHash).toBe("featurework");
    expect(merge!.toHash).toBe("merge");
  });

  it("renders branch-off / merge edges as curves", () => {
    const out = layoutBranchGraph(g);
    const curved = out.edges.filter((e) => e.kind !== "same-lane");
    expect(curved.length).toBeGreaterThan(0);
    expect(curved.every((e) => e.d.includes(" C "))).toBe(true);
  });

  it("colors the merge edge with the side-branch lane color", () => {
    const out = layoutBranchGraph(g);
    const merge = out.edges.find((e) => e.kind === "merge")!;
    expect(merge.colorVar).toBe(laneColor(1));
  });

  it("allocates two lanes with distinct row heights", () => {
    const out = layoutBranchGraph(g);
    expect(out.lanes).toHaveLength(2);
    expect(out.lanes[0].y).not.toBe(out.lanes[1].y);
    expect(out.height).toBe(2 * PAD_Y + 1 * LANE_H);
  });

  it("marks branch tips from the branch list", () => {
    const out = layoutBranchGraph(g);
    expect(out.nodes.find((n) => n.hash === "merge")!.isBranchTip).toBe(true);
    expect(out.nodes.find((n) => n.hash === "featurework")!.isBranchTip).toBe(true);
    expect(out.nodes.find((n) => n.hash === "base")!.isBranchTip).toBe(false);
  });

  it("labels lane 0 with the current branch and flags it", () => {
    const out = layoutBranchGraph(g);
    const trunk = out.lanes.find((l) => l.lane === 0)!;
    expect(trunk.gitRef).toBe("main");
    expect(trunk.isCurrent).toBe(true);
    const featureLane = out.lanes.find((l) => l.lane === 1)!;
    expect(featureLane.gitRef).toBe("feature");
  });
});

describe("layoutBranchGraph — missing parent (windowed history)", () => {
  it("skips edges whose parent fell outside the window", () => {
    const g = graph({
      commits: [commit({ hash: "c2", parents: ["c1-not-loaded"] })],
    });
    const out = layoutBranchGraph(g);
    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toHaveLength(0); // parent not in window → no dangling edge
  });
});
