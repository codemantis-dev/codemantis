import { useState, useEffect } from "react";
import { BarChart3 } from "lucide-react";
import type { ApiLogEntry, ApiCostSummary } from "../../../types/api-logs";
import { getApiLogs, getApiCostSummary, cleanupApiLogs } from "../../../lib/tauri-commands";
import { SectionTitle } from "./shared";

export default function ApiLogsTab() {
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [summary, setSummary] = useState<ApiCostSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        // Auto-cleanup logs older than 5 days
        await cleanupApiLogs(5);
        const [logsData, summaryData] = await Promise.all([
          getApiLogs(),
          getApiCostSummary(),
        ]);
        if (!cancelled) {
          setLogs(logsData);
          setSummary(summaryData);
        }
      } catch (e) {
        console.error("Failed to load API logs:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const formatCost = (cost: number): string => {
    if (cost === 0) return "Free";
    if (cost < 0.01) return `$${cost.toFixed(6)}`;
    return `$${cost.toFixed(4)}`;
  };

  const formatTimestamp = (ts: string): string => {
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  if (loading) {
    return (
      <div>
        <SectionTitle>API Logs</SectionTitle>
        <p className="text-ui text-text-dim">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <SectionTitle>API Logs</SectionTitle>

      {/* Cost summary card */}
      {summary && summary.totalCalls > 0 && (
        <div className="rounded-lg border border-border p-4 mb-4 shrink-0" style={{ background: "var(--bg-elevated)" }}>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-ui text-text-secondary">Total Cost</span>
            <span className="text-lg font-semibold text-text-primary">{formatCost(summary.totalCost)}</span>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-ui text-text-secondary">Total Calls</span>
            <span className="text-ui font-medium text-text-primary">{summary.totalCalls}</span>
          </div>
          {summary.byProvider.length > 0 && (
            <div className="border-t border-border-light pt-2 space-y-1.5">
              {summary.byProvider.map((p) => (
                <div key={p.provider} className="flex items-center justify-between">
                  <span className="text-label text-text-dim capitalize">{p.provider}</span>
                  <span className="text-label text-text-secondary">
                    {formatCost(p.cost)} ({p.calls} call{p.calls !== 1 ? "s" : ""})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Log list */}
      {logs.length === 0 ? (
        <div className="text-center py-8 flex-1">
          <BarChart3 size={24} className="mx-auto mb-2 text-text-ghost" />
          <p className="text-ui text-text-dim">No API calls logged yet</p>
          <p className="text-label text-text-ghost mt-1">Calls will appear here when API providers are used</p>
        </div>
      ) : (
        <div className="space-y-1 flex-1 min-h-0 overflow-y-auto">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-light text-label"
              style={{ background: "var(--bg-elevated)" }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.success ? "bg-green" : "bg-red"}`}
              />
              <span className="text-text-ghost w-28 shrink-0">{formatTimestamp(log.timestamp)}</span>
              <span className="text-text-dim capitalize w-16 shrink-0">{log.provider}</span>
              <span className="text-text-secondary flex-1 truncate font-mono">{log.model}</span>
              <span className="text-text-ghost w-24 shrink-0 text-right">
                {log.inputTokens + log.outputTokens} tok
              </span>
              <span className="text-text-primary w-16 shrink-0 text-right font-medium">
                {formatCost(log.costUsd)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-text-ghost mt-3 shrink-0">
        Logs older than 5 days are automatically deleted.
      </p>
    </div>
  );
}
