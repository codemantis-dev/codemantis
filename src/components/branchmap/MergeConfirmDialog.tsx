// "Make it official (merge)" — brings a branch into the current one. The
// "what will happen" preview comes from a zero-mutation backend dry-run
// (git merge-tree), so we can promise "no conflicts expected" honestly.

import { useEffect, useState } from "react";
import { GitMerge, Check, AlertTriangle, Loader2 } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import { mergeBranchPreview } from "../../lib/tauri-commands";
import { humanizeBranchName } from "../../lib/branchmap/changelog-link";
import { basename } from "../../lib/branchmap/commit-format";
import type { MergePreview } from "../../types/branch-graph";
import BranchDialogShell, { DialogButtons } from "./BranchDialogShell";

interface MergeConfirmDialogProps {
  open: boolean;
  projectPath: string;
  source: string;
  currentBranch: string | null;
  onClose: () => void;
}

export default function MergeConfirmDialog({
  open,
  projectPath,
  source,
  currentBranch,
  onClose,
}: MergeConfirmDialogProps) {
  const merge = useGitStore((s) => s.merge);
  const opInProgress = useGitStore((s) => s.opInProgress);
  const [preview, setPreview] = useState<MergePreview | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    mergeBranchPreview(projectPath, source)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [open, projectPath, source]);

  const busy = opInProgress === "merge";
  const into = currentBranch === "main" ? "main (the version you ship)" : currentBranch ?? "your branch";

  const submit = async () => {
    if (busy) return;
    await merge(projectPath, source);
    // Close regardless: on conflict the repo is left mid-merge and the conflict
    // banner takes over; on success the toast (with Undo) covers it.
    onClose();
  };

  return (
    <BranchDialogShell
      open={open}
      onClose={onClose}
      onConfirm={submit}
      Icon={GitMerge}
      tint={preview?.willConflict ? "yellow" : "green"}
      title={`Make "${humanizeBranchName(source)}" official?`}
      description={<span>This copies its changes into {into}.</span>}
      footer={
        <DialogButtons
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel={busy ? "Merging…" : "Make it official"}
          busy={busy}
          confirmDisabled={preview?.upToDate ?? false}
        />
      }
    >
      <div
        className={`rounded-lg border p-3 text-label ${
          preview?.willConflict
            ? "border-yellow/30 bg-yellow/10"
            : "border-border-light"
        }`}
      >
        {preview === null ? (
          <span className="flex items-center gap-1.5 text-text-ghost">
            <Loader2 size={12} className="animate-spin" /> Checking what will happen…
          </span>
        ) : preview.upToDate ? (
          <span className="text-text-secondary">
            "{humanizeBranchName(source)}" is already part of {into} — nothing to bring in.
          </span>
        ) : preview.willConflict ? (
          <div className="text-text-secondary">
            <span className="flex items-center gap-1.5 text-yellow font-medium mb-1">
              <AlertTriangle size={13} /> {preview.conflictFiles.length} file
              {preview.conflictFiles.length === 1 ? "" : "s"} overlap and need a careful merge
            </span>
            <span>
              You can still go ahead — if it gets stuck, you'll get a one-click "undo" and the
              option to let your AI assistant sort it out.
            </span>
            {preview.conflictFiles.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {preview.conflictFiles.slice(0, 6).map((f) => (
                  <span
                    key={f}
                    className="text-detail font-mono text-text-ghost bg-bg-elevated rounded px-1 py-px"
                  >
                    {basename(f)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="flex items-center gap-1.5 text-green">
            <Check size={13} />
            <span className="text-text-secondary">
              Brings {preview.commitsBrought} change
              {preview.commitsBrought === 1 ? "" : "s"} into {into}. No conflicts expected.
            </span>
          </span>
        )}
      </div>
    </BranchDialogShell>
  );
}
