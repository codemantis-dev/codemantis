// "Click here to open this link in your browser" step. Used at the top of
// most account-creation flows: register, sign in, navigate to settings page.
//
// We open via Tauri's opener plugin so links land in the user's default
// browser rather than inside the app shell.

import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

interface OpenUrlStepProps {
  url: string;
  label?: string | null;
  /** Called once the user has clicked through; advances the stepper. */
  onContinue: () => void;
}

export default function OpenUrlStep({ url, label, onContinue }: OpenUrlStepProps) {
  const handleOpen = async () => {
    try {
      await openUrl(url);
    } catch {
      // Even if the OS reports a failure, advance — the user might already
      // have the page open. Better than trapping them on this step.
    }
    onContinue();
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-ui font-medium transition-colors"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {label ?? "Open in browser"}
        <ExternalLink size={14} />
      </button>
      <p className="text-detail text-text-ghost break-all">{url}</p>
    </div>
  );
}
