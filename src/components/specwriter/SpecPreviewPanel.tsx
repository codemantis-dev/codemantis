import { useEffect, useRef, useCallback } from "react";
import { Pencil, Eye, ClipboardCheck, FileDown, ScanSearch } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { showToast } from "../../stores/toastStore";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import SpecPreview from "./SpecPreview";
import SavedSpecsList from "./SavedSpecsList";
import CoveragePanel from "./CoveragePanel";
import type { CoverageAuditReport, InputAnalysis, StreamStats } from "../../types/spec-writer";

interface Props {
  activeProjectPath: string;
  currentSpecContent: string | null;
  currentAuditContent: string | null;
  isEditing: boolean;
  isStreaming: boolean;
  canGenerateAudit: boolean;
  canSaveAudit: boolean;
  canSave: boolean;
  onSpecEdit: (newContent: string) => void;
  onCloseSpec: () => void;
  onToggleEdit: () => void;
  onGenerateAudit: () => void;
  onOpenSaveAuditDialog: () => void;
  onOpenSaveSpecDialog: () => void;
  onLoadSpec: (content: string, filename: string) => void;
  /** Filename the Recognize Guide button targets (selected saved spec, else last-saved). */
  effectiveSpecFilename: string | null;
  /** True when the spec already has an Implementation Guide — hide Recognize Guide. */
  hasGuide: boolean;
  onRecognizeGuide: () => void;
  /** Stage 3: latest coverage audit on the produced spec (if any). */
  coverageReport?: CoverageAuditReport | null;
  /** Stage 3: latest input analysis on the user-attached input docs (if any). */
  inputAnalysis?: InputAnalysis | null;
  /** Stage 3: re-dispatch the recheck prompt. */
  onRecheck?: () => void;
  /** Stage 4: most recent stream metadata. */
  streamStats?: StreamStats | null;
}

