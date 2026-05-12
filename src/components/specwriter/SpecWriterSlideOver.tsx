import { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useGuideStore } from "../../stores/guideStore";
import { useDividerResize } from "../../hooks/useDividerResize";
import { useSpecWriterActions } from "../../hooks/useSpecWriterActions";
import SpecChat from "./SpecChat";
import SpecWriterToolbar from "./SpecWriterToolbar";
import SpecPreviewPanel from "./SpecPreviewPanel";
import SaveSpecDialog from "./SaveSpecDialog";
import GuideReplaceConfirmModal from "../modals/GuideReplaceConfirmModal";

export default function SpecWriterSlideOver() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  // Grouped data selectors — single subscription with shallow comparison
  const { uiState, currentSpecContent, currentAuditContent, conversation, isStreaming, coverageReport, inputAnalysis, streamStats, patchOutcome } =
    useSpecWriterStore(
      useShallow((s) => ({
        uiState: activeProjectPath ? s.uiState.get(activeProjectPath) ?? null : null,
        currentSpecContent: activeProjectPath ? s.currentSpecContent.get(activeProjectPath) ?? null : null,
        currentAuditContent: activeProjectPath ? s.currentAuditContent.get(activeProjectPath) ?? null : null,
        conversation: activeProjectPath ? s.conversations.get(activeProjectPath) : undefined,
        isStreaming: activeProjectPath ? s.planningStreaming.get(activeProjectPath) ?? false : false,
        coverageReport: activeProjectPath ? s.coverageReports.get(activeProjectPath) ?? null : null,
        inputAnalysis: activeProjectPath ? s.inputAnalysisReports.get(activeProjectPath) ?? null : null,
        streamStats: activeProjectPath ? s.streamStats.get(activeProjectPath) ?? null : null,
        patchOutcome: activeProjectPath ? s.lastPatchOutcomes.get(activeProjectPath) ?? null : null,
      }))
    );

  const setChatWidth = useSpecWriterStore((s) => s.setChatWidth);

  const isOpen = uiState?.is_open ?? false;
  const chatWidth = uiState?.chat_width ?? 40;
  const conversationMode = conversation?.mode;
  const hasMessages = (conversation?.messages.length ?? 0) > 0;
  const canWrite = conversation?.status === 'ready_to_write' && !isStreaming;
  const canSave = !!currentSpecContent && !isStreaming;
  const canGenerateAudit = !!currentSpecContent && !currentAuditContent && !isStreaming;
  const canSaveAudit = !!currentAuditContent && !isStreaming;

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const currentGuide = useGuideStore((s) => s.guide);

  // All callbacks, effects, and local state are in the extracted hook
  const actions = useSpecWriterActions(activeProjectPath);

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

  if (!activeProjectPath) return null;

  // Determine save dialog content
  const saveDialogContent = actions.saveDialogType === 'audit' ? currentAuditContent : currentSpecContent;

  return (
    <>
      {/* Backdrop — starts below title bar (h-12 = 48px) so window remains draggable */}
      {isOpen && (
        <div
          className="fixed left-0 right-0 bottom-0 z-40 transition-opacity duration-200"
          style={{ top: 48, background: "rgba(0,0,0,0.4)" }}
          onClick={actions.handleClose}
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
          lastSavedFile={actions.lastSavedFile}
          activeSessionId={activeSessionId}
          canWrite={canWrite}
          hasMessages={hasMessages}
          isStreaming={isStreaming}
          conversationMode={conversationMode}
          hasGuide={actions.hasGuide}
          onSendToChat={actions.handleSendToChat}
          onImplement={actions.handleImplement}
          onUseGuide={actions.handleUseGuide}
          onRecognizeGuide={actions.handleRecognizeGuide}
          onWriteSpec={actions.handleWriteSpec}
          onReset={actions.handleReset}
          onSuggestFeatures={actions.handleSuggestFeatures}
          onClose={actions.handleClose}
        />

        {/* Two-column content — always rendered, hidden via CSS when closed
             so hooks stay mounted and background streaming continues */}
        <div
          className="flex-1 overflow-hidden relative"
          style={{ display: isOpen ? 'flex' : 'none' }}
        >
          {/* Context loading overlay (feature mode only) */}
          {actions.contextLoading && conversation?.mode === 'feature' && (
            <ContextLoadingOverlay
              projectPath={activeProjectPath}
              onCancel={actions.handleCancelContext}
            />
          )}

          {/* Context error banner */}
          {actions.contextError && (
            <div
              className="absolute top-0 left-0 right-0 z-10 px-4 py-2 text-ui flex items-center gap-2"
              style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
            >
              <span className="flex-1">Context loading failed: {actions.contextError}</span>
              <button
                onClick={() => actions.setContextError(null)}
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
              contextLoading={actions.contextLoading}
              contextError={actions.contextError}
              onOptionAction={actions.handleOptionAction}
              onPromoteToSpec={actions.handlePromoteToSpec}
              sendMessage={actions.sendSpecMessage}
              writeSpec={actions.writeSpec}
              cancelStream={actions.cancelStream}
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
            isEditing={actions.isEditing}
            isStreaming={isStreaming}
            canGenerateAudit={canGenerateAudit}
            canSaveAudit={canSaveAudit}
            canSave={canSave}
            onSpecEdit={actions.handleSpecEdit}
            onCloseSpec={actions.handleCloseSpec}
            onToggleEdit={actions.handleToggleEdit}
            onGenerateAudit={actions.handleGenerateAudit}
            onOpenSaveAuditDialog={actions.openSaveAuditDialog}
            onOpenSaveSpecDialog={actions.openSaveSpecDialog}
            onLoadSpec={actions.handleLoadSpec}
            effectiveSpecFilename={actions.effectiveSpecFilename}
            hasGuide={actions.hasGuide}
            onRecognizeGuide={actions.handleRecognizeGuide}
            coverageReport={coverageReport}
            inputAnalysis={inputAnalysis}
            streamStats={streamStats}
            patchOutcome={patchOutcome}
            onRecheck={() => activeProjectPath && actions.requestRecheck(activeProjectPath)}
          />
        </div>
      </div>

      {/* Save dialog — handles both spec and audit saves */}
      {actions.showSaveDialog && saveDialogContent && conversation && (
        <SaveSpecDialog
          projectPath={activeProjectPath}
          specContent={saveDialogContent}
          aiModel={conversation.ai_model}
          aiProvider={conversation.ai_provider}
          mode={conversation.mode === 'feature' ? 'Feature (existing project)' : 'New Application'}
          documentType={actions.saveDialogType}
          lastSavedFile={actions.lastSavedFile}
          onClose={() => actions.setShowSaveDialog(false)}
          onSaved={actions.handleSaved}
        />
      )}

      <GuideReplaceConfirmModal
        open={actions.pendingGuideLoad !== null}
        currentGuideTitle={currentGuide?.title ?? ""}
        newSpecFilename={actions.pendingGuideLoad?.filename ?? ""}
        onConfirm={actions.handleConfirmGuideReplace}
        onCancel={() => actions.setPendingGuideLoad(null)}
      />
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
