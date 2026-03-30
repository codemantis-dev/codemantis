import { useState, useEffect } from "react";
import { Pencil, Eye, ClipboardCheck, FileDown } from "lucide-react";
import SpecPreview from "./SpecPreview";
import SavedSpecsList from "./SavedSpecsList";

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
  onCopySpec: () => void;
  onGenerateAudit: () => void;
  onOpenSaveAuditDialog: () => void;
  onOpenSaveSpecDialog: () => void;
  onLoadSpec: (content: string, filename: string) => void;
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
  onCopySpec,
  onGenerateAudit,
  onOpenSaveAuditDialog,
  onOpenSaveSpecDialog,
  onLoadSpec,
}: Props) {
  const [activeTab, setActiveTab] = useState<'spec' | 'audit'>('spec');

  // Auto-switch to audit tab when audit content first appears
  useEffect(() => {
    if (currentAuditContent) setActiveTab('audit');
  }, [currentAuditContent]);

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
        />
      </div>

      {/* Action buttons — Edit + Copy left, Audit/Save right */}
      {currentSpecContent && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2 shrink-0">
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
            <button
              onClick={onCopySpec}
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
