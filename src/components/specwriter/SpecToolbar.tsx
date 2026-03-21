import { RotateCcw, PenTool, ClipboardCheck } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSpecConversation } from "../../hooks/useSpecConversation";

interface Props {
  projectPath: string;
  onReset: () => void;
  onSave: () => void;
  onSaveAudit: () => void;
}

export default function SpecToolbar({ projectPath, onReset, onSave, onSaveAudit }: Props) {
  const conversation = useSpecWriterStore((s) => s.conversations.get(projectPath));
  const isStreaming = useSpecWriterStore((s) => s.planningStreaming.get(projectPath) ?? false);
  const currentSpec = useSpecWriterStore((s) => s.currentSpecContent.get(projectPath));
  const currentAudit = useSpecWriterStore((s) => s.currentAuditContent.get(projectPath));
  const { writeSpec, generateAudit } = useSpecConversation();

  const status = conversation?.status;
  const canWrite = status === 'ready_to_write' && !isStreaming;
  const canSave = !!currentSpec && !isStreaming;
  const canGenerateAudit = !!currentSpec && !currentAudit && !isStreaming;
  const canSaveAudit = !!currentAudit && !isStreaming;
  const hasMessages = (conversation?.messages.length ?? 0) > 0;

  const handleWriteSpec = (): void => {
    writeSpec(projectPath);
  };

  const handleGenerateAudit = (): void => {
    generateAudit(projectPath);
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-t shrink-0"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      {hasMessages && (
        <button
          onClick={onReset}
          disabled={isStreaming}
          title="Reset — clear conversation and start fresh"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:brightness-95 disabled:opacity-40"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          <RotateCcw size={13} />
          Reset
        </button>
      )}

      <button
        onClick={handleWriteSpec}
        disabled={!canWrite}
        title="Tell the AI to generate the specification document"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90 disabled:opacity-40"
        style={{
          background: canWrite ? "var(--accent)" : "var(--bg-elevated)",
          color: canWrite ? "white" : "var(--text-dim)",
          border: canWrite ? "none" : "1px solid var(--border)",
        }}
      >
        <PenTool size={13} />
        Generate Spec
      </button>

      {canSave && (
        <button
          onClick={onSave}
          title="Save specification to project"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
          style={{ background: "var(--accent)", color: "white" }}
        >
          Save to Project
        </button>
      )}

      {canGenerateAudit && (
        <button
          onClick={handleGenerateAudit}
          disabled={isStreaming}
          title="Generate a Verification Audit companion document for the spec"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:brightness-95 disabled:opacity-40"
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

      {canSaveAudit && (
        <button
          onClick={onSaveAudit}
          title="Save verification audit to project"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
          style={{ background: "var(--accent)", color: "white" }}
        >
          <ClipboardCheck size={13} />
          Save Audit
        </button>
      )}

    </div>
  );
}
