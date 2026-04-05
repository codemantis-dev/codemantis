import { useEffect, useState } from "react";
import { ScrollText, RefreshCw, Loader2, Copy, Check, ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownLinkComponents } from "../../lib/external-links";
import { useSessionStore } from "../../stores/sessionStore";
import { useChangelogStore } from "../../stores/changelogStore";
import { CATEGORY_CONFIG } from "../../lib/changelog-utils";
import { useUiStore } from "../../stores/uiStore";
import type { ProjectChangelogEntry } from "../../types/changelog";

function ProjectLogCard({ entry }: { entry: ProjectChangelogEntry }) {
  const config = CATEGORY_CONFIG[entry.category] ?? CATEGORY_CONFIG.feature;
  const Icon = config.icon;
  const [copied, setCopied] = useState(false);
  const dateTime = new Date(entry.timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleCopy = async () => {
    const html = `<strong>${entry.headline}</strong><br>${entry.description}`;
    const plain = `${entry.headline}\n${entry.description}`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(plain);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="px-4 py-3 border-b border-border-light group">
      <div className="flex items-start gap-2.5">
        {/* Category icon */}
        <div className={`mt-0.5 shrink-0 ${config.color}`}>
          <Icon size={14} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Header: badge + session name + time */}
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-detail font-medium ${config.color} bg-bg-elevated rounded px-1 py-px`}>
              {config.label}
            </span>
            <span className="text-detail font-medium text-accent bg-accent-dim rounded px-1.5 py-px">
              {entry.session_name}
            </span>
            <span className="text-detail text-text-ghost ml-auto shrink-0">{dateTime}</span>
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-ghost hover:text-text-secondary transition-all"
              title="Copy entry"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
            </button>
          </div>

          {/* Headline */}
          <div className="changelog-markdown text-ui text-text-primary font-medium leading-tight mb-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownLinkComponents}>{entry.headline}</ReactMarkdown>
          </div>

          {/* Description */}
          <div className="changelog-markdown text-label text-text-dim leading-snug">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownLinkComponents}>{entry.description}</ReactMarkdown>
          </div>

          {/* Files changed */}
          {(entry.files_changed?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {entry.files_changed.map((file) => {
                const fileName = file.split("/").pop() ?? file;
                return (
                  <span
                    key={file}
                    title={file}
                    className="text-detail text-text-ghost bg-bg-elevated rounded px-1.5 py-px font-mono"
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

export default function ProjectLogFeed() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const projectEntries = useChangelogStore((s) => s.projectEntries);
  const loadProjectEntries = useChangelogStore((s) => s.loadProjectEntries);
  const setShowProjectLog = useUiStore((s) => s.setShowProjectLog);
  const [loading, setLoading] = useState(false);

  const entries = activeProjectPath ? projectEntries.get(activeProjectPath) : undefined;

  useEffect(() => {
    if (!activeProjectPath) return;
    setLoading(true);
    loadProjectEntries(activeProjectPath).finally(() => setLoading(false));
  }, [activeProjectPath, loadProjectEntries]);

  const handleRefresh = () => {
    if (!activeProjectPath) return;
    setLoading(true);
    loadProjectEntries(activeProjectPath).finally(() => setLoading(false));
  };

  if (!activeProjectPath) {
    return (
      <div className="h-full flex items-center justify-center text-text-ghost text-ui">
        No project selected
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-light shrink-0" style={{ background: "var(--bg-subtle)" }}>
        <ScrollText size={14} className="text-text-secondary shrink-0" />
        <span className="text-ui font-medium text-text-primary">Project Log</span>
        {entries && (
          <span className="text-detail text-text-ghost bg-bg-elevated rounded px-1.5 py-px">
            {entries.length}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowProjectLog(false)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          title="Back to Project"
        >
          <ArrowLeft size={12} />
          <span>Back</span>
        </button>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-1 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && !entries && (
          <div className="flex items-center justify-center gap-2 py-8 text-text-dim text-label">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading project log...</span>
          </div>
        )}

        {!loading && entries && entries.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center px-4 text-center">
            <ScrollText size={24} className="text-text-ghost mb-2" />
            <p className="text-text-faint text-ui mb-1">No changelog entries yet</p>
            <p className="text-text-ghost text-label">
              Enable changelog in Settings to auto-generate summaries of each coding turn.
            </p>
          </div>
        )}

        {entries && entries.length > 0 && entries.map((entry) => (
          <ProjectLogCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
