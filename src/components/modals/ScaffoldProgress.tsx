import { useState, useEffect, useCallback } from "react";
import { Check, X, Loader2, AlertTriangle, Copy } from "lucide-react";
import { listenScaffoldProgress } from "../../lib/tauri-commands";
import type {
  TemplateEntry,
  ScaffoldStepName,
  ScaffoldStepStatus,
  ScaffoldProgressEvent,
} from "../../types/project-templates";
import { GIT_CLONE_STEPS, CLI_SCAFFOLD_STEPS } from "../../types/project-templates";

interface StepState {
  status: ScaffoldStepStatus;
  error?: string;
  output?: string;
}

interface ScaffoldProgressProps {
  template: TemplateEntry;
  projectName: string;
  resultPath: string | null;
  warnings: string[];
  scaffoldError: string | null;
  onOpenProject: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export default function ScaffoldProgress({
  template,
  projectName,
  resultPath,
  warnings,
  scaffoldError,
  onOpenProject,
  onRetry,
  onCancel,
}: ScaffoldProgressProps) {
  const steps = template.scaffold_type === "cli" ? CLI_SCAFFOLD_STEPS : GIT_CLONE_STEPS;
  const [stepStates, setStepStates] = useState<Map<ScaffoldStepName, StepState>>(new Map());
  const [complete, setComplete] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleProgress = useCallback((event: ScaffoldProgressEvent) => {
    if (event.step === "complete" && event.status === "done") {
      setComplete(true);
      return;
    }
    setStepStates((prev) => {
      const next = new Map(prev);
      next.set(event.step, {
        status: event.status,
        error: event.error,
        output: event.output,
      });
      return next;
    });
    if (event.status === "error") {
      setHasError(true);
    }
  }, []);

  useEffect(() => {
    const unlistenPromise = listenScaffoldProgress(handleProgress);
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [handleProgress]);

  // Also handle top-level scaffold errors (from the invoke reject)
  useEffect(() => {
    if (scaffoldError) setHasError(true);
  }, [scaffoldError]);

  function getStepIcon(stepName: ScaffoldStepName): React.ReactNode {
    const state = stepStates.get(stepName);
    if (!state || state.status === "pending") {
      return (
        <div className="w-4 h-4 rounded-full border border-border" />
      );
    }
    if (state.status === "in_progress") {
      return <Loader2 size={16} className="text-accent animate-spin" />;
    }
    if (state.status === "done") {
      return (
        <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
          <Check size={10} className="text-green-400" />
        </div>
      );
    }
    // error
    return (
      <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center">
        <X size={10} className="text-red-400" />
      </div>
    );
  }

  const isFinished = complete || resultPath !== null;
  const hasWarnings = warnings.length > 0;

  function copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text);
  }

  return (
    <div className="flex flex-col items-center px-4">
      <h3 className="text-text-primary text-base font-medium mb-1">
        {isFinished
          ? hasWarnings
            ? "Project ready (with warnings)"
            : "Project ready!"
          : `Setting up: ${projectName}`}
      </h3>
      {!isFinished && !hasError && (
        <p className="text-text-dim text-label mb-6">This may take a minute...</p>
      )}
      {isFinished && !hasWarnings && (
        <p className="text-text-dim text-label mb-6">Your project has been scaffolded successfully.</p>
      )}
      {isFinished && hasWarnings && (
        <p className="text-text-dim text-label mb-4">
          Project was created but some steps had issues.
        </p>
      )}

      {/* Step list */}
      <div className="w-full max-w-xs space-y-3 mb-4">
        {steps.map(({ step, label }) => {
          const state = stepStates.get(step);
          return (
            <div key={step}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getStepIcon(step)}</div>
                <div className="min-w-0 flex-1">
                  <span
                    className={`text-ui ${
                      state?.status === "in_progress"
                        ? "text-text-primary"
                        : state?.status === "done"
                          ? "text-text-secondary"
                          : state?.status === "error"
                            ? "text-red"
                            : "text-text-ghost"
                    }`}
                  >
                    {label}
                  </span>
                  {state?.error && (
                    <p className="text-label text-red/80 mt-0.5 break-words select-text">
                      {state.error}
                    </p>
                  )}
                </div>
              </div>
              {/* Collapsible command output for error steps */}
              {state?.output && state?.status === "error" && (
                <details className="ml-7 mt-1" open>
                  <summary className="text-label text-text-ghost cursor-pointer hover:text-text-dim select-none">
                    Show output
                  </summary>
                  <div className="relative mt-1">
                    <pre className="text-[11px] text-text-dim whitespace-pre-wrap select-text bg-bg-subtle rounded p-2 pr-8 max-h-40 overflow-y-auto font-mono">
                      {state.output}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(state.output ?? "")}
                      className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-bg-elevated text-text-ghost hover:text-text-dim transition-colors"
                      title="Copy output"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {/* Warnings summary */}
      {isFinished && hasWarnings && (
        <div className="w-full max-w-xs mb-4 rounded-lg bg-bg-subtle border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <AlertTriangle size={13} className="text-accent shrink-0" />
            <span className="text-text-secondary text-ui font-medium">
              {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </span>
          </div>
          <ul className="px-3 py-2 space-y-1">
            {warnings.map((w, i) => (
              <li key={`${w}-${i}`} className="text-text-dim text-label break-words select-text">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Top-level error */}
      {scaffoldError && !stepStates.size && (
        <p className="text-label text-red mb-4 text-center max-w-sm select-text">{scaffoldError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {isFinished ? (
          <button
            onClick={onOpenProject}
            className="px-6 py-2.5 rounded-lg bg-accent text-white text-ui font-medium hover:bg-accent-light transition-colors"
          >
            Open in CodeMantis
          </button>
        ) : hasError ? (
          <>
            {resultPath && (
              <button
                onClick={onOpenProject}
                className="px-4 py-2 rounded-lg border border-border text-text-secondary text-ui hover:bg-bg-elevated transition-colors"
              >
                Open Anyway
              </button>
            )}
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-lg bg-accent text-white text-ui font-medium hover:bg-accent-light transition-colors"
            >
              Retry
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-text-dim text-ui hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-text-dim text-ui hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
