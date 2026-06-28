// Shown when a merge/pull is paused mid-conflict. For a vibe coder, the safe,
// always-available option is "Undo this merge" (abort). The alternative is to
// let their AI assistant resolve the listed files, then save a checkpoint.

import { AlertTriangle, Undo2, Sparkles } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import { basename } from "../../lib/branchmap/commit-format";
import type { ConflictState } from "../../types/branch-graph";

interface ConflictBannerProps {
  projectPath: string;
  conflict: ConflictState;
}

export default function ConflictBanner({ projectPath, conflict }: ConflictBannerProps) {
  const abortMerge = useGitStore((s) => s.abortMerge);
  const opInProgress = useGitStore((s) => s.opInProgress);
  const busy = opInProgress === "abort";

  if (!conflict.inProgress) return null;

  const files = conflict.conflictedFiles;

  return (
    <div
      className="px-4 py-3 border-b border-yellow/30 bg-yellow/10 shrink-0"
      data-testid="conflict-banner"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="text-yellow shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-ui font-medium text-text-primary mb-0.5">
            This merge needs a careful hand
          </div>
          <div className="text-label text-text-secondary mb-2">
            {files.length} file{files.length === 1 ? "" : "s"} changed in both places at once.
            You can undo the whole thing and try later, or ask your AI assistant to merge the
            overlapping parts, then save a checkpoint.
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {files.slice(0, 10).map((f) => (
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => abortMerge(projectPath)}
              disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-label font-medium text-white bg-yellow hover:brightness-110 transition-colors disabled:opacity-60"
            >
              <Undo2 size={12} />
              Undo this merge
            </button>
            <span className="flex items-center gap-1 text-detail text-text-ghost">
              <Sparkles size={11} />
              or ask your AI assistant to resolve the files above
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
