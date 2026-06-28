// A dismissible, TriviaCard-styled coaching tip for the Branch Map. Dismissal
// persists per-key in localStorage so each lesson shows once. Used for the
// first-visit "What's a branch?" intro.

import { useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { isCoachTipDismissed, dismissCoachTip } from "../../lib/branchmap/coach-storage";

interface BranchCoachTipProps {
  /** Stable key; once dismissed, this tip stays hidden. */
  tipKey: string;
  title: string;
  children: React.ReactNode;
}

export default function BranchCoachTip({ tipKey, title, children }: BranchCoachTipProps) {
  const [dismissed, setDismissed] = useState(true);

  // Read persisted state on mount (default hidden until we know it's unseen).
  useEffect(() => {
    setDismissed(isCoachTipDismissed(tipKey));
  }, [tipKey]);

  const dismiss = () => {
    dismissCoachTip(tipKey);
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div
      className="mx-4 mt-3 rounded-xl border border-border bg-bg-elevated p-3 animate-trivia-fade-in"
      data-testid="branch-coach-tip"
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-accent/10">
          <Lightbulb size={14} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-label font-medium text-text-primary mb-0.5">{title}</div>
          <div className="text-label text-text-secondary leading-snug">{children}</div>
        </div>
        <button
          onClick={dismiss}
          title="Got it"
          className="p-1 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-subtle transition-colors shrink-0"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
