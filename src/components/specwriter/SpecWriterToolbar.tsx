import { X, Send, Play, PenTool, RotateCcw, Lightbulb, BookOpen, ScanSearch } from "lucide-react";

interface Props {
  lastSavedFile: string | null;
  activeSessionId: string | null;
  canWrite: boolean;
  hasMessages: boolean;
  isStreaming: boolean;
  conversationMode: string | undefined;
  hasGuide: boolean;
  onSendToChat: () => void;
  onImplement: () => void;
  onUseGuide: () => void;
  onRecognizeGuide: () => void;
  onWriteSpec: () => void;
  onReset: () => void;
  onSuggestFeatures: () => void;
  onClose: () => void;
}

export default function SpecWriterToolbar({
  lastSavedFile,
  activeSessionId,
  canWrite,
  hasMessages,
  isStreaming,
  conversationMode,
  hasGuide,
  onSendToChat,
  onImplement,
  onUseGuide,
  onRecognizeGuide,
  onWriteSpec,
  onReset,
  onSuggestFeatures,
  onClose,
}: Props) {
  return (
    <div
      className="h-10 flex items-center gap-2 px-4 border-b shrink-0"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      <span className="text-chat font-medium mr-1" style={{ color: "var(--text-primary)" }}>
        SpecWriter
      </span>

      {/* Send to Chat + Implement — visible after spec is saved */}
      {lastSavedFile && (
        <>
          <button
            onClick={onSendToChat}
            disabled={!activeSessionId}
            title={activeSessionId ? "Send spec reference to active chat" : "No active chat session"}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-label font-medium transition-colors hover:brightness-95 disabled:opacity-40"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            <Send size={14} />
            Send to Chat
          </button>
          <button
            onClick={onImplement}
            disabled={!activeSessionId}
            title={activeSessionId ? "Send to main chat for all-at-once implementation" : "No active chat session"}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-label font-medium transition-colors hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Play size={14} />
            Implement
          </button>
          {hasGuide && (
            <button
              onClick={onUseGuide}
              title="Close SpecWriter and follow the step-by-step guide (recommended for complex specs)"
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-label font-medium transition-colors hover:brightness-95"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              <BookOpen size={14} />
              Use Guide
            </button>
          )}
          {!hasGuide && (
            <button
              onClick={onRecognizeGuide}
              title="Re-analyze spec for a multi-session plan and create an implementation guide"
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-label font-medium transition-colors hover:brightness-95"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              <ScanSearch size={14} />
              Recognize Guide
            </button>
          )}
        </>
      )}

      {/* Generate Spec */}
      <button
        onClick={onWriteSpec}
        disabled={!canWrite}
        title="Tell the AI to generate the specification document"
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-label font-medium transition-colors hover:opacity-90 disabled:opacity-40"
        style={{
          background: canWrite ? "var(--accent)" : "var(--bg-elevated)",
          color: canWrite ? "white" : "var(--text-dim)",
          border: canWrite ? "none" : "1px solid var(--border)",
        }}
      >
        <PenTool size={14} />
        Generate Spec
      </button>

      {/* Reset */}
      {hasMessages && (
        <button
          onClick={onReset}
          disabled={isStreaming}
          title="Reset — clear conversation and start fresh"
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-label font-medium transition-colors hover:brightness-95 disabled:opacity-40"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          <RotateCcw size={14} />
          Reset
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Suggest Features */}
      {conversationMode === 'feature' && (
        <button
          onClick={onSuggestFeatures}
          disabled={isStreaming}
          title="Ask the AI to suggest features for this project"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-label font-medium transition-colors hover:brightness-95 disabled:opacity-40"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          <Lightbulb size={14} />
          Suggest Features
        </button>
      )}

      {/* Close */}
      <button
        onClick={onClose}
        title="Close SpecWriter"
        className="p-1 rounded hover:bg-bg-elevated transition-colors"
        style={{ color: "var(--text-ghost)" }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
