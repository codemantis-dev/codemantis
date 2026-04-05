import { useState } from "react";
import { AlertTriangle, X, ChevronDown, ChevronRight } from "lucide-react";

interface ErrorCardProps {
  title: string;
  message: string;
  remediation?: string;
  rawError?: string;
  onDismiss?: () => void;
  compact?: boolean;
}

export default function ErrorCard({
  title,
  message,
  remediation,
  rawError,
  onDismiss,
  compact,
}: ErrorCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (compact) {
    return (
      <div
        className="mt-2 flex items-start gap-2.5 rounded-lg border border-red/20 px-3 py-2.5"
        style={{
          background: "rgba(248,113,113,0.06)",
          borderLeftWidth: "3px",
          borderLeftColor: "var(--red)",
        }}
      >
        <AlertTriangle size={14} className="text-red shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-text-primary">{title}</p>
          <p className="text-label text-text-secondary mt-0.5">{message}</p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 text-text-ghost hover:text-text-secondary transition-colors p-0.5 rounded"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-3 rounded-lg border border-red/20 px-4 py-3.5"
      style={{
        background: "rgba(248,113,113,0.06)",
        borderLeftWidth: "3px",
        borderLeftColor: "var(--red)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={15} className="text-red shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-text-primary">{title}</p>
          <p className="text-label text-text-secondary mt-1">{message}</p>

          {remediation && (
            <p className="text-label text-text-dim mt-2">
              <span className="font-medium text-text-secondary">How to fix: </span>
              {remediation}
            </p>
          )}

          {rawError && (
            <div className="mt-2">
              <button
                onClick={() => setShowDetails((v) => !v)}
                className="flex items-center gap-1 text-label text-text-ghost hover:text-text-dim transition-colors"
              >
                {showDetails ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Technical details
              </button>
              {showDetails && (
                <pre className="mt-1 text-label font-mono text-text-ghost rounded border border-border-light p-2 overflow-x-auto max-h-[120px] overflow-y-auto whitespace-pre-wrap break-all bg-bg-subtle">
                  {rawError}
                </pre>
              )}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 text-text-ghost hover:text-text-secondary transition-colors p-0.5 rounded"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
