/**
 * SpecWriter Phase 0b — capability handshake UI.
 *
 * Renders inline in the SpecChat panel when the Phase 0a probe surfaced
 * `claimed-unverified` capabilities AND the user has
 * `selfDriveConfirmCapabilities` enabled. Each question is presented with
 * the option set built by `buildHandshakeQuestion` in capability-handshake-prompt.ts.
 *
 * Submitting calls `applyHandshakeAnswers` on the store, which dispatches
 * live-fire for "verify" answers, marks "absent" choices explicitly, and
 * persists the updated record. The banner disappears once all questions are
 * resolved; `ensureSession` is gated until that happens.
 *
 * See plan: ~/.claude/plans/analyse-this-why-refactored-yao.md
 */
import { useMemo, useState } from "react";
import { Sparkles, Loader2, Check } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import type { HandshakeOption } from "../../lib/capability-handshake-prompt";

interface CapabilityHandshakeBannerProps {
  projectPath: string;
}

export function CapabilityHandshakeBanner({ projectPath }: CapabilityHandshakeBannerProps) {
  const questions = useSpecWriterStore((s) => s.pendingHandshakeQuestions.get(projectPath));
  const applyHandshakeAnswers = useSpecWriterStore((s) => s.applyHandshakeAnswers);
  const [picks, setPicks] = useState<Record<string, HandshakeOption["action"]>>({});
  const [submitting, setSubmitting] = useState(false);

  const allAnswered = useMemo(
    () => (questions ?? []).every((q) => picks[q.capabilityId] !== undefined),
    [questions, picks],
  );

  if (!questions || questions.length === 0) return null;

  const handleSubmit = async () => {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    try {
      const answers = questions.map((q) => ({
        capabilityId: q.capabilityId,
        action: picks[q.capabilityId],
      }));
      await applyHandshakeAnswers(projectPath, answers);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="m-3 rounded-lg border px-4 py-3"
      style={{ background: "var(--accent-bg)", borderColor: "var(--accent)" }}
      data-testid="capability-handshake-banner"
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} style={{ color: "var(--accent)" }} />
        <span className="text-ui font-medium" style={{ color: "var(--accent)" }}>
          Confirm project capabilities ({questions.length})
        </span>
      </div>
      <p className="text-detail text-text-secondary mb-3">
        SpecWriter detected capabilities that need confirmation before writing acceptance criteria.
        Pick how each should be handled — your choices are saved to <code>.claude/project-capabilities.json</code>.
      </p>

      <div className="space-y-3">
        {questions.map((q) => (
          <div key={q.capabilityId} className="rounded-md border p-2.5" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
            <div className="text-ui font-medium text-text-primary mb-1.5">{q.question}</div>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const selected = picks[q.capabilityId] === opt.action;
                return (
                  <button
                    key={`${q.capabilityId}-${opt.action}-${opt.label}`}
                    type="button"
                    onClick={() =>
                      setPicks((prev) => ({ ...prev, [q.capabilityId]: opt.action }))
                    }
                    className={`px-2.5 py-1 rounded-md text-detail border transition-colors ${
                      selected
                        ? "border-accent text-accent"
                        : "border-border text-text-secondary hover:text-text-primary"
                    }`}
                    style={selected ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                    title={opt.description}
                  >
                    {selected ? <Check size={12} className="inline mr-1" /> : null}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className={`px-3 py-1.5 rounded-md text-ui font-medium transition-colors ${
            allAnswered && !submitting
              ? "bg-accent text-white"
              : "bg-bg-elevated text-text-ghost cursor-not-allowed"
          }`}
          style={
            allAnswered && !submitting
              ? { background: "var(--accent)", color: "white" }
              : undefined
          }
        >
          {submitting ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Verifying…
            </span>
          ) : (
            "Confirm & verify"
          )}
        </button>
      </div>
    </div>
  );
}
