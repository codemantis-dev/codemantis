import { useState, useEffect } from "react";
import { GitBranch } from "lucide-react";
import type { GitCommit } from "../../types/git";
import { getGitLog } from "../../lib/tauri-commands";
import { useClickOutside } from "../../hooks/useClickOutside";

function relativeTime(iso: string): string {
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
  projectPath: string;
  branch: string;
}

export default function GitCommitsPopover({ projectPath, branch }: Props) {
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const popoverRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getGitLog(projectPath, 10)
      .then(setCommits)
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, [open, projectPath]);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 min-w-0 rounded px-1 -mx-1 hover:bg-bg-elevated transition-colors"
        title="Recent commits"
      >
        <GitBranch size={13} style={{ color: "var(--accent)" }} className="shrink-0" />
        <span className="text-label font-medium truncate text-text-primary">
          {branch}
        </span>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1.5 w-[280px] rounded-lg border border-border p-3 shadow-xl z-50"
          style={{ background: "var(--bg-primary)" }}
        >
          <div className="text-ui font-medium text-text-primary mb-2">Recent Commits</div>

          {loading && (
            <div className="text-label text-text-faint py-2">Loading...</div>
          )}

          {!loading && commits.length === 0 && (
            <div className="text-label text-text-faint py-2">No commits found</div>
          )}

          {!loading && commits.length > 0 && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {commits.map((commit) => (
                <div key={commit.hash} className="space-y-0.5">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span
                      className="text-label font-mono shrink-0"
                      style={{ color: "var(--accent)" }}
                    >
                      {commit.hash}
                    </span>
                    <span className="text-label text-text-secondary truncate">
                      {commit.message}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-text-faint">
                    <span className="text-[10px] truncate">{commit.author}</span>
                    <span className="text-[10px] shrink-0">{relativeTime(commit.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
