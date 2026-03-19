import { useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Check, X as XIcon } from "lucide-react";

interface Props {
  wpName: string;
  passCount: number;
  totalCount: number;
  checks: { description: string; passed: boolean; evidence: string }[];
  filesChanged: string[];
  hasConsoleErrors: boolean;
}

export default function ProgressUpdateMessage({
  wpName,
  passCount,
  totalCount,
  checks,
  filesChanged,
  hasConsoleErrors,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-md px-3 py-2 text-xs"
      style={{ background: "var(--accent-bg)", color: "var(--text-secondary)" }}
    >
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <BarChart3 size={14} />
        <span className="font-medium">
          Work Package "{wpName}" completed. {passCount}/{totalCount} checks passed.
        </span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>

      {expanded && (
        <div className="mt-2 ml-5 space-y-1">
          {checks.map((c, i) => (
            <div key={i} className="flex items-start gap-1.5">
              {c.passed ? (
                <Check size={12} className="shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
              ) : (
                <XIcon size={12} className="shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
              )}
              <div>
                <span>{c.description}</span>
                {!c.passed && (
                  <div className="opacity-60 mt-0.5">{c.evidence}</div>
                )}
              </div>
            </div>
          ))}

          {filesChanged.length > 0 && (
            <div className="mt-2 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
              <span className="font-medium">Files changed:</span>
              <div className="mt-0.5 opacity-70">
                {filesChanged.slice(0, 10).map((f, i) => (
                  <div key={i}>{f}</div>
                ))}
                {filesChanged.length > 10 && (
                  <div>... and {filesChanged.length - 10} more</div>
                )}
              </div>
            </div>
          )}

          {hasConsoleErrors && (
            <div className="mt-1 flex items-center gap-1" style={{ color: "#f59e0b" }}>
              Console errors detected in preview
            </div>
          )}
        </div>
      )}
    </div>
  );
}
