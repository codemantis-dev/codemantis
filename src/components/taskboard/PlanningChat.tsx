import { useRef, useEffect, useCallback } from "react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { usePlanningConversation } from "../../hooks/usePlanningConversation";
import PlanningChatMessage from "./PlanningChatMessage";
import PlanningChatInput from "./PlanningChatInput";

interface Props {
  projectPath: string;
}

export default function PlanningChat({ projectPath }: Props) {
  const conversation = useTaskBoardStore((s) => s.conversations.get(projectPath));
  const isStreaming = useTaskBoardStore((s) => s.planningStreaming.get(projectPath) ?? false);
  const setConversationStatus = useTaskBoardStore((s) => s.setConversationStatus);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { generatePlan } = usePlanningConversation();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.messages.length, isStreaming]);

  const handleGeneratePlan = useCallback(() => {
    setConversationStatus(projectPath, "planning");
    generatePlan(projectPath);
  }, [projectPath, generatePlan, setConversationStatus]);

  const messages = conversation?.messages ?? [];

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-3 py-2 text-xs font-medium border-b shrink-0"
        style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
      >
        Planning Chat
        {conversation && (
          <span className="ml-2 opacity-60">
            ({conversation.ai_provider}/{conversation.ai_model})
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
            Describe what you want to build. The AI will ask clarifying questions before generating a task plan.
          </div>
        )}
        {messages.map((msg) => (
          <PlanningChatMessage key={msg.id} message={msg} projectPath={projectPath} />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 py-1">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>Thinking...</span>
          </div>
        )}
      </div>

      {conversation?.status === "ready_to_plan" && (
        <div className="px-3 py-2 border-t" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={handleGeneratePlan}
            className="w-full py-2 px-3 rounded-md text-sm font-medium transition-colors hover:opacity-90"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Generate Plan
          </button>
        </div>
      )}

      <PlanningChatInput projectPath={projectPath} />
    </div>
  );
}
