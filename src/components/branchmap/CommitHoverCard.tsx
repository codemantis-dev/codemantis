// Floating hovercard shown over a commit node, via Portal (the GitCommitsPopover
// pattern). Leads with the plain-language Project Log headline when we have one,
// falling back to the raw git message.

import Portal from "../shared/Portal";
import { CATEGORY_CONFIG } from "../../lib/changelog-utils";
import { relativeTime, basename } from "../../lib/branchmap/commit-format";
import type { GraphCommit } from "../../types/branch-graph";
import type { ProjectChangelogEntry } from "../../types/changelog";

interface CommitHoverCardProps {
  commit: GraphCommit;
  entry?: ProjectChangelogEntry;
  /** Viewport position (anchored above the node). */
  left: number;
  bottom: number;
}

export default function CommitHoverCard({ commit, entry, left, bottom }: CommitHoverCardProps) {
  const config = entry ? CATEGORY_CONFIG[entry.category] ?? CATEGORY_CONFIG.feature : null;
  const Icon = config?.icon;

  return (
    <Portal>
      <div
        className="fixed w-[260px] rounded-lg border border-border p-2.5 shadow-xl z-50 pointer-events-none"
        style={{ background: "var(--bg-primary)", left, bottom }}
        data-testid="commit-hovercard"
      >
        {entry && config ? (
          <>
            <div className="flex items-center gap-1.5 mb-1">
              {Icon && <Icon size={12} className={config.color} />}
              <span className={`text-detail font-medium ${config.color}`}>{config.label}</span>
              <span className="text-detail font-medium text-accent bg-accent-dim rounded px-1 py-px">
                {entry.session_name}
              </span>
            </div>
            <div className="text-ui text-text-primary font-medium leading-tight mb-1">
              {entry.headline}
            </div>
          </>
        ) : (
          <div className="text-ui text-text-primary font-medium leading-tight mb-1">
            {commit.subject}
          </div>
        )}

        <div className="flex items-center gap-2 text-text-faint">
          {entry && entry.files_changed.length > 0 && (
            <span className="text-detail">
              {entry.files_changed.length} file{entry.files_changed.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="text-detail">{relativeTime(commit.timestamp)}</span>
          <span className="text-detail font-mono" style={{ color: "var(--accent)" }}>
            {commit.shortHash}
          </span>
        </div>

        {!entry && commit.refs.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {commit.refs.slice(0, 3).map((r) => (
              <span
                key={r}
                className="text-detail font-mono text-text-ghost bg-bg-elevated rounded px-1 py-px"
              >
                {basename(r)}
              </span>
            ))}
          </div>
        )}
      </div>
    </Portal>
  );
}
