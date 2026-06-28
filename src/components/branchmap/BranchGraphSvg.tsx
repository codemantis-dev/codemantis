// The swim-lane branch graph canvas. Hand-rendered SVG (no graph lib): lane
// base-rails, branch-off/merge curves, commit nodes, a "you are here" HEAD pill,
// and a sticky left gutter of plain-language lane labels.
//
// Time flows left (old) → right (new); lane 0 is the trunk at the bottom, with
// branches stacked above. Colors come from CSS vars, so it recolors across all
// 7 themes for free.

import { useMemo, useState, useCallback } from "react";
import { GitBranch, ArrowRightLeft, Trash2, GitMerge } from "lucide-react";
import { layoutBranchGraph } from "../../lib/branchmap/lane-layout";
import { PAD_X, HEAD_R } from "../../lib/branchmap/constants";
import { humanizeBranchName } from "../../lib/branchmap/changelog-link";
import type { BranchGraph } from "../../types/branch-graph";
import type { ProjectChangelogEntry } from "../../types/changelog";
import CommitNode from "./CommitNode";
import CommitHoverCard from "./CommitHoverCard";

interface BranchGraphSvgProps {
  graph: BranchGraph;
  selectedHash: string | null;
  onSelectCommit: (hash: string) => void;
  /** Commit → changelog entry, for friendly node tooltips + hovercards. */
  changelogByHash?: Map<string, ProjectChangelogEntry>;
  /** Current branch name, to hide self-switch / self-delete actions. */
  currentBranch?: string | null;
  /** Lane-row actions (omit to render a read-only graph). */
  onSwitchBranch?: (name: string) => void;
  onMergeBranch?: (name: string) => void;
  onDeleteBranch?: (name: string) => void;
}

interface HoverState {
  hash: string;
  left: number;
  bottom: number;
}

