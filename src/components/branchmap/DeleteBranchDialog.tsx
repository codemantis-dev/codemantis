// "Delete this space (delete branch)" — with a count-aware warning when the
// space has checkpoints not yet in the current branch.

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import { deleteBranchPreview } from "../../lib/tauri-commands";
import { humanizeBranchName } from "../../lib/branchmap/changelog-link";
import type { DeletePreview } from "../../types/branch-graph";
import BranchDialogShell, { DialogButtons } from "./BranchDialogShell";

interface DeleteBranchDialogProps {
  open: boolean;
  projectPath: string;
  branch: string;
  onClose: () => void;
}

export default function DeleteBranchDialog({
  open,
  projectPath,
  branch,
  onClose,
}: DeleteBranchDialogProps) {
  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const opInProgress = useGitStore((s) => s.opInProgress);
  const [preview, setPreview] = useState<DeletePreview | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    deleteBranchPreview(projectPath, branch)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [open, projectPath, branch]);

  const busy = opInProgress === "delete";
  const unmerged = preview?.unmergedCommits ?? 0;
  const force = unmerged > 0;

  const submit = async () => {
    if (busy) return;
    const ok = await deleteBranch(projectPath, branch, force);
    if (ok) onClose();
  };

  return (
    <BranchDialogShell
      open={open}
      onClose={onClose}
      onConfirm={submit}
      Icon={Trash2}
      tint="red"
      title={`Delete "${humanizeBranchName(branch)}"?`}
      footer={
        <DialogButtons
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel={busy ? "Deleting…" : "Delete"}
          confirmTint="red"
          busy={busy}
        />
      }
    >
      <div className="rounded-lg border border-border-light p-3 text-label text-text-secondary">
        {preview === null ? (
          <span className="text-text-ghost">Checking what's in this space…</span>
        ) : unmerged > 0 ? (
          <span className="text-yellow">
            This space has {unmerged} checkpoint{unmerged === 1 ? "" : "s"} that
            {unmerged === 1 ? " isn't" : " aren't"} in your current branch. Deleting
            it loses {unmerged === 1 ? "that work" : "that work"} — you can undo right
            after, but not later.
          </span>
        ) : (
          <span>
            Everything here is already in your current branch, so nothing is lost. You
            can undo this right after, too.
          </span>
        )}
      </div>
    </BranchDialogShell>
  );
}
