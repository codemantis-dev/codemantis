// Right-hand detail rail for the Branch Map. The top card mirrors ProjectLogCard
// (plain-language headline + category + files); below it, the selected commit's
// lane history renders as a vertical StatusDot rail — the ActivityFeed metaphor,
// so the rail reads as a sibling of the rest of the app.

import { Waypoints } from "lucide-react";
import { CATEGORY_CONFIG } from "../../lib/changelog-utils";
import { laneColor } from "../../lib/branchmap/lane-palette";
import { relativeTime, basename } from "../../lib/branchmap/commit-format";
import type { BranchGraph, GraphCommit } from "../../types/branch-graph";
import type { ProjectChangelogEntry } from "../../types/changelog";

interface CommitDetailRailProps {
  graph: BranchGraph;
  selectedHash: string | null;
  onSelectCommit: (hash: string) => void;
  changelogByHash?: Map<string, ProjectChangelogEntry>;
}

export default function CommitDetailRail({
  graph,
  selectedHash,
  onSelectCommit,
  changelogByHash,
}: CommitDetailRailProps) {
  const selected = selectedHash
    ? graph.commits.find((c) => c.hash === selectedHash) ?? null
    : null;

  if (!selected) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center text-text-ghost">
        <Waypoints size={22} className="mb-2" />
        <p className="text-label text-text-faint">Click a dot to see what changed.</p>
      </div>
    );
  }

  const entry = changelogByHash?.get(selected.hash);
  const config = entry ? CATEGORY_CONFIG[entry.category] ?? CATEGORY_CONFIG.feature : null;
  const Icon = config?.icon;

  // Commits on the same lane, newest-first (the branch's own history).
  const laneCommits = graph.commits.filter((c) => c.lane === selected.lane);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Selected commit card */}
      <div className="px-3 py-3 border-b border-border-light shrink-0">
        {entry && config ? (
          <>
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              {Icon && <Icon size={12} className={config.color} />}
              <span className={`text-detail font-medium ${config.color}`}>{config.label}</span>
              <span className="text-detail font-medium text-accent bg-accent-dim rounded px-1 py-px">
                {entry.session_name}
              </span>
            </div>
            <div className="text-ui text-text-primary font-medium leading-tight mb-1">
              {entry.headline}
            </div>
            {entry.description && (
              <div className="text-label text-text-secondary leading-snug mb-1.5">
                {entry.description}
              </div>
            )}
            {entry.files_changed.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {entry.files_changed.slice(0, 8).map((f) => (
                  <span
                    key={f}
                    className="text-detail font-mono text-text-ghost bg-bg-elevated rounded px-1 py-px"
                    title={f}
                  >
                    {basename(f)}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-ui text-text-primary font-medium leading-tight">
            {selected.subject}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5 text-text-faint">
          <span className="text-detail">{selected.author}</span>
          <span className="text-detail">{relativeTime(selected.timestamp)}</span>
          <span className="text-detail font-mono" style={{ color: "var(--accent)" }}>
            {selected.shortHash}
          </span>
        </div>
      </div>

      {/* Lane history — vertical StatusDot rail */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="text-detail text-text-ghost uppercase tracking-wide mb-1.5">
          This branch's checkpoints
        </div>
        {laneCommits.map((c, i) => (
          <LaneRow
            key={c.hash}
            commit={c}
            entry={changelogByHash?.get(c.hash)}
            isLast={i === laneCommits.length - 1}
            selected={c.hash === selectedHash}
            onSelect={onSelectCommit}
          />
        ))}
      </div>
    </div>
  );
}

function LaneRow({
  commit,
  entry,
  isLast,
  selected,
  onSelect,
}: {
  commit: GraphCommit;
  entry?: ProjectChangelogEntry;
  isLast: boolean;
  selected: boolean;
  onSelect: (hash: string) => void;
}) {
  const color = laneColor(commit.lane);
  const label = entry?.headline ?? commit.subject;
  return (
    <button
      type="button"
      onClick={() => onSelect(commit.hash)}
      className={`flex gap-2 w-full text-left rounded -mx-1 px-1 py-0.5 transition-colors ${
        selected ? "bg-bg-elevated" : "hover:bg-bg-subtle"
      }`}
    >
      {/* Dot + connector */}
      <div className="flex flex-col items-center pt-1.5 w-3 shrink-0">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: commit.isHead ? color : "var(--bg-primary)", border: `2px solid ${color}` }}
        />
        {!isLast && <div className="w-px flex-1 mt-0.5" style={{ background: "var(--border-light)" }} />}
      </div>
      <div className="flex-1 min-w-0 pb-1">
        <div className="text-label text-text-secondary truncate">{label}</div>
        <div className="flex items-center gap-1.5 text-text-faint">
          <span className="text-detail font-mono" style={{ color: "var(--accent)" }}>
            {commit.shortHash}
          </span>
          <span className="text-detail">{relativeTime(commit.timestamp)}</span>
        </div>
      </div>
    </button>
  );
}
