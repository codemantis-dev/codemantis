import { Check, XCircle, Minus } from "lucide-react";
import type { VerificationCheck } from "../../types/task-board";

interface Props {
  checks: VerificationCheck[];
}

export default function VerificationResults({ checks }: Props) {
  return (
    <div className="space-y-0.5 mt-1">
      {checks.map((check, i) => {
        const result = check.result;
        const Icon = result
          ? result.passed
            ? Check
            : XCircle
          : Minus;
        const color = result
          ? result.passed
            ? "#22c55e"
            : "#ef4444"
          : "var(--text-ghost)";

        return (
          <div key={i} className="flex items-start gap-1.5 text-[11px]">
            <Icon size={11} className="shrink-0 mt-0.5" style={{ color }} />
            <div className="min-w-0">
              <span style={{ color: "var(--text-secondary)" }}>
                [{check.type}] {check.description}
              </span>
              {result && !result.passed && (
                <div className="mt-0.5 opacity-70" style={{ color: "#ef4444" }}>
                  {result.evidence}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
