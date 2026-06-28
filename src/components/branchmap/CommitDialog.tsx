// "Save a checkpoint (commit)" — a single friendly note field plus a count of
// what's changed.

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import BranchDialogShell, { DialogButtons } from "./BranchDialogShell";

interface CommitDialogProps {
  open: boolean;
  projectPath: string;
  /** Number of changed files (from git status). */
  changedCount: number;
  /** Suggested note, e.g. the latest Project Log headline. */
  suggestion?: string;
  onClose: () => void;
}

export default function CommitDialog({
  open,
  projectPath,
  changedCount,
  suggestion,
  onClose,
}: CommitDialogProps) {
  const commit = useGitStore((s) => s.commit);
  const opInProgress = useGitStore((s) => s.opInProgress);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) setMessage(suggestion ?? "");
  }, [open, suggestion]);

  const busy = opInProgress === "commit";

  const submit = async () => {
    if (!message.trim() || busy) return;
    const ok = await commit(projectPath, message.trim());
    if (ok) onClose();
  };

  return (
    <BranchDialogShell
      open={open}
      onClose={onClose}
      onConfirm={submit}
      Icon={Save}
      tint="green"
      title="Save a checkpoint"
      description={
        <span>
          {changedCount > 0
            ? `Saves a snapshot of your ${changedCount} change${changedCount === 1 ? "" : "s"} you can always come back to.`
            : "Saves a snapshot you can always come back to."}
        </span>
      }
      footer={
        <DialogButtons
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel={busy ? "Saving…" : "Save checkpoint"}
          busy={busy}
          confirmDisabled={!message.trim()}
        />
      }
    >
      <label className="block text-label text-text-secondary mb-1">
        What did you change?{" "}
        <span className="text-text-ghost font-mono text-detail">(commit message)</span>
      </label>
      <input
        autoFocus
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="e.g. Added the sign-in screen"
        className="w-full px-3 py-2 rounded-lg text-ui bg-bg-subtle border border-border focus:border-accent outline-none text-text-primary"
      />
    </BranchDialogShell>
  );
}
