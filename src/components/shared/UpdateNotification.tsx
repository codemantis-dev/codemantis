import { useState, useEffect, useRef } from "react";
import { Download, X } from "lucide-react";
import { checkForUpdate } from "../../lib/update-checker";
import { useUiStore } from "../../stores/uiStore";

export default function UpdateNotification() {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const openUpdateModal = useUiStore((s) => s.openUpdateModal);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    const timer = setTimeout(async () => {
      try {
        const info = await checkForUpdate();
        if (info) {
          setVersion(info.version);
        }
      } catch (e) {
        console.warn("[updater] Check failed:", e);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  if (!version || dismissed) return null;

  return (
    <div
      className="flex items-center justify-end px-4 py-2 text-ui shrink-0 gap-3"
      style={{
        background: "var(--accent-dim)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-2">
        <Download size={14} style={{ color: "var(--accent)" }} />
        <span className="text-text-primary">
          CodeMantis <strong>v{version}</strong> is available
        </span>
      </div>
      <button
        onClick={() => openUpdateModal(version, null)}
        className="px-3 py-1 rounded-md text-label font-medium transition-colors"
        style={{ background: "var(--accent)", color: "white" }}
      >
        Update Now
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 rounded transition-colors"
        style={{ color: "var(--text-ghost)" }}
        aria-label="Dismiss update notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}
