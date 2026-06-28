// Global Branch Map actions for the header: "New safe space" and "Save a
// checkpoint". Plain-language first, git term as a tooltip. Sync (push/pull)
// is added in Phase 7.

import { GitBranchPlus, Save, Cloud } from "lucide-react";

interface BranchActionsBarProps {
  onNewBranch: () => void;
  onCommit: () => void;
  onSync: () => void;
  /** Number of unsaved changes — Save is disabled at 0. */
  changedCount: number;
  /** Disable all actions while an op runs. */
  busy: boolean;
}

export default function BranchActionsBar({
  onNewBranch,
  onCommit,
  onSync,
  changedCount,
  busy,
}: BranchActionsBarProps) {
  const canSave = changedCount > 0 && !busy;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onNewBranch}
        disabled={busy}
        title="Create a new branch"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-label font-medium text-white bg-accent hover:bg-accent-light transition-colors disabled:opacity-60"
      >
        <GitBranchPlus size={12} />
        New safe space
      </button>
      <button
        onClick={onCommit}
        disabled={!canSave}
        title={changedCount > 0 ? "Save a checkpoint (commit)" : "Nothing to save yet"}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-label font-medium text-text-secondary border border-border hover:bg-bg-elevated transition-colors disabled:opacity-40"
      >
        <Save size={12} />
        Save a checkpoint
        {changedCount > 0 && (
          <span className="text-detail text-green bg-green/15 rounded px-1">{changedCount}</span>
        )}
      </button>
      <button
        onClick={onSync}
        disabled={busy}
        title="Sync with your online backup (push / pull)"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-label font-medium text-text-secondary border border-border hover:bg-bg-elevated transition-colors disabled:opacity-40"
      >
        <Cloud size={12} />
        Sync
      </button>
    </div>
  );
}
