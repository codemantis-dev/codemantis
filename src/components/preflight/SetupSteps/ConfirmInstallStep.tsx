// "Run this command for me" step. Always shows the full command line first
// — never silently runs anything. The user clicks "Run install", we stream
// stdout/stderr back into a small console area, then advance.

import { useState } from "react";
import { Loader2, Terminal as TerminalIcon } from "lucide-react";

interface ConfirmInstallStepProps {
  /** Pretty-printed command, e.g. "npm install -g pnpm". */
  command: string;
  args: string[];
  /** Streamed log lines (the store collects these via Tauri events). */
  installerLogs: string[];
  /** Called when the user confirms — runs the auto-install. */
  onConfirm: () => Promise<void>;
  /** Called after install + re-verify succeeds. */
  onSuccess: () => void;
}

export default function ConfirmInstallStep({
  command,
  args,
  installerLogs,
  onConfirm,
  onSuccess,
}: ConfirmInstallStepProps) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const fullCommand = `${command} ${args.join(" ")}`.trim();

  const handleRun = async () => {
    setRunning(true);
    try {
      await onConfirm();
      setDone(true);
      setTimeout(onSuccess, 600);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        className="rounded-md p-3 font-mono text-detail"
        style={{
          background: "var(--bg-subtle)",
          color: "var(--text-secondary)",
        }}
      >
        <div className="flex items-center gap-2 mb-1 text-text-dim">
          <TerminalIcon size={12} />
          <span>This will run:</span>
        </div>
        <div style={{ color: "var(--text-primary)" }}>{fullCommand}</div>
      </div>

      <p className="text-label text-text-dim">
        Nothing will run until you click the button below.
      </p>

      <button
        type="button"
        onClick={handleRun}
        disabled={running || done}
        className="px-4 py-2 rounded-md text-ui font-medium transition-colors disabled:opacity-50"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {running ? (
          <>
            <Loader2 size={14} className="animate-spin inline mr-1.5" />
            Running…
          </>
        ) : done ? (
          "Done"
        ) : (
          "Run install"
        )}
      </button>

      {installerLogs.length > 0 && (
        <pre
          className="rounded-md p-3 font-mono text-detail overflow-auto max-h-48"
          style={{
            background: "var(--bg-subtle)",
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
          }}
          data-testid="installer-log"
        >
          {installerLogs.join("\n")}
        </pre>
      )}
    </div>
  );
}
