import { useEffect, useRef, useCallback, useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSessionStore } from "../../stores/sessionStore";
import { showToast } from "../../stores/toastStore";
import { listSpecDocuments, gatherSpecContext } from "../../lib/tauri-commands";
import SpecChat from "./SpecChat";
import SpecPreview from "./SpecPreview";
import SavedSpecsList from "./SavedSpecsList";
import SpecToolbar from "./SpecToolbar";
import SaveSpecDialog from "./SaveSpecDialog";

export default function SpecWriterSlideOver() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const uiState = useSpecWriterStore((s) =>
    activeProjectPath ? s.uiState.get(activeProjectPath) ?? null : null
  );
  const setSlideOverOpen = useSpecWriterStore((s) => s.setSlideOverOpen);
  const setChatWidth = useSpecWriterStore((s) => s.setChatWidth);
  const clearConversation = useSpecWriterStore((s) => s.clearConversation);
  const setCurrentSpecContent = useSpecWriterStore((s) => s.setCurrentSpecContent);
  const currentSpecContent = useSpecWriterStore((s) =>
    activeProjectPath ? s.currentSpecContent.get(activeProjectPath) ?? null : null
  );
  const conversation = useSpecWriterStore((s) =>
    activeProjectPath ? s.conversations.get(activeProjectPath) : undefined
  );
  const loadState = useSpecWriterStore((s) => s.loadState);
  const setSavedSpecs = useSpecWriterStore((s) => s.setSavedSpecs);
  const setContextLoaded = useSpecWriterStore((s) => s.setContextLoaded);
  const addMessage = useSpecWriterStore((s) => s.addMessage);

  const isOpen = uiState?.is_open ?? false;
  const chatWidth = uiState?.chat_width ?? 40;

  const dividerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [copiedClaudemd, setCopiedClaudemd] = useState(false);
  const [lastSavedFile, setLastSavedFile] = useState<string | null>(null);
  const initCheckedRef = useRef<string | null>(null);

  // When slide-over opens, load state and context
  useEffect(() => {
    if (!isOpen || !activeProjectPath) return;
    if (initCheckedRef.current === activeProjectPath) return;
    initCheckedRef.current = activeProjectPath;

    // Load persisted conversation
    loadState(activeProjectPath);

    // Load context for feature mode
    gatherSpecContext(activeProjectPath).then(() => {
      setContextLoaded(activeProjectPath, true);
    }).catch(() => {
      setContextLoaded(activeProjectPath, false);
    });

    // Load saved specs list
    listSpecDocuments(activeProjectPath).then((specs) => {
      setSavedSpecs(activeProjectPath, specs);
    }).catch(() => {});
  }, [isOpen, activeProjectPath, loadState, setContextLoaded, setSavedSpecs]);

  // Reset init check when slide-over closes
  useEffect(() => {
    if (!isOpen) {
      initCheckedRef.current = null;
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (activeProjectPath) {
      setSlideOverOpen(activeProjectPath, false);
    }
  }, [activeProjectPath, setSlideOverOpen]);

  // Escape key closes
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  // Divider drag
  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const containerEl = dividerRef.current?.parentElement;
      if (!containerEl) return;
      const containerWidth = containerEl.getBoundingClientRect().width;
      const startPct = chatWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dPct = (dx / containerWidth) * 100;
        const newPct = Math.max(25, Math.min(65, startPct + dPct));
        if (activeProjectPath) {
          setChatWidth(activeProjectPath, newPct);
        }
      };

      const onMouseUp = () => {
        setIsDragging(false);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [chatWidth, activeProjectPath, setChatWidth]
  );

  const handleNewSpec = useCallback(() => {
    if (activeProjectPath) {
      clearConversation(activeProjectPath);
      setCurrentSpecContent(activeProjectPath, null);
      setLastSavedFile(null);
    }
  }, [activeProjectPath, clearConversation, setCurrentSpecContent]);

  const handleCopySpec = useCallback(() => {
    if (currentSpecContent) {
      navigator.clipboard.writeText(currentSpecContent);
      showToast("Spec copied to clipboard", "success");
    }
  }, [currentSpecContent]);

  const handleSaved = useCallback((filename: string) => {
    setShowSaveDialog(false);
    setLastSavedFile(filename);
    // Refresh saved specs list
    if (activeProjectPath) {
      listSpecDocuments(activeProjectPath).then((specs) => {
        setSavedSpecs(activeProjectPath, specs);
      }).catch(() => {});
    }
  }, [activeProjectPath, setSavedSpecs]);

  const handleCopyClaudemdSnippet = useCallback(() => {
    if (lastSavedFile) {
      const snippet = `Read docs/specs/${lastSavedFile} for implementation`;
      navigator.clipboard.writeText(snippet);
      setCopiedClaudemd(true);
      setTimeout(() => setCopiedClaudemd(false), 2000);
    }
  }, [lastSavedFile]);

  const handleLoadSpec = useCallback((content: string, filename: string) => {
    if (!activeProjectPath) return;
    setCurrentSpecContent(activeProjectPath, content);
    // Add as system message so AI can reference it
    addMessage(activeProjectPath, {
      id: `msg-load-${Date.now()}`,
      role: "system",
      content: `Loaded existing spec "${filename}" for revision:\n\n${content}`,
      message_type: "context_summary",
      timestamp: new Date().toISOString(),
    });
  }, [activeProjectPath, setCurrentSpecContent, addMessage]);

  if (!activeProjectPath) return null;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 transition-opacity duration-200"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={handleClose}
        />
      )}

      {/* Slide-over panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-250 ease-out"
        style={{
          width: "80%",
          minWidth: 600,
          maxWidth: "92%",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          background: "var(--bg-primary)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div
          className="h-12 flex items-center justify-between px-4 border-b shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            SpecWriter
          </span>
          <button
            onClick={handleClose}
            title="Close SpecWriter"
            className="p-1 rounded hover:bg-bg-elevated transition-colors"
            style={{ color: "var(--text-ghost)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Two-column content — only mount children when open */}
        {isOpen && (
          <>
            <div className="flex flex-1 overflow-hidden">
              {/* Left: Chat */}
              <div
                className="overflow-hidden flex flex-col"
                style={{ width: `${chatWidth}%` }}
              >
                <SpecChat projectPath={activeProjectPath} />
              </div>

              {/* Divider */}
              <div
                ref={dividerRef}
                onMouseDown={handleDividerMouseDown}
                className="w-[5px] shrink-0 cursor-col-resize flex items-stretch justify-center"
              >
                <div
                  className="w-px transition-colors"
                  style={{
                    background: isDragging ? "var(--accent)" : "var(--border)",
                  }}
                />
              </div>

              {/* Right: Spec Preview + Actions + Saved Specs */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {/* Spec Preview */}
                <div className="flex-1 overflow-hidden">
                  <SpecPreview content={currentSpecContent} />
                </div>

                {/* Action buttons */}
                {currentSpecContent && (
                  <div className="flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: "var(--border)" }}>
                    <button
                      onClick={() => setShowSaveDialog(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
                      style={{ background: "var(--accent)", color: "white" }}
                    >
                      Save to Project
                    </button>
                    <button
                      onClick={handleCopySpec}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors hover:brightness-95"
                      style={{
                        background: "var(--bg-elevated)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                )}

                {/* CLAUDE.md integration tip */}
                {lastSavedFile && (
                  <div
                    className="flex items-center gap-2 px-3 py-2 border-t text-xs"
                    style={{ borderColor: "var(--border)", background: "var(--accent-bg)", color: "var(--accent)" }}
                  >
                    <span className="flex-1">
                      Add to CLAUDE.md: <code className="font-mono text-[10px]">Read docs/specs/{lastSavedFile} for implementation</code>
                    </span>
                    <button
                      onClick={handleCopyClaudemdSnippet}
                      title="Copy snippet"
                      className="p-1 rounded hover:bg-bg-elevated transition-colors"
                    >
                      {copiedClaudemd ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                )}

                {/* Saved Specs List */}
                <SavedSpecsList
                  projectPath={activeProjectPath}
                  onLoadSpec={handleLoadSpec}
                />
              </div>
            </div>

            {/* Bottom toolbar */}
            <SpecToolbar
              projectPath={activeProjectPath}
              onNewSpec={handleNewSpec}
              onSave={() => setShowSaveDialog(true)}
            />
          </>
        )}
      </div>

      {/* Save dialog */}
      {showSaveDialog && currentSpecContent && conversation && (
        <SaveSpecDialog
          projectPath={activeProjectPath}
          specContent={currentSpecContent}
          aiModel={conversation.ai_model}
          mode={conversation.mode === 'feature' ? 'Feature (existing project)' : 'New Application'}
          onClose={() => setShowSaveDialog(false)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
