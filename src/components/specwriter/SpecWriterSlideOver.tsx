import { useEffect, useRef, useCallback, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSessionStore } from "../../stores/sessionStore";
import { showToast } from "../../stores/toastStore";
import { listSpecDocuments, gatherSpecContext, saveTaskBoardState, addVerificationWorkflowToClaudeMd } from "../../lib/tauri-commands";
import { useUiStore } from "../../stores/uiStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { useSpecConversationRouter } from "../../hooks/useSpecConversationRouter";
import { useDividerResize } from "../../hooks/useDividerResize";
import { useSavedSpecs } from "../../hooks/useSavedSpecs";
import { useGuideStore } from "../../stores/guideStore";
import SpecChat from "./SpecChat";
import SpecWriterToolbar from "./SpecWriterToolbar";
import SpecPreviewPanel from "./SpecPreviewPanel";
import SaveSpecDialog from "./SaveSpecDialog";

export default function SpecWriterSlideOver() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  // Grouped data selectors — single subscription with shallow comparison
  const { uiState, currentSpecContent, currentAuditContent, conversation, isStreaming } =
    useSpecWriterStore(
      useShallow((s) => ({
        uiState: activeProjectPath ? s.uiState.get(activeProjectPath) ?? null : null,
        currentSpecContent: activeProjectPath ? s.currentSpecContent.get(activeProjectPath) ?? null : null,
        currentAuditContent: activeProjectPath ? s.currentAuditContent.get(activeProjectPath) ?? null : null,
        conversation: activeProjectPath ? s.conversations.get(activeProjectPath) : undefined,
        isStreaming: activeProjectPath ? s.planningStreaming.get(activeProjectPath) ?? false : false,
      }))
    );

  // Action selectors — stable function refs, no re-render cost
  const setSlideOverOpen = useSpecWriterStore((s) => s.setSlideOverOpen);
  const setChatWidth = useSpecWriterStore((s) => s.setChatWidth);
  const clearConversation = useSpecWriterStore((s) => s.clearConversation);
  const setCurrentSpecContent = useSpecWriterStore((s) => s.setCurrentSpecContent);
  const setCurrentAuditContent = useSpecWriterStore((s) => s.setCurrentAuditContent);
  const persistState = useSpecWriterStore((s) => s.persistState);
  const loadState = useSpecWriterStore((s) => s.loadState);
  const setSavedSpecs = useSpecWriterStore((s) => s.setSavedSpecs);
  const setContextLoaded = useSpecWriterStore((s) => s.setContextLoaded);
  const setProjectContext = useSpecWriterStore((s) => s.setProjectContext);
  const addMessage = useSpecWriterStore((s) => s.addMessage);
  const setSelectedSavedSpec = useSpecWriterStore((s) => s.setSelectedSavedSpec);

  const isOpen = uiState?.is_open ?? false;
  const chatWidth = uiState?.chat_width ?? 40;

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogType, setSaveDialogType] = useState<'spec' | 'audit'>('spec');
  const [lastSavedFile, setLastSavedFile] = useState<string | null>(null);
  const [, setLastSavedAuditFile] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const hasGuide = useGuideStore((s) => s.guide !== null);
  const { sendMessage: sendChatMessage } = useClaudeSession();
  const { sendMessage: sendSpecMessage, writeSpec, generateAudit, cancelStream } = useSpecConversationRouter();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const conversationMode = conversation?.mode;
  const hasMessages = (conversation?.messages.length ?? 0) > 0;
  const canWrite = conversation?.status === 'ready_to_write' && !isStreaming;
  const canSave = !!currentSpecContent && !isStreaming;
  const canGenerateAudit = !!currentSpecContent && !currentAuditContent && !isStreaming;
  const canSaveAudit = !!currentAuditContent && !isStreaming;
  const initCheckedRef = useRef<string | null>(null);
  const contextAbortRef = useRef(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const handleWidthChange = useCallback(
    (newPct: number) => {
      if (activeProjectPath) {
        setChatWidth(activeProjectPath, newPct);
      }
    },
    [activeProjectPath, setChatWidth]
  );

  const { dividerRef, isDragging, handleDividerMouseDown } = useDividerResize({
    initialWidth: chatWidth,
    onWidthChange: handleWidthChange,
  });

  const { refreshSavedSpecs } = useSavedSpecs(activeProjectPath);

  // One-time project init: load persisted state and gather context
  useEffect(() => {
    if (!activeProjectPath) return;
    if (initCheckedRef.current === activeProjectPath) return;
    initCheckedRef.current = activeProjectPath;

    // Load persisted conversation
    loadState(activeProjectPath);

    // Load context for feature mode — store result for the system prompt
    contextAbortRef.current = false;
    setContextLoading(true);
    setContextError(null);
    gatherSpecContext(activeProjectPath).then((context) => {
      if (contextAbortRef.current) return;
      setProjectContext(activeProjectPath, context);
      setContextLoaded(activeProjectPath, true);
      setContextLoading(false);
    }).catch((e) => {
      if (contextAbortRef.current) return;
      console.error("[SpecWriter] Context gathering failed:", e);
      setContextError(String(e));
      setContextLoading(false);
    });

    // Load saved specs list
    listSpecDocuments(activeProjectPath).then((specs) => {
      setSavedSpecs(activeProjectPath, specs);
    }).catch(() => {});
  }, [activeProjectPath, loadState, setContextLoaded, setSavedSpecs, setProjectContext]);

  // Refresh saved specs each time the panel opens (may have changed while closed)
  useEffect(() => {
    if (!isOpen || !activeProjectPath) return;
    listSpecDocuments(activeProjectPath).then((specs) => {
      setSavedSpecs(activeProjectPath, specs);
    }).catch(() => {});
  }, [isOpen, activeProjectPath, setSavedSpecs]);

  // Abort context gathering if panel closes while loading
  useEffect(() => {
    if (!isOpen) {
      contextAbortRef.current = true;
      setContextLoading(false);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (activeProjectPath) {
      // Persist conversation state before closing
      persistState(activeProjectPath);
      setSlideOverOpen(activeProjectPath, false);
    }
  }, [activeProjectPath, setSlideOverOpen, persistState]);

  const handleCancelContext = useCallback(() => {
    contextAbortRef.current = true;
    setContextLoading(false);
    if (activeProjectPath) {
      setContextLoaded(activeProjectPath, false);
    }
  }, [activeProjectPath, setContextLoaded]);

  // Escape key closes
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  const handleSpecEdit = useCallback((newContent: string) => {
    if (activeProjectPath) {
      setCurrentSpecContent(activeProjectPath, newContent);
    }
  }, [activeProjectPath, setCurrentSpecContent]);

  const handleCloseSpec = useCallback(() => {
    if (activeProjectPath) {
      setCurrentSpecContent(activeProjectPath, null);
      setCurrentAuditContent(activeProjectPath, null);
      setSelectedSavedSpec(activeProjectPath, null);
      setIsEditing(false);
    }
  }, [activeProjectPath, setCurrentSpecContent, setCurrentAuditContent, setSelectedSavedSpec]);

  // Auto-exit edit mode when streaming starts
  useEffect(() => {
    if (isStreaming) setIsEditing(false);
  }, [isStreaming]);

  const handleReset = useCallback(() => {
    if (activeProjectPath) {
      clearConversation(activeProjectPath);
      setCurrentSpecContent(activeProjectPath, null);
      setCurrentAuditContent(activeProjectPath, null);
      setLastSavedFile(null);
      setLastSavedAuditFile(null);
      setIsEditing(false);
      // clearConversation already clears draft, but also wipe persisted state
      saveTaskBoardState(activeProjectPath, JSON.stringify({ conversation: null })).catch(() => {});
    }
  }, [activeProjectPath, clearConversation, setCurrentSpecContent, setCurrentAuditContent]);

  const handleCopySpec = useCallback(() => {
    if (currentSpecContent) {
      navigator.clipboard.writeText(currentSpecContent);
      showToast("Spec copied to clipboard", "success");
    }
  }, [currentSpecContent]);

  const handleWriteSpec = useCallback(() => {
    if (activeProjectPath) writeSpec(activeProjectPath);
  }, [activeProjectPath, writeSpec]);

  const handleGenerateAudit = useCallback(() => {
    if (activeProjectPath) generateAudit(activeProjectPath);
  }, [activeProjectPath, generateAudit]);

  const handleUseGuide = useCallback(() => {
    useUiStore.getState().setRightTab("guide");
    handleClose();
  }, [handleClose]);

  // ── Spec save handler ───────
  const handleSpecSaved = useCallback((filename: string) => {
    setShowSaveDialog(false);
    setLastSavedFile(filename);
    refreshSavedSpecs();
  }, [refreshSavedSpecs]);

  // ── Audit save handler — after save, show usage hint + CLAUDE.md offer ─
  const handleAuditSaved = useCallback((filename: string) => {
    setShowSaveDialog(false);
    setLastSavedAuditFile(filename);
    refreshSavedSpecs();

    if (!activeProjectPath) return;
    const store = useSpecWriterStore.getState();
    const specFilename = filename.replace('.audit.md', '.md');

    // Usage hint message
    store.addMessage(activeProjectPath, {
      id: `msg-audit-saved-${Date.now()}`,
      role: "system",
      content: `**Verification Audit saved to** \`docs/specs/${filename}\`\n\n**How to use it:**\n1. Tell Claude Code: "Read docs/specs/${specFilename} and implement it"\n2. After Claude Code says it's done, tell it:\n   "Read docs/specs/${filename} and verify your work. Open every file mentioned, read the actual code, and report PASS/FAIL for each item."\n3. Claude Code will find gaps and fix them.\n\n**Copy this prompt for after implementation:**\n\n\`\`\`\nRead docs/specs/${filename} and verify your implementation.\nFor every VERIFY directive, open the actual file and read the code.\nReport PASS, FAIL, or MISSING for each item. Fix all failures.\n\`\`\``,
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });

    // CLAUDE.md integration offer
    store.addMessage(activeProjectPath, {
      id: `msg-claudemd-offer-${Date.now()}`,
      role: "system",
      content: `**Add verification workflow to CLAUDE.md?**\nThis adds an instruction to your project's CLAUDE.md so Claude Code automatically runs the verification audit after implementing a spec. Claude Code reads CLAUDE.md at the start of every session.`,
      message_type: "conversation",
      timestamp: new Date().toISOString(),
      parsedOptions: [
        "\u{1F4DD} Yes, add to CLAUDE.md",
        "No, skip this",
      ],
    });
  }, [activeProjectPath, refreshSavedSpecs]);

  // ── Handle the combined save flow ────────────────────────────────
  const handleSaved = useCallback((filename: string) => {
    if (saveDialogType === 'audit') {
      handleAuditSaved(filename);
    } else {
      handleSpecSaved(filename);
    }
  }, [saveDialogType, handleSpecSaved, handleAuditSaved]);

  // ── Handle CLAUDE.md workflow addition ──────────────────────────
  const handleAddToClaudeMd = useCallback(async () => {
    if (!activeProjectPath) return;
    try {
      const result = await addVerificationWorkflowToClaudeMd(activeProjectPath);
      if (result === "already_exists") {
        showToast("Verification workflow already in CLAUDE.md", "info");
      } else {
        showToast("Added verification workflow to CLAUDE.md", "success");
      }
    } catch (e) {
      showToast(`Failed to update CLAUDE.md: ${e}`, "error");
    }
  }, [activeProjectPath]);

  // ── Option action handler — intercept special options ────────────
  const handleOptionAction = useCallback((option: string): boolean => {
    if (!activeProjectPath) return false;

    if (option === "\u{1F4CB} Yes, generate the Verification Audit") {
      generateAudit(activeProjectPath);
      return true;
    }
    if (option === "Not now \u2014 I'll generate it later") {
      // No action — toolbar button remains available
      return true;
    }
    if (option === "\u{1F4DD} Yes, add to CLAUDE.md") {
      handleAddToClaudeMd();
      return true;
    }
    if (option === "No, skip this") {
      // No action
      return true;
    }
    return false;
  }, [activeProjectPath, generateAudit, handleAddToClaudeMd]);

  // ── Open save dialog for spec or audit ────────────────────────────
  const openSaveSpecDialog = useCallback(() => {
    setSaveDialogType('spec');
    setShowSaveDialog(true);
  }, []);

  const openSaveAuditDialog = useCallback(() => {
    setSaveDialogType('audit');
    setShowSaveDialog(true);
  }, []);

  const handleSuggestFeatures = useCallback(() => {
    if (activeProjectPath) {
      sendSpecMessage(
        activeProjectPath,
        "Based on what you see in this project, what features or improvements would you suggest?"
      );
    }
  }, [activeProjectPath, sendSpecMessage]);

  const handleSendToChat = useCallback(async () => {
    if (!lastSavedFile || !activeSessionId) {
      showToast("No active chat session", "error");
      return;
    }
    await sendChatMessage(activeSessionId, `Read docs/specs/${lastSavedFile} for implementation`);
    showToast("Sent spec reference to chat", "success");
    handleClose();
  }, [lastSavedFile, activeSessionId, sendChatMessage, handleClose]);

  const handleImplement = useCallback(async () => {
    if (!lastSavedFile || !activeSessionId) {
      showToast("No active chat session", "error");
      return;
    }
    await sendChatMessage(activeSessionId,
      `Please implement the feature described in docs/specs/${lastSavedFile}. Follow the specification and implementation checklist.`
    );
    showToast("Implementation request sent", "success");
    handleClose();
  }, [lastSavedFile, activeSessionId, sendChatMessage, handleClose]);

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

  const handleToggleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
  }, []);

  if (!activeProjectPath) return null;

  // Determine save dialog content
  const saveDialogContent = saveDialogType === 'audit' ? currentAuditContent : currentSpecContent;

  return (
    <>
      {/* Backdrop — starts below title bar (h-12 = 48px) so window remains draggable */}
      {isOpen && (
        <div
          className="fixed left-0 right-0 bottom-0 z-40 transition-opacity duration-200"
          style={{ top: 48, background: "rgba(0,0,0,0.4)" }}
          onClick={handleClose}
        />
      )}

      {/* Slide-over panel — starts below title bar */}
      <div
        className="fixed right-0 bottom-0 z-50 flex flex-col transition-transform duration-250 ease-out"
        style={{
          top: 48,
          width: "80%",
          minWidth: 600,
          maxWidth: "92%",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          background: "var(--bg-primary)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <SpecWriterToolbar
          lastSavedFile={lastSavedFile}
          activeSessionId={activeSessionId}
          canWrite={canWrite}
          hasMessages={hasMessages}
          isStreaming={isStreaming}
          conversationMode={conversationMode}
          hasGuide={hasGuide}
          onSendToChat={handleSendToChat}
          onImplement={handleImplement}
          onUseGuide={handleUseGuide}
          onWriteSpec={handleWriteSpec}
          onReset={handleReset}
          onSuggestFeatures={handleSuggestFeatures}
          onClose={handleClose}
        />

        {/* Two-column content — always rendered, hidden via CSS when closed
             so hooks stay mounted and background streaming continues */}
        <div
          className="flex-1 overflow-hidden relative"
          style={{ display: isOpen ? 'flex' : 'none' }}
        >
          {/* Context loading overlay (feature mode only) */}
          {contextLoading && conversation?.mode === 'feature' && (
            <ContextLoadingOverlay
              projectPath={activeProjectPath}
              onCancel={handleCancelContext}
            />
          )}

          {/* Context error banner */}
          {contextError && (
            <div
              className="absolute top-0 left-0 right-0 z-10 px-4 py-2 text-ui flex items-center gap-2"
              style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
            >
              <span className="flex-1">Context loading failed: {contextError}</span>
              <button
                onClick={() => setContextError(null)}
                className="text-detail px-2 py-0.5 rounded border"
                style={{ borderColor: "rgba(239,68,68,0.3)" }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Left: Chat */}
          <div
            className="overflow-hidden flex flex-col"
            style={{ width: `${chatWidth}%` }}
          >
            <SpecChat
              projectPath={activeProjectPath}
              isOpen={isOpen}
              contextLoading={contextLoading}
              contextError={contextError}
              onOptionAction={handleOptionAction}
              sendMessage={sendSpecMessage}
              writeSpec={writeSpec}
              cancelStream={cancelStream}
            />
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
          <SpecPreviewPanel
            activeProjectPath={activeProjectPath}
            currentSpecContent={currentSpecContent}
            currentAuditContent={currentAuditContent}
            isEditing={isEditing}
            isStreaming={isStreaming}
            canGenerateAudit={canGenerateAudit}
            canSaveAudit={canSaveAudit}
            canSave={canSave}
            onSpecEdit={handleSpecEdit}
            onCloseSpec={handleCloseSpec}
            onToggleEdit={handleToggleEdit}
            onCopySpec={handleCopySpec}
            onGenerateAudit={handleGenerateAudit}
            onOpenSaveAuditDialog={openSaveAuditDialog}
            onOpenSaveSpecDialog={openSaveSpecDialog}
            onLoadSpec={handleLoadSpec}
          />
        </div>
      </div>

      {/* Save dialog — handles both spec and audit saves */}
      {showSaveDialog && saveDialogContent && conversation && (
        <SaveSpecDialog
          projectPath={activeProjectPath}
          specContent={saveDialogContent}
          aiModel={conversation.ai_model}
          mode={conversation.mode === 'feature' ? 'Feature (existing project)' : 'New Application'}
          documentType={saveDialogType}
          lastSavedFile={lastSavedFile}
          onClose={() => setShowSaveDialog(false)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

// ── Context Loading Overlay ─────────────────────────────────────

function ContextLoadingOverlay({ projectPath, onCancel }: { projectPath: string; onCancel: () => void }) {
  const projectName = projectPath.split("/").pop() ?? "project";

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      style={{ background: "var(--bg-primary)", opacity: 0.97 }}
    >
      <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
        {/* Spinner */}
        <div className="relative w-10 h-10">
          <div
            className="absolute inset-0 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
          />
        </div>

        <div>
          <h3
            className="text-chat font-medium mb-1"
            style={{ color: "var(--text-primary)" }}
          >
            Analyzing project...
          </h3>
          <p className="text-ui leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Scanning <strong>{projectName}</strong> to understand its structure —
            framework, dependencies, routes, components, hooks, stores, and existing specs.
          </p>
          <p className="text-detail mt-2" style={{ color: "var(--text-ghost)" }}>
            This context helps the AI write specifications that reference your actual codebase.
          </p>
        </div>

        <button
          onClick={onCancel}
          className="px-4 py-1.5 rounded-md text-ui transition-colors hover:brightness-95"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          Skip — start without context
        </button>
      </div>
    </div>
  );
}
