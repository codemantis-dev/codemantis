import { useState, useEffect } from "react";
import { FileEdit, Clock, Upload } from "lucide-react";
import type { GitStatusInfo } from "../../types/git";
import GitCommitsPopover from "./GitCommitsPopover";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface Props {
  gitStatus: GitStatusInfo;
  projectPath: string;
}

export default function GitStatusCard({ gitStatus, projectPath }: Props) {
  // Force re-render every 30s so relativeTime() re-evaluates
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!gitStatus.is_git_repo) return null;

  return (
    <div className="px-3 py-2 space-y-1">
      {/* Row 1: Branch (clickable → commits popover) + uncommitted changes */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <GitCommitsPopover
            projectPath={projectPath}
            branch={gitStatus.branch ?? "detached"}
          />
        </div>
        {gitStatus.uncommitted_changes > 0 && (
          <div className="flex items-center gap-1 shrink-0 text-yellow" title="Uncommitted changes">
            <FileEdit size={12} />
            <span className="text-label">{gitStatus.uncommitted_changes}</span>
          </div>
        )}
      </div>

      {/* Row 2: Last commit + last push */}
      <div className="flex items-center justify-between gap-2 text-text-faint">
        <div className="flex items-center gap-1" title="Last commit">
          <Clock size={11} className="shrink-0" />
          <span className="text-label">{relativeTime(gitStatus.last_commit_time)}</span>
        </div>
        <div className="flex items-center gap-1" title="Last push">
          <Upload size={11} className="shrink-0" />
          <span className="text-label">{relativeTime(gitStatus.last_push_time)}</span>
        </div>
      </div>
    </div>
  );
}
