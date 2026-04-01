import { useEffect, useState, useCallback, useMemo } from "react";
import { History, RefreshCw, Loader2, Play, ArrowLeft, Search, X } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { listSessionHistory, searchSessionMessages } from "../../lib/tauri-commands";
import { useUiStore } from "../../stores/uiStore";
import { showToast } from "../../stores/toastStore";
import { handleError } from "../../lib/error-handler";
import type { SessionHistoryEntry, SessionMessageSearchResult } from "../../types/session";

const SESSION_ICONS = ["\u2B21", "\u25C8", "\u25B3", "\u25CB", "\u25A1", "\u25C7", "\u2B22", "\u25BD", "\u25CE", "\u2B1F"];

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString([], { month: "short", day: "numeric" });
}

function HistoryCard({
  entry,
  onResume,
  resuming,
  searchSnippets,
}: {
  entry: SessionHistoryEntry;
  onResume: () => void;
  resuming: boolean;
  searchSnippets?: string[];
}) {
  const icon = SESSION_ICONS[entry.icon_index % SESSION_ICONS.length];
  const modelLabel = entry.model
    ? entry.model.replace(/^claude-/, "").split("-")[0]
    : null;
  const capitalizedModel = modelLabel
    ? modelLabel.charAt(0).toUpperCase() + modelLabel.slice(1)
    : null;

  return (
    <div className="px-4 py-3 border-b border-border-light hover:bg-bg-subtle transition-colors">
      <div className="flex items-start gap-2.5">
        <span className="text-text-dim text-base mt-0.5 shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-ui font-medium text-text-primary truncate">
              {entry.name}
            </span>
            {capitalizedModel && (
              <span className="text-[10px] font-medium text-accent bg-accent-dim rounded px-1 py-px shrink-0">
                {capitalizedModel}
              </span>
            )}
            {entry.has_stored_messages && (
              <span className="text-[9px] font-medium rounded px-1 py-px shrink-0" style={{ color: "var(--green, #22c55e)", background: "color-mix(in srgb, var(--green, #22c55e) 12%, transparent)" }}>
                Saved
              </span>
            )}
            <span className="text-[10px] text-text-ghost ml-auto shrink-0">
              {formatRelativeTime(entry.closed_at)}
            </span>
          </div>

          {/* Show search snippets when searching, otherwise show headlines */}
          {searchSnippets && searchSnippets.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {searchSnippets.map((snippet, i) => (
                <li key={i} className="text-label text-text-dim leading-snug flex items-start gap-1.5">
                  <span className="text-accent mt-[3px] shrink-0">&#x2022;</span>
                  <span className="truncate">{snippet}</span>
                </li>
              ))}
            </ul>
          ) : entry.recent_headlines.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {entry.recent_headlines.map((headline, i) => (
                <li key={`${headline}-${i}`} className="text-label text-text-dim leading-snug flex items-start gap-1.5">
                  <span className="text-text-ghost mt-[3px] shrink-0">&#x2022;</span>
                  <span className="truncate">{headline}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <button
          onClick={onResume}
          disabled={resuming}
          className="mt-0.5 flex items-center gap-1 px-2 py-1 rounded text-label font-medium
            bg-accent-dim text-accent hover:bg-accent hover:text-white
            transition-colors shrink-0 disabled:opacity-50"
        >
          {resuming ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          <span>Resume</span>
        </button>
      </div>
    </div>
  );
}

export default function ClaudeHistory() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const setShowClaudeHistory = useUiStore((s) => s.setShowClaudeHistory);
  const { resumeFromHistory } = useClaudeSession();
  const [entries, setEntries] = useState<SessionHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SessionMessageSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!activeProjectPath) return;
    setLoading(true);
    try {
      const result = await listSessionHistory(activeProjectPath);
      setEntries(result);
    } catch (e) {
      handleError("ClaudeHistory.loadHistory", e);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [activeProjectPath]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || !activeProjectPath) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchSessionMessages(activeProjectPath, searchQuery.trim());
        setSearchResults(results);
      } catch (e) {
        console.error("[ClaudeHistory.search]", e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeProjectPath]);

  // Group search results by session for display
  const searchSnippetsBySession = useMemo(() => {
    if (!searchResults) return null;
    const map = new Map<string, string[]>();
    for (const r of searchResults) {
      const existing = map.get(r.sessionId) ?? [];
      if (existing.length < 3) {
        existing.push(r.contentSnippet);
      }
      map.set(r.sessionId, existing);
    }
    return map;
  }, [searchResults]);

  // Filter entries to only those with search matches when searching
  const visibleEntries = useMemo(() => {
    if (!entries) return null;
    if (!searchSnippetsBySession) return entries;
    return entries.filter((e) => searchSnippetsBySession.has(e.session_id));
  }, [entries, searchSnippetsBySession]);

  const handleResume = useCallback(async (entry: SessionHistoryEntry) => {
    if (!activeProjectPath) return;
    setResumingId(entry.cli_session_id);
    try {
      await resumeFromHistory(
        activeProjectPath,
        entry.cli_session_id,
        entry.name,
        entry.session_id
      );
      if (!entry.has_stored_messages) {
        showToast("Previous messages were not saved for this session", "info");
      }
    } catch (e) {
      console.error("[ClaudeHistory.handleResume]", e);
      showToast("Session no longer available — try creating a new session", "error");
    } finally {
      setResumingId(null);
    }
  }, [activeProjectPath, resumeFromHistory]);

  if (!activeProjectPath) {
    return (
      <div className="h-full flex items-center justify-center text-text-ghost text-ui">
        No project selected
      </div>
    );
  }

  const isFiltering = searchQuery.trim().length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b border-border-light shrink-0"
        style={{ background: "var(--bg-subtle)" }}
      >
        <History size={14} className="text-text-secondary shrink-0" />
        <span className="text-ui font-medium text-text-primary">Claude History</span>
        {entries && (
          <span className="text-[10px] text-text-ghost bg-bg-elevated rounded px-1.5 py-px">
            {entries.length}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowClaudeHistory(false)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          title="Back to Project"
        >
          <ArrowLeft size={12} />
          <span>Back</span>
        </button>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="p-1 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Search bar */}
      {entries && entries.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-light shrink-0">
          <Search size={12} className="text-text-ghost shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search session conversations..."
            className="flex-1 bg-transparent text-label text-text-secondary placeholder:text-text-ghost outline-none min-w-0"
          />
          {isFiltering && (
            <>
              {searching && <Loader2 size={12} className="text-text-ghost animate-spin shrink-0" />}
              {searchResults && (
                <span className="text-[10px] text-text-ghost shrink-0">
                  {visibleEntries?.length ?? 0} of {entries.length}
                </span>
              )}
              <button
                onClick={() => setSearchQuery("")}
                className="p-0.5 rounded text-text-ghost hover:text-text-secondary transition-colors shrink-0"
                title="Clear search"
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && !entries && (
          <div className="flex items-center justify-center gap-2 py-8 text-text-dim text-label">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading session history...</span>
          </div>
        )}

        {!loading && entries && entries.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center px-4 text-center">
            <History size={24} className="text-text-ghost mb-2" />
            <p className="text-text-faint text-ui mb-1">No closed sessions for this project</p>
            <p className="text-text-ghost text-label">
              Sessions you close will appear here so you can resume them later.
            </p>
          </div>
        )}

        {/* Search: no matches */}
        {isFiltering && !searching && visibleEntries && visibleEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <p className="text-text-faint text-ui mb-1">No sessions match your search</p>
            <button
              onClick={() => setSearchQuery("")}
              className="text-accent text-label hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        {visibleEntries && visibleEntries.length > 0 && visibleEntries.map((entry) => (
          <HistoryCard
            key={entry.cli_session_id}
            entry={entry}
            onResume={() => handleResume(entry)}
            resuming={resumingId === entry.cli_session_id}
            searchSnippets={searchSnippetsBySession?.get(entry.session_id)}
          />
        ))}
      </div>
    </div>
  );
}
