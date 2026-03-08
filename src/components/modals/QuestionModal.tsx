import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MessageCircleQuestion, Check } from "lucide-react";
import { useActivityStore, type QuestionItem } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { respondToQuestion } from "../../lib/tauri-commands";

function TextQuestion({
  question,
  onSubmit,
}: {
  question: string;
  onSubmit: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");

  return (
    <div>
      <p className="text-ui text-text-primary mb-3">{question}</p>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Type your answer..."
        rows={3}
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 resize-none placeholder:text-text-ghost mb-3"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey && answer.trim()) {
            e.preventDefault();
            onSubmit(answer.trim());
          }
        }}
      />
      <div className="flex justify-end">
        <button
          onClick={() => onSubmit(answer.trim())}
          disabled={!answer.trim()}
          className={`px-4 py-2 rounded-lg text-ui font-medium transition-colors ${
            answer.trim()
              ? "bg-accent text-white hover:bg-accent-light"
              : "bg-bg-elevated text-text-ghost cursor-not-allowed"
          }`}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

function OptionQuestion({
  questionItem,
  onSubmit,
}: {
  questionItem: QuestionItem;
  onSubmit: (answer: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (value: string) => {
    if (questionItem.multiSelect) {
      const next = new Set(selected);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      setSelected(next);
    } else {
      // Single select — submit immediately
      onSubmit(value);
    }
  };

  const handleSubmitMulti = () => {
    if (selected.size > 0) {
      onSubmit(Array.from(selected).join(", "));
    }
  };

  return (
    <div>
      <p className="text-ui text-text-primary font-medium mb-2">{questionItem.header}</p>
      {questionItem.multiSelect && (
        <p className="text-label text-text-dim mb-2">Select one or more options</p>
      )}
      <div className="space-y-1.5 mb-3">
        {questionItem.options.map((opt) => {
          const isSelected = selected.has(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-3 ${
                isSelected
                  ? "border-accent bg-accent-dim text-text-primary"
                  : "border-border bg-bg-elevated text-text-secondary hover:border-accent/30 hover:bg-bg-subtle"
              }`}
            >
              {questionItem.multiSelect && (
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    isSelected ? "bg-accent border-accent" : "border-border"
                  }`}
                >
                  {isSelected && <Check size={10} className="text-white" />}
                </div>
              )}
              <div className="min-w-0">
                <span className="text-ui font-medium block">{opt.value}</span>
                {opt.description && opt.description !== opt.value && (
                  <span className="text-label text-text-dim block">{opt.description}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {questionItem.multiSelect && (
        <div className="flex justify-end">
          <button
            onClick={handleSubmitMulti}
            disabled={selected.size === 0}
            className={`px-4 py-2 rounded-lg text-ui font-medium transition-colors ${
              selected.size > 0
                ? "bg-accent text-white hover:bg-accent-light"
                : "bg-bg-elevated text-text-ghost cursor-not-allowed"
            }`}
          >
            Submit ({selected.size} selected)
          </button>
        </div>
      )}
    </div>
  );
}

export default function QuestionModal() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionQuestions = useActivityStore((s) => s.sessionQuestions);
  const showModal = useUiStore((s) => s.showQuestionModal);
  const setShowModal = useUiStore((s) => s.setShowQuestionModal);

  // Find the pending question
  let questionSessionId = activeSessionId;
  let pendingQuestion = activeSessionId
    ? sessionQuestions.get(activeSessionId) ?? null
    : null;

  if (!pendingQuestion) {
    for (const [sid, q] of sessionQuestions) {
      if (q) {
        pendingQuestion = q;
        questionSessionId = sid;
        break;
      }
    }
  }

  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);

  // Reset state when modal opens
  useEffect(() => {
    if (showModal) {
      setCurrentQuestionIdx(0);
      setAnswers([]);
    }
  }, [showModal]);

  const handleSubmit = useCallback(
    async (answer: string) => {
      if (!pendingQuestion || !questionSessionId) return;

      // If it's a simple question, send immediately
      if (pendingQuestion.question || !pendingQuestion.questions) {
        try {
          await respondToQuestion(questionSessionId, pendingQuestion.toolUseId, answer);
        } catch (e) {
          console.error("Failed to respond to question:", e);
        }
        useActivityStore.getState().setPendingQuestion(questionSessionId, null);
        setShowModal(false);
        return;
      }

      // Multi-question: accumulate answers
      const newAnswers = [...answers, answer];
      setAnswers(newAnswers);

      if (currentQuestionIdx < pendingQuestion.questions.length - 1) {
        setCurrentQuestionIdx(currentQuestionIdx + 1);
      } else {
        // All questions answered — send combined response
        const combined = newAnswers.join("\n");
        try {
          await respondToQuestion(questionSessionId, pendingQuestion.toolUseId, combined);
        } catch (e) {
          console.error("Failed to respond to questions:", e);
        }
        useActivityStore.getState().setPendingQuestion(questionSessionId, null);
        setShowModal(false);
      }
    },
    [pendingQuestion, questionSessionId, setShowModal, currentQuestionIdx, answers]
  );

  if (!pendingQuestion) return null;

  const hasOptions = pendingQuestion.questions && pendingQuestion.questions.length > 0;
  const currentQItem = hasOptions
    ? pendingQuestion.questions![currentQuestionIdx]
    : null;

  return (
    <Dialog.Root
      open={showModal}
      onOpenChange={(open) => {
        if (!open && pendingQuestion && questionSessionId) {
          // Dismiss = send empty response (skip)
          respondToQuestion(questionSessionId, pendingQuestion.toolUseId, "").catch(
            console.error
          );
          useActivityStore.getState().setPendingQuestion(questionSessionId, null);
        }
        setShowModal(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] max-h-[80vh] overflow-y-auto rounded-xl border border-border p-6" style={{ background: "var(--bg-primary)" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-accent/10">
              <MessageCircleQuestion size={20} className="text-accent" />
            </div>
            <div>
              <Dialog.Title className="text-text-primary font-medium">
                Claude has a question
              </Dialog.Title>
              <Dialog.Description className="text-ui text-text-dim">
                {hasOptions && pendingQuestion.questions!.length > 1
                  ? `Question ${currentQuestionIdx + 1} of ${pendingQuestion.questions!.length}`
                  : "Please respond to continue"}
              </Dialog.Description>
            </div>
          </div>

          {currentQItem ? (
            <OptionQuestion
              key={currentQuestionIdx}
              questionItem={currentQItem}
              onSubmit={handleSubmit}
            />
          ) : (
            <TextQuestion
              question={pendingQuestion.question ?? "Please provide your input:"}
              onSubmit={handleSubmit}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