export default function SpecPreviewPanel({
  activeProjectPath,
  currentSpecContent,
  currentAuditContent,
  isEditing,
  isStreaming,
  canGenerateAudit,
  canSaveAudit,
  canSave,
  onSpecEdit,
  onCloseSpec,
  onToggleEdit,
  onGenerateAudit,
  onOpenSaveAuditDialog,
  onOpenSaveSpecDialog,
  onLoadSpec,
  effectiveSpecFilename,
  hasGuide,
  onRecognizeGuide,
  coverageReport = null,
  inputAnalysis = null,
  onRecheck,
  streamStats = null,
}: Props) {
  // Tab state lives in the store keyed by projectPath so it survives project
  // switches (the slide-over stays mounted-but-hidden, so component-local
  // state would otherwise leak across projects).
  const { activeTab, auditPending, setActiveTab } = useSpecWriterStore(
    useShallow((s) => ({
      activeTab: s.specPreviewTab.get(activeProjectPath) ?? 'spec',
      auditPending: s.auditPending.get(activeProjectPath) ?? false,
      setActiveTab: s.setSpecPreviewTab,
    }))
  );

  // Per-project transition trackers: lets the auto-switch logic know whether
  // an audit (or coverage failure) has appeared since the last render *for this
  // project*, instead of being confused by a project switch.
  const prevHadAuditByProject = useRef<Map<string, boolean>>(new Map());
  const prevCoverageStatusByProject = useRef<Map<string, 'pass' | 'fail' | null>>(new Map());

  const hasCoverage = !!coverageReport || !!inputAnalysis || !!streamStats;
  const coverageFailureCount =
    (coverageReport?.failures.length ?? 0) +
    (inputAnalysis?.findings.filter((f) => f.severity === 'block').length ?? 0) +
    (streamStats && streamStats.status !== 'ok' ? 1 : 0);

  const handleCopy = useCallback(() => {
    const content = activeTab === 'audit' ? currentAuditContent : currentSpecContent;
    if (content) {
      navigator.clipboard.writeText(content);
      showToast("Copied to clipboard", "success");
    }
  }, [activeTab, currentAuditContent, currentSpecContent]);

  // Auto-switch tab only on transitions: show audit when it first appears (or
  // is pending), revert when cleared. The check uses a per-project memo so
  // switching to a different project mid-stream doesn't fire spurious switches.
  useEffect(() => {
    const auditVisible = !!currentAuditContent || auditPending;
    const hadAudit = prevHadAuditByProject.current.get(activeProjectPath) ?? false;
    prevHadAuditByProject.current.set(activeProjectPath, auditVisible);

    if (auditVisible && !hadAudit) {
      setActiveTab(activeProjectPath, 'audit');
    } else if (!auditVisible && hadAudit) {
      setActiveTab(activeProjectPath, 'spec');
    }
  }, [activeProjectPath, currentAuditContent, auditPending, setActiveTab]);

  // Auto-switch to Coverage when a new audit fails (mirrors the audit auto-switch above).
  useEffect(() => {
    const currentStatus = coverageReport?.status ?? null;
    const prevStatus = prevCoverageStatusByProject.current.get(activeProjectPath) ?? null;
    prevCoverageStatusByProject.current.set(activeProjectPath, currentStatus);
    if (currentStatus === 'fail' && prevStatus !== 'fail') {
      setActiveTab(activeProjectPath, 'coverage');
    }
  }, [activeProjectPath, coverageReport?.status, setActiveTab]);

  const handleTabChange = useCallback(
    (tab: 'spec' | 'audit' | 'coverage') => {
      setActiveTab(activeProjectPath, tab);
    },
    [activeProjectPath, setActiveTab]
  );

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Spec Preview */}
      <div className="flex-1 overflow-hidden">
        <SpecPreview
          content={currentSpecContent}
          auditContent={currentAuditContent}
          auditPending={auditPending}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isEditing={isEditing}
          onContentChange={onSpecEdit}
          onClose={onCloseSpec}
          hasCoverage={hasCoverage}
          coverageFailureCount={coverageFailureCount}
          coverageSlot={
            <CoveragePanel
              report={coverageReport}
              analysis={inputAnalysis}
              streamStats={streamStats}
              onRecheck={onRecheck ?? (() => {})}
              recheckInFlight={isStreaming}
            />
          }
        />
      </div>

      {/* Action buttons — Edit + Copy left, Audit/Save right (hidden on Coverage tab) */}
      {activeTab !== 'coverage' && (currentSpecContent || currentAuditContent) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2 shrink-0">
            {activeTab === 'spec' && (
              <button
                onClick={onToggleEdit}
                disabled={isStreaming}
                title={isEditing ? "Preview rendered markdown" : "Edit raw markdown"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ui font-medium transition-colors"
                style={isEditing ? {
                  background: "var(--accent)",
                  color: "white",
                } : {
                  background: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                {isEditing ? <Eye size={13} /> : <Pencil size={13} />}
                {isEditing ? "Preview" : "Edit"}
              </button>
            )}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ui transition-colors hover:brightness-95"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              Copy to Clipboard
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Generate Audit — only from Spec tab */}
            {activeTab === 'spec' && canGenerateAudit && (
              <button
                onClick={onGenerateAudit}
                disabled={isStreaming}
                title="Generate a Verification Audit companion document for the spec"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ui font-medium transition-colors hover:brightness-95 disabled:opacity-40"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                <ClipboardCheck size={13} />
                Generate Audit
              </button>
            )}

            {/* Context-aware Save — saves whichever document is active */}
            {activeTab === 'spec' && canSave && (
              <button
                onClick={onOpenSaveSpecDialog}
                title="Save specification to project"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ui font-medium transition-colors hover:opacity-90"
                style={{ background: "var(--accent)", color: "white" }}
              >
                <FileDown size={13} />
                Save Spec
              </button>
            )}
            {activeTab === 'audit' && canSaveAudit && (
              <button
                onClick={onOpenSaveAuditDialog}
                title="Save verification audit to project"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ui font-medium transition-colors hover:opacity-90"
                style={{ background: "var(--accent)", color: "white" }}
              >
                <FileDown size={13} />
                Save Audit
              </button>
            )}
            {activeTab === 'spec' && effectiveSpecFilename && !hasGuide && (
              <button
                onClick={onRecognizeGuide}
                title="Parse this spec for a Session Plan and create an Implementation Guide"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ui font-medium transition-colors hover:brightness-95"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                <ScanSearch size={13} />
                Recognize Guide
              </button>
            )}
          </div>
        </div>
      )}

      {/* Saved Specs List */}
      <SavedSpecsList
        projectPath={activeProjectPath}
        onLoadSpec={onLoadSpec}
      />
    </div>
  );
}
