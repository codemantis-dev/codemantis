import { useState, useEffect, useRef, useCallback } from "react";
import { Pencil, Eye, ClipboardCheck, FileDown, ScanSearch } from "lucide-react";
import { showToast } from "../../stores/toastStore";
import SpecPreview, { type SpecPreviewTab } from "./SpecPreview";
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
  const [activeTab, setActiveTab] = useState<SpecPreviewTab>(currentAuditContent ? 'audit' : 'spec');
  const prevHadAuditRef = useRef(!!currentAuditContent);
  const prevCoverageStatusRef = useRef<'pass' | 'fail' | null>(coverageReport?.status ?? null);

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

  // Auto-switch tab only on transitions: show audit when it first appears, revert when cleared
  useEffect(() => {
    const hadAudit = prevHadAuditRef.current;
    prevHadAuditRef.current = !!currentAuditContent;

    if (currentAuditContent && !hadAudit) {
      setActiveTab('audit');
    } else if (!currentAuditContent && hadAudit) {
      setActiveTab('spec');
    }
  }, [currentAuditContent]);

  // Auto-switch to Coverage when a new audit fails (mirrors the audit auto-switch above).
  useEffect(() => {
    const prevStatus = prevCoverageStatusRef.current;
    const currentStatus = coverageReport?.status ?? null;
    prevCoverageStatusRef.current = currentStatus;
    if (currentStatus === 'fail' && prevStatus !== 'fail') {
      setActiveTab('coverage');
    }
  }, [coverageReport?.status]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Spec Preview */}
      <div className="flex-1 overflow-hidden">
        <SpecPreview
          content={currentSpecContent}
          auditContent={currentAuditContent}
          activeTab={activeTab}
          onTabChange={setActiveTab}
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
