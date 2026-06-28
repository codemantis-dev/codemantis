// "New safe space (new branch)" — name it, optionally switch into it.

import { useEffect, useState } from "react";
import { GitBranchPlus } from "lucide-react";
import { useGitStore } from "../../stores/gitStore";
import BranchDialogShell, { DialogButtons } from "./BranchDialogShell";

interface NewBranchDialogProps {
  open: boolean;
  projectPath: string;
  /** Branch/ref the new space starts from (null = current). */
  fromRef?: string | null;
  onClose: () => void;
}

export default function NewBranchDialog({
  open,
  projectPath,
  fromRef = null,
  onClose,
}: NewBranchDialogProps) {
  const createBranch = useGitStore((s) => s.createBranch);
  const opInProgress = useGitStore((s) => s.opInProgress);
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);

  useEffect(() => {
    if (open) {
      setName("");
      setCheckout(true);
    }
  }, [open]);

  const busy = opInProgress === "create";

  const submit = async () => {
    if (!name.trim() || busy) return;
    const ok = await createBranch(projectPath, name.trim(), fromRef, checkout);
    if (ok) onClose();
  };

  return (
    <BranchDialogShell
      open={open}
      onClose={onClose}
      onConfirm={submit}
      Icon={GitBranchPlus}
      tint="accent"
      title="New safe space"
      description={
        <span>
          A branch where you can try changes without touching your main version.
        </span>
      }
      footer={
        <DialogButtons
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel={busy ? "Creating…" : "Create"}
          busy={busy}
          confirmDisabled={!name.trim()}
        />
      }
    >
      <label className="block text-label text-text-secondary mb-1">
        Name it{" "}
        <span className="text-text-ghost font-mono text-detail">(branch name)</span>
      </label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. new-homepage"
        className="w-full px-3 py-2 rounded-lg text-ui bg-bg-subtle border border-border focus:border-accent outline-none text-text-primary"
      />
      <label className="flex items-center gap-2 mt-3 text-label text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={checkout}
          onChange={(e) => setCheckout(e.target.checked)}
        />
        Switch into it now{" "}
        <span className="text-text-ghost font-mono text-detail">(checkout)</span>
      </label>
    </BranchDialogShell>
  );
}
