import { SectionTitle, FieldRow } from "./SettingsShared";

export default function SessionLogsTab({
  enabled,
  retentionDays,
  onEnabledChange,
  onRetentionDaysChange,
  codexDebugLoggingEnabled,
  onCodexDebugLoggingChange,
}: {
  enabled: boolean;
  retentionDays: number;
  onEnabledChange: (v: boolean) => void;
  onRetentionDaysChange: (d: number) => void;
  codexDebugLoggingEnabled: boolean;
  onCodexDebugLoggingChange: (v: boolean) => void;
}) {
  return (
    <div>
      <SectionTitle>Session Logs</SectionTitle>
      <p className="text-label text-text-dim mb-4">
        Save the complete conversation of each session — all messages exchanged
        between you and Claude Code. When you reopen a historical session, the
        full chat history is restored so you can pick up where you left off.
      </p>

      {/* Toggle */}
      <div className="flex items-center justify-between py-2 mb-3">
        <div>
          <label className="text-ui text-text-secondary">Save session conversations</label>
          <p className="text-label text-text-ghost">
            Store all messages when a session closes so they can be replayed later
          </p>
        </div>
        <button
          onClick={() => onEnabledChange(!enabled)}
          className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
            enabled ? "bg-accent" : "bg-bg-elevated border border-border"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Codex debug logging (raw JSON-RPC wire capture) */}
      <div className="flex items-center justify-between py-2 mb-3 border-t border-border-light pt-4">
        <div>
          <label className="text-ui text-text-secondary">Codex debug logging</label>
          <p className="text-label text-text-ghost">
            Capture the raw Codex protocol (both directions) to a per-session file under the app
            data folder (codex-wire-logs). Helps troubleshoot compaction stalls. Safe to leave on.
          </p>
        </div>
        <button
          onClick={() => onCodexDebugLoggingChange(!codexDebugLoggingEnabled)}
          className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
            codexDebugLoggingEnabled ? "bg-accent" : "bg-bg-elevated border border-border"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
              codexDebugLoggingEnabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4">
          <div className="border-t border-border-light pt-4">
            <FieldRow label="Retention period">
              <select
                value={retentionDays}
                onChange={(e) => onRetentionDaysChange(Number(e.target.value))}
                className="px-2 py-1 rounded bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
                <option value={0}>Forever</option>
              </select>
            </FieldRow>
            <p className="text-label text-text-ghost mt-1">
              Session logs older than this are automatically cleaned up on app launch.
              Set to &ldquo;Forever&rdquo; to keep all logs indefinitely.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
