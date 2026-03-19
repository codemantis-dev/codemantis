import { FilePlus, PenTool, Lightbulb } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSpecConversation } from "../../hooks/useSpecConversation";

interface Props {
  projectPath: string;
  onNewSpec: () => void;
  onSave: () => void;
}

export default function SpecToolbar({ projectPath, onNewSpec, onSave }: Props) {
  const conversation = useSpecWriterStore((s) => s.conversations.get(projectPath));
  const isStreaming = useSpecWriterStore((s) => s.planningStreaming.get(projectPath) ?? false);
  const currentSpec = useSpecWriterStore((s) => s.currentSpecContent.get(projectPath));
  const { writeSpec, sendMessage } = useSpecConversation();

  const status = conversation?.status;
  const mode = conversation?.mode;
  const canWrite = status === 'ready_to_write' && !isStreaming;
  const canSave = !!currentSpec && !isStreaming;

  const handleWriteSpec = (): void => {
    writeSpec(projectPath);
  };

  const handleSuggestFeatures = (): void => {
    sendMessage(
      projectPath,
      "Based on what you see in this project, what features or improvements would you suggest?"
    );
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-t shrink-0"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      <button
        onClick={onNewSpec}
        title="New Spec"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:brightness-95"
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        <FilePlus size={13} />
        New Spec
      </button>

      <button
        onClick={handleWriteSpec}
        disabled={!canWrite}
        title="Write Spec"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90 disabled:opacity-40"
        style={{
          background: canWrite ? "var(--accent)" : "var(--bg-elevated)",
          color: canWrite ? "white" : "var(--text-dim)",
          border: canWrite ? "none" : "1px solid var(--border)",
        }}
      >
        <PenTool size={13} />
        Write Spec
      </button>

      {canSave && (
        <button
          onClick={onSave}
          title="Save to Project"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
          style={{ background: "var(--accent)", color: "white" }}
        >
          Save to Project
        </button>
      )}

      {mode === 'feature' && (
        <button
          onClick={handleSuggestFeatures}
          disabled={isStreaming}
          title="Suggest Features"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:brightness-95 disabled:opacity-40 ml-auto"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          <Lightbulb size={13} />
          Suggest Features
        </button>
      )}
    </div>
  );
}
