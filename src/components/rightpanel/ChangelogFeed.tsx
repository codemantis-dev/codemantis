import { useState } from "react";
import { Sparkles, Loader2, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useChangelogStore } from "../../stores/changelogStore";
import type { ChangelogEntry } from "../../types/changelog";
import { deleteChangelogEntry } from "../../lib/tauri-commands";
import { CATEGORY_CONFIG } from "../../lib/changelog-utils";
import { showToast } from "../../stores/toastStore";

function ChangelogCard({ entry, sessionId }: { entry: ChangelogEntry; sessionId: string }) {
  const removeEntry = useChangelogStore((s) => s.removeEntry);
  const config = CATEGORY_CONFIG[entry.category] ?? CATEGORY_CONFIG.feature;
  const Icon = config.icon;
  const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [expanded, setExpanded] = useState(false);

  const hasDetails = !!(entry.technical_details || entry.tools_summary);

  const handleDelete = async () => {
    try {
      await deleteChangelogEntry(entry.id);
      removeEntry(sessionId, entry.id);
    } catch (e) {
      console.error("Failed to delete changelog entry:", e);
      showToast("Failed to delete changelog entry", "error");
    }
  };

  // Parse technical_details bullets (split on "• " or newline-delimited)
  const detailBullets = entry.technical_details
    ? entry.technical_details
        .split(/(?:^|\n)\s*[•-]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return (
    <div className="px-3 py-2.5 border-b border-border-light group">
      <div className="flex items-start gap-2">
        {/* Category icon */}
        <div className={`mt-0.5 shrink-0 ${config.color}`}>
          <Icon size={14} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Header: badge + time */}
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-medium ${config.color} bg-bg-elevated rounded px-1 py-px`}>
              {config.label}
            </span>
            <span className="text-[10px] text-text-ghost ml-auto">{time}</span>
            <button
              onClick={handleDelete}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-ghost hover:text-red transition-all"
              title="Delete entry"
            >
              <Trash2 size={10} />
            </button>
          </div>

          {/* Headline */}
          <p className="text-ui text-text-primary font-medium leading-tight mb-0.5">
            {entry.headline}
          </p>

          {/* Description */}
          <p className="text-label text-text-dim leading-snug">
            {entry.description}
          </p>

          {/* Tools summary badge */}
          {entry.tools_summary && (
            <p className="text-[10px] text-text-ghost mt-1 italic">
              {entry.tools_summary}
            </p>
          )}

          {/* Expandable technical details */}
          {hasDetails && detailBullets.length > 0 && (
            <div className="mt-1.5">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-[10px] text-text-ghost hover:text-text-dim transition-colors"
              >
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <span>{expanded ? "Hide" : "Show"} details ({detailBullets.length})</span>
              </button>
              {expanded && (
                <ul className="mt-1 ml-1 space-y-0.5">
                  {detailBullets.map((bullet, i) => (
                    <li key={i} className="text-[11px] text-text-dim leading-snug flex items-start gap-1.5">
                      <span className="text-text-ghost mt-px shrink-0">&#x2022;</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Files changed */}
          {(entry.files_changed?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {entry.files_changed.map((file) => {
                const fileName = file.split("/").pop() ?? file;
                return (
                  <span
                    key={file}
                    title={file}
                    className="text-[10px] text-text-ghost bg-bg-elevated rounded px-1.5 py-px font-mono"
                  >
                    {fileName}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChangelogFeed() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionEntries = useChangelogStore((s) => s.sessionEntries);
  const generating = useChangelogStore((s) => s.generating);

  const entries = activeSessionId ? sessionEntries.get(activeSessionId) ?? [] : [];
  const isGenerating = activeSessionId ? generating.get(activeSessionId) ?? false : false;

  // Show most recent first
  const sortedEntries = [...entries].reverse();

  if (sortedEntries.length === 0 && !isGenerating) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <Sparkles size={24} className="text-text-ghost mb-2" />
        <p className="text-text-faint text-ui mb-1">No changelog entries yet</p>
        <p className="text-text-ghost text-label">
          Enable in Settings to auto-generate summaries of each coding turn.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-8">
      {isGenerating && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light text-text-dim text-label">
          <Loader2 size={12} className="animate-spin" />
          <span>Generating summary...</span>
        </div>
      )}
      {sortedEntries.map((entry) => (
        <ChangelogCard
          key={entry.id}
          entry={entry}
          sessionId={activeSessionId!}
        />
      ))}
    </div>
  );
}