export default function BranchGraphSvg({
  graph,
  selectedHash,
  onSelectCommit,
  changelogByHash,
  currentBranch,
  onSwitchBranch,
  onMergeBranch,
  onDeleteBranch,
}: BranchGraphSvgProps) {
  const layout = useMemo(() => layoutBranchGraph(graph), [graph]);
  const { nodes, edges, lanes, width, height } = layout;
  const [hover, setHover] = useState<HoverState | null>(null);

  const commitByHash = useMemo(() => {
    const m = new Map<string, BranchGraph["commits"][number]>();
    for (const c of graph.commits) m.set(c.hash, c);
    return m;
  }, [graph.commits]);

  const handleHover = useCallback((hash: string | null, el: SVGGElement | null) => {
    if (!hash || !el) {
      setHover(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setHover({
      hash,
      left: rect.left + rect.width / 2 - 130,
      bottom: window.innerHeight - rect.top + 8,
    });
  }, []);

  const headNode = nodes.find((n) => n.isHead) ?? null;
  const hoverCommit = hover ? commitByHash.get(hover.hash) : undefined;

  // Build a node title: friendly changelog headline if known, else git subject.
  const subjectByHash = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of graph.commits) m.set(c.hash, c.subject);
    return m;
  }, [graph.commits]);

  const titleFor = (hash: string): string => {
    const headline = changelogByHash?.get(hash)?.headline;
    return headline ?? subjectByHash.get(hash) ?? hash.slice(0, 7);
  };

  return (
    <div className="relative h-full w-full overflow-auto" data-testid="branch-graph-canvas">
      <div className="relative" style={{ width, height, minWidth: "100%" }}>
        <svg
          className="absolute inset-0 block"
          width={width}
          height={height}
          role="img"
          aria-label="Branch map"
        >
          {/* Layer 1 — lane base rails. */}
          {lanes.map((lane) => (
            <line
              key={`rail-${lane.lane}`}
              x1={PAD_X}
              x2={width}
              y1={lane.y}
              y2={lane.y}
              stroke={lane.colorVar}
              strokeWidth={lane.lane === 0 ? 3 : 2}
              strokeOpacity={lane.lane === 0 ? 0.85 : 0.4}
              strokeLinecap="round"
            />
          ))}

          {/* Layer 2 — connecting edges. */}
          {edges.map((edge, i) => (
            <path
              key={`edge-${edge.fromHash}-${edge.toHash}-${i}`}
              d={edge.d}
              fill="none"
              stroke={edge.colorVar}
              strokeWidth={2}
              strokeOpacity={edge.kind === "same-lane" ? 0.85 : 0.7}
              strokeLinecap="round"
            />
          ))}

          {/* Layer 3 — commit nodes. */}
          {nodes.map((node) => (
            <CommitNode
              key={node.hash}
              node={node}
              selected={node.hash === selectedHash}
              onSelect={onSelectCommit}
              onHover={handleHover}
              title={titleFor(node.hash)}
            />
          ))}
        </svg>

        {/* Layer 4 — "You are here" pill, anchored to the HEAD node. */}
        {headNode && (
          <div
            className="absolute pointer-events-none flex items-center gap-1 text-detail font-medium text-accent bg-accent/15 rounded-full px-2 py-0.5 whitespace-nowrap"
            style={{
              left: headNode.x,
              top: headNode.y - HEAD_R - 20,
              transform: "translateX(-50%)",
            }}
          >
            You are here
          </div>
        )}

        {/* Sticky left gutter — plain-language lane labels. Pins horizontally
            while the graph scrolls. */}
        <div
          className="sticky left-0 top-0 z-10"
          style={{ width: PAD_X, height, background: "var(--bg-primary)" }}
        >
          <div
            className="absolute inset-y-0 right-0 w-px"
            style={{ background: "var(--border-light)" }}
          />
          {lanes.map((lane) => {
            const isCurrent = lane.isCurrent || lane.gitRef === currentBranch;
            const canAct = !!lane.gitRef && !isCurrent;
            return (
              <div
                key={`label-${lane.lane}`}
                className="group absolute left-2 right-1 flex flex-col"
                style={{ top: lane.y - 16 }}
              >
                <div className="flex items-center gap-1 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: lane.colorVar }}
                  />
                  <span className="text-detail font-medium text-text-primary truncate">
                    {lane.lane === 0 ? "main" : humanizeBranchName(lane.gitRef)}
                  </span>
                  {isCurrent && <GitBranch size={9} className="text-accent shrink-0" />}
                </div>
                <span className="text-micro text-text-ghost font-mono truncate pl-3">
                  {lane.lane === 0 ? "the version you ship" : lane.gitRef}
                </span>
                {canAct && (onSwitchBranch || onMergeBranch || onDeleteBranch) && (
                  <div className="flex items-center gap-1 mt-0.5 pl-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onSwitchBranch && (
                      <button
                        onClick={() => onSwitchBranch(lane.gitRef)}
                        title={`Switch to this (checkout ${lane.gitRef})`}
                        className="flex items-center gap-0.5 text-micro text-text-dim hover:text-accent transition-colors"
                      >
                        <ArrowRightLeft size={8} />
                        Switch
                      </button>
                    )}
                    {onMergeBranch && lane.lane !== 0 && (
                      <button
                        onClick={() => onMergeBranch(lane.gitRef)}
                        title={`Make it official (merge ${lane.gitRef} into the current branch)`}
                        className="flex items-center gap-0.5 text-micro text-text-dim hover:text-green transition-colors"
                      >
                        <GitMerge size={8} />
                        Make official
                      </button>
                    )}
                    {onDeleteBranch && (
                      <button
                        onClick={() => onDeleteBranch(lane.gitRef)}
                        title={`Delete this space (delete ${lane.gitRef})`}
                        className="flex items-center gap-0.5 text-micro text-text-dim hover:text-red transition-colors"
                      >
                        <Trash2 size={8} />
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {hover && hoverCommit && (
        <CommitHoverCard
          commit={hoverCommit}
          entry={changelogByHash?.get(hover.hash)}
          left={hover.left}
          bottom={hover.bottom}
        />
      )}
    </div>
  );
}
