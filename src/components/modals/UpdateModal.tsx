import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, X, RefreshCw, CheckCircle } from "lucide-react";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUiStore } from "../../stores/uiStore";
import { getPendingUpdate } from "../../lib/update-checker";

export default function UpdateModal() {
  const show = useUiStore((s) => s.showUpdateModal);
  const version = useUiStore((s) => s.updateVersion);
  const notes = useUiStore((s) => s.updateNotes);
  const close = useUiStore((s) => s.closeUpdateModal);

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleUpdate = async (): Promise<void> => {
    const update = getPendingUpdate();
    if (!update) return;

    setDownloading(true);
    setError(null);
    setProgress(0);

    try {
      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });

      setDone(true);
      // Brief pause so user sees 100%, then relaunch
      setTimeout(() => relaunch(), 800);
    } catch (e) {
      console.error("[updater] Install failed:", e);
      setError(String(e));
      setDownloading(false);
    }
  };

  const handleClose = (): void => {
    if (downloading) return; // don't dismiss while downloading
    setError(null);
    setProgress(0);
    setDone(false);
    setDownloading(false);
    close();
  };

  return (
    <Dialog.Root open={show} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-xl shadow-2xl p-6"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          {/* Close button */}
          {!downloading && (
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 p-1 rounded transition-colors"
              style={{ color: "var(--text-ghost)" }}
            >
              <X size={16} />
            </button>
          )}

          {/* Icon and title */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "var(--accent-dim)" }}
            >
              {done ? (
                <CheckCircle size={20} style={{ color: "var(--green)" }} />
              ) : (
                <Download size={20} style={{ color: "var(--accent)" }} />
              )}
            </div>
            <div>
              <Dialog.Title className="text-text-primary font-semibold text-base">
                {done ? "Update installed" : "Update available"}
              </Dialog.Title>
              <p className="text-text-secondary text-ui">
                CodeMantis v{version}
              </p>
            </div>
          </div>

          {/* Release notes */}
          {notes && (
            <div
              className="rounded-lg p-3 mb-4 text-ui text-text-secondary max-h-32 overflow-y-auto"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-light)" }}
            >
              {notes}
            </div>
          )}

          {/* Progress bar */}
          {downloading && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-label text-text-secondary">
                  {done ? "Restarting..." : progress > 0 ? "Installing..." : "Downloading..."}
                </span>
                <span className="text-label text-text-ghost">{progress}%</span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "var(--bg-elevated)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress}%`,
                    background: done ? "var(--green)" : "var(--accent)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-label mb-4" style={{ color: "var(--red)" }}>
              Update failed: {error}
            </p>
          )}

          {/* Actions */}
          {!downloading && !done && (
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-ui text-text-secondary transition-colors"
                style={{ background: "var(--bg-elevated)" }}
              >
                Later
              </button>
              <button
                onClick={handleUpdate}
                className="px-4 py-2 rounded-lg text-ui font-medium text-white transition-colors"
                style={{ background: "var(--accent)" }}
              >
                <span className="flex items-center gap-1.5">
                  <RefreshCw size={14} />
                  Update &amp; Restart
                </span>
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
