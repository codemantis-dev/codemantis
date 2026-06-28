// Shown only when switching with unsaved work. We never force or discard —
// the safe path is to save a checkpoint first, then switch, in one step.

import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import { humanizeBranchName } from "../../lib/branchmap/changelog-link";
import BranchDialogShell, { DialogButtons } from "./BranchDialogShell";

interface SwitchBranchDialogProps {
  open: boolean;
  projectPath: string;
  targetBranch: string;
  dirtyFiles: string[];
  onClose: () => void;
}

export default function SwitchBranchDialog({
  open,
  projectPath,
  targetBranch,
  dirtyFiles,
  onClose,
}: SwitchBranchDialogProps) {
  const commit = useGitStore((s) => s.commit);
  const switchBranch = useGitStore((s) => s.switchBranch);
  const opInProgress = useGitStore((s) => s.opInProgress);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) setMessage("Work in progress");
  }, [open]);

  const busy = opInProgress === "commit" || opInProgress === "switch";
  const count = dirtyFiles.length;

  const saveAndSwitch = async () => {
    if (!message.trim() || busy) return;
    const saved = await commit(projectPath, message.trim());
    if (!saved) return; // commit failed → toast already shown, stay open
    const switched = await switchBranch(projectPath, targetBranch);
    if (switched) onClose();
  };

  return (
    <BranchDialogShell
      open={open}
      onClose={onClose}
      onConfirm={saveAndSwitch}
      Icon={GitBranch}
      tint="yellow"
      title={`Switch to "${humanizeBranchName(targetBranch)}"?`}
      description={
        <span>
          You have {count} unsaved change{count === 1 ? "" : "s"}. Save them as a
          checkpoint first so nothing gets lost.
        </span>
      }
      footer={
        <DialogButtons
          onCancel={onClose}
          onConfirm={saveAndSwitch}
          confirmLabel={busy ? "Working…" : "Save & switch"}
          busy={busy}
          confirmDisabled={!message.trim()}
        />
      }
    >
      <label className="block text-label text-text-secondary mb-1">
        Checkpoint note{" "}
        <span className="text-text-ghost font-mono text-detail">(commit message)</span>
      </label>
      <input
        autoFocus
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-ui bg-bg-subtle border border-border focus:border-accent outline-none text-text-primary"
      />
    </BranchDialogShell>
  );
}
