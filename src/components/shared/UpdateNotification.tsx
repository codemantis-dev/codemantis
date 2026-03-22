import { useState, useEffect, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X, RefreshCw } from "lucide-react";

export default function UpdateNotification() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    const timer = setTimeout(async () => {
      try {
        const result = await check();
        if (result) {
          setUpdate(result);
        }
      } catch (e) {
        console.warn("[updater] Check failed:", e);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = async (): Promise<void> => {
    if (!update) return;
    setDownloading(true);
    setError(null);
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

      await relaunch();
    } catch (e) {
      console.error("[updater] Update failed:", e);
      setError(String(e));
      setDownloading(false);
    }
  };

  if (!update || dismissed) return null;

  return (
    <div
      className="flex items-center justify-between px-4 py-2 text-ui shrink-0"
      style={{
        background: "var(--accent-dim)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-2">
        <Download size={14} style={{ color: "var(--accent)" }} />
        <span className="text-text-primary">
          CodeMantis <strong>v{update.version}</strong> is available
        </span>
      </div>
      <div className="flex items-center gap-2">
        {error && (
          <span className="text-label" style={{ color: "var(--red)" }}>
            Update failed
          </span>
        )}
        {downloading ? (
          <div className="flex items-center gap-2">
            <RefreshCw size={13} className="animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-text-secondary text-label">
              {progress > 0 ? `${progress}%` : "Downloading..."}
            </span>
          </div>
        ) : (
          <button
            onClick={handleUpdate}
            className="px-3 py-1 rounded-md text-label font-medium transition-colors"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Update &amp; Restart
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded transition-colors"
          style={{ color: "var(--text-ghost)" }}
          aria-label="Dismiss update notification"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
