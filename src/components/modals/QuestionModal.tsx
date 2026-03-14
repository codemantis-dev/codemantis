import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MessageCircleQuestion, Check, X } from "lucide-react";
import { useActivityStore, type QuestionItem } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { resolveToolApproval } from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";

function TextQuestion({
  question,
  onSubmit,
  onCancel,
}: {
  question: string;
  onSubmit: (answer: string) => void;
  onCancel: () => void;
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
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex justify-between">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-ui font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
        >
          Cancel
        </button>
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
  onCancel,
}: {
  questionItem: QuestionItem;
  onSubmit: (answer: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customAnswer, setCustomAnswer] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const toggle = (value: string) => {
    setShowCustom(false);
    setCustomAnswer("");
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

  const handleSubmitCustom = () => {
    if (customAnswer.trim()) {
      onSubmit(customAnswer.trim());
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
                <span className="text-ui font-medium block">{opt.label || opt.value}</span>
                {opt.description && opt.description !== opt.label && (
                  <span className="text-label text-text-dim block">{opt.description}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom free-text response */}
      {showCustom ? (
        <div className="mt-3">
          <textarea
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            placeholder="Type your own response..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 resize-none placeholder:text-text-ghost mb-2"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey && customAnswer.trim()) {
                e.preventDefault();
                handleSubmitCustom();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setShowCustom(false);
                setCustomAnswer("");
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowCustom(false); setCustomAnswer(""); }}
              className="px-3 py-1.5 rounded-lg text-label font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleSubmitCustom}
              disabled={!customAnswer.trim()}
              className={`px-3 py-1.5 rounded-lg text-label font-medium transition-colors ${
                customAnswer.trim()
                  ? "bg-accent text-white hover:bg-accent-light"
                  : "bg-bg-elevated text-text-ghost cursor-not-allowed"
              }`}
            >
              Submit
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCustom(true)}
          className="w-full text-left px-3 py-2.5 rounded-lg border border-dashed border-border text-text-dim hover:border-accent/30 hover:text-text-secondary transition-colors text-ui"
        >
          Write your own response...
        </button>
      )}

      {/* Footer: Cancel + Submit (multi-select) */}
      <div className="flex justify-between mt-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-ui font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
        >
          Cancel
        </button>
        {questionItem.multiSelect && (
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
        )}
      </div>
    </div>
  );
}

export default function QuestionModal() {
  const sessionQuestions = useActivityStore((s) => s.sessionQuestions);
  const showModal = useUiStore((s) => s.showQuestionModal);
  const setShowModal = useUiStore((s) => s.setShowQuestionModal);

  // Find the pending question from any session
  let questionSessionId: string | null = null;
  let pendingQuestion: ReturnType<typeof sessionQuestions.get> = null;

  for (const [sid, q] of sessionQuestions) {
    if (q) {
      pendingQuestion = q;
      questionSessionId = sid;
      break;
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

  const handleCancel = useCallback(() => {
    if (!pendingQuestion || !questionSessionId) return;
    resolveToolApproval(pendingQuestion.requestId, false, "User declined to answer").catch(
      (e) => console.error("Failed to cancel question:", e)
    );
    useActivityStore.getState().setPendingQuestion(questionSessionId, null);
    setShowModal(false);
  }, [pendingQuestion, questionSessionId, setShowModal]);

  /** Format answers so Claude unambiguously sees them as the user's response. */
  const formatAnswerForClaude = useCallback(
    (rawAnswers: string[]): string => {
      if (!pendingQuestion) return rawAnswers.join("\n");

      // Simple text question
      if (pendingQuestion.question || !pendingQuestion.questions) {
        return `The user answered: ${rawAnswers[0]}`;
      }

      // Multi-question: pair each answer with its question header
      const lines = pendingQuestion.questions.map((q, i) => {
        const ans = rawAnswers[i] ?? "(no answer)";
        return `${q.header}: ${ans}`;
      });
      return `The user answered the questions as follows:\n${lines.join("\n")}`;
    },
    [pendingQuestion]
  );

  const handleSubmit = useCallback(
    async (answer: string) => {
      if (!pendingQuestion || !questionSessionId) return;

      // Simple question or text question
      if (pendingQuestion.question || !pendingQuestion.questions) {
        try {
          const formatted = formatAnswerForClaude([answer]);
          await resolveToolApproval(pendingQuestion.requestId, false, formatted);
        } catch (e) {
          console.error("Failed to send answer:", e);
          showToast("Failed to send answer", "error");
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
        // All questions answered
        try {
          const formatted = formatAnswerForClaude(newAnswers);
          await resolveToolApproval(pendingQuestion.requestId, false, formatted);
        } catch (e) {
          console.error("Failed to send answers:", e);
          showToast("Failed to send answers", "error");
        }
        useActivityStore.getState().setPendingQuestion(questionSessionId, null);
        setShowModal(false);
      }
    },
    [pendingQuestion, questionSessionId, setShowModal, currentQuestionIdx, answers, formatAnswerForClaude]
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
        if (!open) {
          handleCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] max-h-[80vh] overflow-y-auto rounded-xl border border-border p-6"
          style={{ background: "var(--bg-primary)" }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            handleCancel();
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-accent/10">
              <MessageCircleQuestion size={20} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-text-primary font-medium">
                Claude has a question
              </Dialog.Title>
              <Dialog.Description className="text-ui text-text-dim">
                {hasOptions && pendingQuestion.questions!.length > 1
                  ? `Question ${currentQuestionIdx + 1} of ${pendingQuestion.questions!.length}`
                  : "Please respond to continue"}
              </Dialog.Description>
            </div>
            <button
              onClick={handleCancel}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
              title="Cancel (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          {currentQItem ? (
            <OptionQuestion
              key={currentQuestionIdx}
              questionItem={currentQItem}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          ) : (
            <TextQuestion
              question={pendingQuestion.question ?? "Please provide your input:"}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
