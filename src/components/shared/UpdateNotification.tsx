import { useState } from "react";
import { Download, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";

export default function UpdateNotification() {
  const [dismissed, setDismissed] = useState(false);
  const updateAvailable = useUiStore((s) => s.updateAvailable);
  const version = useUiStore((s) => s.availableVersion);
  const notes = useUiStore((s) => s.availableNotes);
  const openUpdateModal = useUiStore((s) => s.openUpdateModal);

  if (!updateAvailable || !version || dismissed) return null;

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
        onClick={() => openUpdateModal(version, notes)}
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
