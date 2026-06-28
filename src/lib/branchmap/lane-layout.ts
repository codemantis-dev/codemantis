// Pure layout for the Branch Map swim-lane graph.
//
// Takes the backend `BranchGraph` (commits newest-first, each carrying a
// Rust-computed `lane` index) and produces render-ready pixel geometry: node
// positions, SVG edge `d` strings, and per-lane label rows. No DOM, no React —
// this is the primary unit-test surface (SVG correctness is verified here).
//
// Coordinate model: time flows left (old) → right (new); lane 0 is the trunk,
// rendered at the BOTTOM, with branches stacked above it.

import type { BranchGraph } from "../../types/branch-graph";
import { COL_W, LANE_H, PAD_X, PAD_Y } from "./constants";
import { laneColor } from "./lane-palette";

export type EdgeKind = "same-lane" | "branch-off" | "merge";

export interface LaidOutNode {
  hash: string;
  shortHash: string;
  x: number;
  y: number;
  lane: number;
  colorVar: string;
  isHead: boolean;
  isMerge: boolean;
  /** A branch points at this commit. */
  isBranchTip: boolean;
}

export interface LaidOutEdge {
  /** Parent (older) commit hash. */
  fromHash: string;
  /** Child (newer) commit hash. */
  toHash: string;
  kind: EdgeKind;
  /** SVG path `d` string. */
  d: string;
  colorVar: string;
}

export interface LaidOutLane {
  lane: number;
  /** Raw git branch name for this lane (component humanizes it). */
  gitRef: string;
  isCurrent: boolean;
  colorVar: string;
  /** Y pixel of the lane's horizontal rail. */
  y: number;
}

export interface LaidOutGraph {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  lanes: LaidOutLane[];
  width: number;
  height: number;
}

/** X pixel for a column index (0 = leftmost / oldest). */
export function colX(colIndex: number): number {
  return PAD_X + colIndex * COL_W;
}

/** Y pixel for a lane index (0 = trunk at the bottom). */
export function laneY(lane: number, height: number): number {
  return height - PAD_Y - lane * LANE_H;
}

/** Smooth S-curve from a parent point to a child point (parent is to the left). */
function curvePath(px: number, py: number, cx: number, cy: number): string {
  const c1x = px + COL_W / 2;
  const c2x = cx - COL_W / 2;
  return `M ${px} ${py} C ${c1x} ${py}, ${c2x} ${cy}, ${cx} ${cy}`;
}

/** Straight horizontal segment along a lane. */
function straightPath(px: number, py: number, cx: number): string {
  return `M ${px} ${py} L ${cx} ${py}`;
}

export function layoutBranchGraph(graph: BranchGraph): LaidOutGraph {
  const n = graph.commits.length;
  const laneCount = Math.max(graph.laneCount, n > 0 ? 1 : 0);

  const height = 2 * PAD_Y + Math.max(laneCount - 1, 0) * LANE_H;
  const width = PAD_X + Math.max(n, 1) * COL_W;

  const branchTips = new Set(graph.branches.map((b) => b.tip));

  // Build nodes. The array is newest-first, so the newest commit (index 0)
  // gets the rightmost column.
  const nodes: LaidOutNode[] = graph.commits.map((c, i) => {
    const colIndex = n - 1 - i;
    return {
      hash: c.hash,
      shortHash: c.shortHash,
      x: colX(colIndex),
      y: laneY(c.lane, height),
      lane: c.lane,
      colorVar: laneColor(c.lane),
      isHead: c.isHead,
      isMerge: c.isMerge,
      isBranchTip: branchTips.has(c.hash),
    };
  });

  const nodeByHash = new Map(nodes.map((node) => [node.hash, node]));

  // Build edges: one per (child, parent) pair where both ends are in-window.
  const edges: LaidOutEdge[] = [];
  for (let i = 0; i < graph.commits.length; i++) {
    const commit = graph.commits[i];
    const child = nodeByHash.get(commit.hash);
    if (!child) continue;
    commit.parents.forEach((parentHash, parentIndex) => {
      const parent = nodeByHash.get(parentHash);
      if (!parent) return; // parent fell outside the window
      if (parent.lane === child.lane) {
        edges.push({
          fromHash: parent.hash,
          toHash: child.hash,
          kind: "same-lane",
          d: straightPath(parent.x, parent.y, child.x),
          colorVar: laneColor(child.lane),
        });
      } else if (parentIndex === 0) {
        // The lane's own first-parent lands on another lane = a branch origin.
        edges.push({
          fromHash: parent.hash,
          toHash: child.hash,
          kind: "branch-off",
          d: curvePath(parent.x, parent.y, child.x, child.y),
          colorVar: laneColor(child.lane),
        });
      } else {
        // A secondary parent of a merge = a side branch flowing in.
        edges.push({
          fromHash: parent.hash,
          toHash: child.hash,
          kind: "merge",
          d: curvePath(parent.x, parent.y, child.x, child.y),
          colorVar: laneColor(parent.lane),
        });
      }
    });
  }

  // Build lane label rows. Prefer the current local branch on a lane, then any
  // local branch, then a remote, then a ref decoration on the lane's tip.
  const lanes: LaidOutLane[] = [];
  for (let lane = 0; lane < laneCount; lane++) {
    const onLane = graph.branches.filter((b) => b.lane === lane);
    const local = onLane.filter((b) => !b.isRemote);
    const pick =
      local.find((b) => b.isCurrent) ?? local[0] ?? onLane[0] ?? null;
    let gitRef = pick?.name ?? "";
    if (!gitRef) {
      // Fall back to a ref decoration from a commit on this lane.
      const commitOnLane = graph.commits.find((c) => c.lane === lane && c.refs.length > 0);
      gitRef = commitOnLane?.refs[0] ?? (lane === 0 ? "main" : `branch ${lane}`);
    }
    lanes.push({
      lane,
      gitRef,
      isCurrent: pick?.isCurrent ?? false,
      colorVar: laneColor(lane),
      y: laneY(lane, height),
    });
  }

  return { nodes, edges, lanes, width, height };
}
