import { useState, useEffect, useMemo } from "react";
import { BarChart3, AlertTriangle, FileText, Check, Copy } from "lucide-react";
import type { ApiLogEntry, ApiCostSummary } from "../../../types/api-logs";
import { getApiLogs, getApiCostSummary, cleanupApiLogs } from "../../../lib/tauri-commands";
import { formatCost, formatTimestamp } from "../../../lib/format-utils";
import { SectionTitle } from "./SettingsShared";

const LOG_FILE_PATH = "~/Library/Logs/dev.codemantis.myapp/codemantis.log";

type TabId = "cost" | "errors";

export default function ApiLogsTab() {
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [summary, setSummary] = useState<ApiCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("cost");
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [logPathCopied, setLogPathCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const errorLogs = useMemo(() => logs.filter((l) => !l.success), [logs]);

  const errorsByProvider = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const log of errorLogs) {
      counts[log.provider] = (counts[log.provider] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [errorLogs]);

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

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-lg border border-border mb-4 shrink-0 w-fit" style={{ background: "var(--bg-elevated)" }}>
        {([
          { id: "cost" as TabId, label: "Cost Log" },
          { id: "errors" as TabId, label: `Error Log${errorLogs.length > 0 ? ` (${errorLogs.length})` : ""}` },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 rounded-md text-label font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-bg-primary text-text-primary shadow-sm"
                : "text-text-dim hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "cost" ? (
        <>
          {/* Cost summary card */}
          {summary && summary.totalCalls > 0 && (
            <div className="rounded-lg border border-border p-4 mb-4 shrink-0" style={{ background: "var(--bg-elevated)" }}>
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-ui text-text-secondary">Total Cost</span>
                <span className="text-lg font-semibold text-text-primary">{formatCost(summary.totalCost, "explicit")}</span>
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

          {/* Cost log list */}
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
                  className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-border-light text-label select-text"
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
                  <button
                    type="button"
                    onClick={() => {
                      const text = `${formatTimestamp(log.timestamp)} | ${log.provider} | ${log.model} | ${log.inputTokens + log.outputTokens} tokens | ${formatCost(log.costUsd)}`;
                      navigator.clipboard.writeText(text).then(() => {
                        setCopiedId(log.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      });
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-ghost hover:text-text-secondary transition-all shrink-0 select-none"
                    title="Copy entry"
                  >
                    {copiedId === log.id ? <Check size={12} className="text-green" /> : <Copy size={12} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Error summary card */}
          {errorLogs.length > 0 && (
            <div className="rounded-lg border border-border p-4 mb-4 shrink-0" style={{ background: "var(--bg-elevated)" }}>
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-ui text-text-secondary">Total Errors</span>
                <span className="text-lg font-semibold text-red">{errorLogs.length}</span>
              </div>
              {errorsByProvider.length > 0 && (
                <div className="border-t border-border-light pt-2 space-y-1.5">
                  {errorsByProvider.map(([provider, count]) => (
                    <div key={provider} className="flex items-center justify-between">
                      <span className="text-label text-text-dim capitalize">{provider}</span>
                      <span className="text-label text-red">
                        {count} error{count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error log list */}
          {errorLogs.length === 0 ? (
            <div className="text-center py-8 flex-1">
              <AlertTriangle size={24} className="mx-auto mb-2 text-text-ghost" />
              <p className="text-ui text-text-dim">No errors logged</p>
              <p className="text-label text-text-ghost mt-1">API errors will appear here when they occur</p>
            </div>
          ) : (
            <div className="space-y-1 flex-1 min-h-0 overflow-y-auto">
              {errorLogs.map((log) => (
                <div key={log.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedErrorId(expandedErrorId === log.id ? null : log.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedErrorId(expandedErrorId === log.id ? null : log.id);
                      }
                    }}
                    className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-border-light text-label w-full text-left hover:border-border transition-colors cursor-pointer select-text"
                    style={{ background: "var(--bg-elevated)" }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-red" />
                    <span className="text-text-ghost w-28 shrink-0">{formatTimestamp(log.timestamp)}</span>
                    <span className="text-text-dim capitalize w-16 shrink-0">{log.provider}</span>
                    <span className="text-text-dim shrink-0 font-mono">{log.model}</span>
                    <span className="text-red flex-1 truncate font-mono text-[11px]">
                      {log.errorMessage || "Unknown error"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const text = `${formatTimestamp(log.timestamp)} | ${log.provider} | ${log.model} | Error: ${log.errorMessage || "Unknown error"}`;
                        navigator.clipboard.writeText(text).then(() => {
                          setCopiedId(log.id);
                          setTimeout(() => setCopiedId(null), 1500);
                        });
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-ghost hover:text-text-secondary transition-all shrink-0 select-none"
                      title="Copy entry"
                    >
                      {copiedId === log.id ? <Check size={12} className="text-green" /> : <Copy size={12} />}
                    </button>
                  </div>
                  {expandedErrorId === log.id && log.errorMessage && (
                    <div
                      className="group/detail mx-3 mt-1 mb-2 px-3 py-2 rounded border border-border-light font-mono text-[11px] text-red whitespace-pre-wrap break-all select-text relative"
                      style={{ background: "var(--bg-primary)" }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(log.errorMessage || "").then(() => {
                            setCopiedId(`${log.id}-detail`);
                            setTimeout(() => setCopiedId(null), 1500);
                          });
                        }}
                        className="absolute top-1.5 right-1.5 opacity-0 group-hover/detail:opacity-100 p-1 rounded text-text-ghost hover:text-text-secondary transition-all select-none"
                        style={{ background: "var(--bg-elevated)" }}
                        title="Copy error message"
                      >
                        {copiedId === `${log.id}-detail` ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                      </button>
                      {log.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="text-[11px] text-text-ghost mt-3 shrink-0">
        Logs older than 5 days are automatically deleted.
      </p>

      {/* Diagnostics */}
      <div className="border-t border-border mt-4 pt-4 shrink-0">
        <SectionTitle>Diagnostics</SectionTitle>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(LOG_FILE_PATH);
              setLogPathCopied(true);
              setTimeout(() => setLogPathCopied(false), 2000);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-label text-text-secondary hover:text-text-primary hover:border-border-light transition-colors"
            style={{ background: "var(--bg-elevated)" }}
          >
            {logPathCopied ? <Check size={14} className="text-green" /> : <FileText size={14} />}
            {logPathCopied ? "Copied!" : "Copy Log Path"}
          </button>
          <span className="text-[11px] text-text-ghost font-mono truncate">{LOG_FILE_PATH}</span>
        </div>
      </div>
    </div>
  );
}
