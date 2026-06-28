// "Sync" — back up online (push) and get the latest (pull). Push is the only
// irreversible op in the Branch Map, so the preview ("what will upload") is the
// guardrail; there's no undo afterward.

import { useEffect, useState } from "react";
import { Cloud, ArrowUp, ArrowDown, Check, Loader2, CloudOff } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useGitStore } from "../../stores/gitStore";
import { gitPushPreview } from "../../lib/tauri-commands";
import type { PushPreview } from "../../types/branch-graph";

interface SyncDialogProps {
  open: boolean;
  projectPath: string;
  onClose: () => void;
}

export default function SyncDialog({ open, projectPath, onClose }: SyncDialogProps) {
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const publish = useGitStore((s) => s.publish);
  const opInProgress = useGitStore((s) => s.opInProgress);
  const [preview, setPreview] = useState<PushPreview | null>(null);

  const reload = () => {
    gitPushPreview(projectPath)
      .then(setPreview)
      .catch(() => setPreview(null));
  };

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath]);

  const busy = opInProgress !== null;

  const run = async (fn: () => Promise<boolean>) => {
    const ok = await fn();
    if (ok) reload();
  };

  let body: React.ReactNode;
  if (preview === null) {
    body = (
      <span className="flex items-center gap-1.5 text-text-ghost text-label">
        <Loader2 size={12} className="animate-spin" /> Checking your online backup…
      </span>
    );
  } else if (!preview.remoteExists) {
    body = (
      <div className="flex items-start gap-2 text-label text-text-secondary">
        <CloudOff size={16} className="text-text-ghost shrink-0 mt-0.5" />
        <span>
          No online backup is connected to this project yet. Connect one (e.g. GitHub) to
          back up your work and sync across devices.
        </span>
      </div>
    );
  } else if (!preview.hasUpstream) {
    body = (
      <div className="text-label text-text-secondary">
        This branch isn't backed up online yet. Publish it so your checkpoints are safe and
        can sync.
      </div>
    );
  } else if (preview.ahead === 0 && preview.behind === 0) {
    body = (
      <div className="flex items-center gap-1.5 text-green text-label">
        <Check size={14} /> Everything's in sync with online.
      </div>
    );
  } else {
    body = (
      <div className="space-y-1.5 text-label text-text-secondary">
        {preview.ahead > 0 && (
          <div className="flex items-center gap-1.5">
            <ArrowUp size={13} className="text-blue" />
            {preview.ahead} checkpoint{preview.ahead === 1 ? "" : "s"} to back up online.
          </div>
        )}
        {preview.behind > 0 && (
          <div className="flex items-center gap-1.5">
            <ArrowDown size={13} className="text-yellow" />
            {preview.behind} new checkpoint{preview.behind === 1 ? "" : "s"} to bring down.
          </div>
        )}
        {preview.wouldReject && (
          <div className="text-yellow">
            Get the latest first — online has changes you don't have yet.
          </div>
        )}
      </div>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border p-6 w-[440px]"
          style={{ background: "var(--bg-primary)" }}
        >
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-blue/10">
              <Cloud size={20} className="text-blue" />
            </div>
            <div>
              <Dialog.Title className="text-text-primary font-medium text-title">
                Sync with online
              </Dialog.Title>
              <Dialog.Description className="text-ui text-text-dim mt-0.5">
                Back up your checkpoints and pull down anything new.
              </Dialog.Description>
            </div>
          </div>

          <div className="rounded-lg border border-border-light p-3 mb-4">{body}</div>

          <div className="flex justify-end gap-2 flex-wrap">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors disabled:opacity-60"
            >
              Close
            </button>

            {preview?.remoteExists && !preview.hasUpstream && (
              <button
                onClick={() => run(() => publish(projectPath))}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-ui text-white bg-accent hover:bg-accent-light transition-colors disabled:opacity-60"
              >
                {opInProgress === "publish" ? "Publishing…" : "Back it up online"}
              </button>
            )}

            {preview?.hasUpstream && preview.behind > 0 && (
              <button
                onClick={() => run(() => pull(projectPath))}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors disabled:opacity-60"
              >
                <ArrowDown size={13} />
                {opInProgress === "pull" ? "Getting…" : "Get latest"}
              </button>
            )}

            {preview?.hasUpstream && preview.ahead > 0 && (
              <button
                onClick={() => run(() => push(projectPath))}
                disabled={busy || preview.wouldReject}
                title={preview.wouldReject ? "Get the latest first" : "Back up online (push)"}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-ui text-white bg-accent hover:bg-accent-light transition-colors disabled:opacity-60"
              >
                <ArrowUp size={13} />
                {opInProgress === "push" ? "Backing up…" : "Back it up online"}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
