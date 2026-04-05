import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Clipboard, FolderOpen, Loader2, Check, X, AlertTriangle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { cloneFromGit, listenScaffoldProgress } from "../../lib/tauri-commands";
import { useSettingsStore } from "../../stores/settingsStore";
import { showToast } from "../../stores/toastStore";
import type {
  ScaffoldStepName,
  ScaffoldStepStatus,
  ScaffoldProgressEvent,
  ScaffoldResult,
} from "../../types/project-templates";
import { GIT_CLONE_FROM_URL_STEPS } from "../../types/project-templates";

interface StepState {
  status: ScaffoldStepStatus;
  error?: string;
  output?: string;
}

interface CloneFormProps {
  onBack: () => void;
  onCloned: (projectPath: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** Extract project name from a git URL */
function extractProjectName(url: string): string | null {
  // Handle SSH: git@github.com:user/my-project.git
  const sshMatch = url.match(/:([^/]+?)(?:\.git)?$/);
  if (url.startsWith("git@") && sshMatch) {
    return sshMatch[1];
  }
  // Handle HTTPS: https://github.com/user/my-project.git or /my-project
  const httpsMatch = url.match(/\/([^/]+?)(?:\.git)?$/);
  return httpsMatch ? httpsMatch[1] : null;
}

/** Validate a git URL format */
function isValidGitUrl(url: string): boolean {
  if (!url.trim()) return false;
  // SSH format
  if (/^git@[\w.-]+:[\w./-]+(?:\.git)?$/.test(url)) return true;
  // HTTPS format
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

export default function CloneForm({ onBack, onCloned, onBusyChange }: CloneFormProps) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  // Form state
  const [repoUrl, setRepoUrl] = useState("");
  const [cloneTo, setCloneTo] = useState(settings.lastCloneDirectory ?? "");
  const [projectName, setProjectName] = useState("");
  const [installDeps, setInstallDeps] = useState(true);
  const [generateClaudeMd, setGenerateClaudeMd] = useState(true);

  // Validation
  const [urlTouched, setUrlTouched] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

  // Progress state
  const [cloning, setCloning] = useState(false);
  const [stepStates, setStepStates] = useState<Map<ScaffoldStepName, StepState>>(new Map());
  const [complete, setComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [result, setResult] = useState<ScaffoldResult | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onBusyChange?.(cloning);
  }, [cloning, onBusyChange]);

  // Auto-focus URL field on mount
  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  // Default clone directory
  useEffect(() => {
    if (!cloneTo) {
      setCloneTo(settings.lastCloneDirectory ?? "~/Projects");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: run once on mount

  // Auto-extract project name from URL
  useEffect(() => {
    if (!repoUrl) return;
    const name = extractProjectName(repoUrl.trim());
    if (name && !nameTouched) {
      setProjectName(name);
    }
  }, [repoUrl, nameTouched]);

  // Listen for scaffold progress events
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
    if (!cloning) return;
    const unlistenPromise = listenScaffoldProgress(handleProgress);
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [cloning, handleProgress]);

  // Validation helpers
  const urlError = urlTouched && repoUrl.trim() && !isValidGitUrl(repoUrl.trim())
    ? "Enter a valid Git repository URL"
    : null;

  const nameError = nameTouched && projectName.trim() && !/^[a-zA-Z0-9][\w.-]*$/.test(projectName.trim())
    ? "Must start with alphanumeric, only letters/numbers/hyphens/underscores/dots"
    : null;

  const canSubmit = repoUrl.trim() && isValidGitUrl(repoUrl.trim()) && cloneTo.trim() && projectName.trim() && !nameError && !cloning;

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRepoUrl(text);
        setUrlTouched(true);
      }
    } catch (e) {
      console.error("Failed to read clipboard:", e);
    }
  };

  const handleBrowse = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Clone Destination",
    });
    if (selected) {
      setCloneTo(selected as string);
    }
  };

  const handleClone = async () => {
    if (!canSubmit) return;

    setCloning(true);
    setStepStates(new Map());
    setComplete(false);
    setHasError(false);
    setCloneError(null);
    setResult(null);
    setWarnings([]);

    // Persist the clone directory
    updateSettings({ lastCloneDirectory: cloneTo });

    try {
      // Normalize URL: add .git if missing for GitHub/GitLab URLs
      let normalizedUrl = repoUrl.trim();
      if (
        !normalizedUrl.endsWith(".git") &&
        !normalizedUrl.startsWith("git@") &&
        (normalizedUrl.includes("github.com") || normalizedUrl.includes("gitlab.com") || normalizedUrl.includes("bitbucket.org"))
      ) {
        normalizedUrl += ".git";
      }

      const res = await cloneFromGit(
        normalizedUrl,
        cloneTo,
        projectName.trim(),
        installDeps,
        generateClaudeMd,
      );

      setResult(res);
      setWarnings(res.warnings);

      if (res.warnings.length > 0) {
        showToast("Project cloned with warnings", "info");
      } else {
        showToast("Project cloned and opened", "success");
      }
    } catch (e) {
      const msg = String(e);
      setCloneError(msg);
      setHasError(true);
    }
  };

  const handleOpenProject = () => {
    if (result) {
      onCloned(result.project_path);
    }
  };

  const handleRetry = () => {
    setCloning(false);
    setStepStates(new Map());
    setComplete(false);
    setHasError(false);
    setCloneError(null);
    setResult(null);
    setWarnings([]);
  };

  // Step icon renderer
  function getStepIcon(stepName: ScaffoldStepName): React.ReactNode {
    const state = stepStates.get(stepName);
    if (!state || state.status === "pending") {
      return <div className="w-4 h-4 rounded-full border border-border" />;
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
    return (
      <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center">
        <X size={10} className="text-red-400" />
      </div>
    );
  }

  const isFinished = complete || result !== null;

  // ── Cloning progress view ──
  if (cloning) {
    return (
      <div className="flex flex-col items-center">
        {/* Header */}
        <div className="text-center mb-4">
          <h3 className="text-text-primary text-base font-medium mb-0.5">
            {isFinished
              ? warnings.length > 0
                ? "Project ready (with warnings)"
                : "Project ready!"
              : `Cloning: ${projectName}`}
          </h3>
          <p className="text-text-dim text-label truncate max-w-[400px]">{repoUrl}</p>
          {!isFinished && !hasError && (
            <p className="text-text-dim text-label mt-0.5">This may take a minute...</p>
          )}
        </div>

        {/* Step list */}
        <div className="w-full max-w-sm space-y-2.5 mb-4">
          {GIT_CLONE_FROM_URL_STEPS.map(({ step, label }) => {
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
                    {state?.output && state?.status === "done" && state.output !== state.error && (
                      <p className="text-label text-text-ghost mt-0.5 truncate">
                        {state.output}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Warnings */}
        {isFinished && warnings.length > 0 && (
          <div className="w-full max-w-sm mb-3 rounded-lg bg-bg-subtle border border-border overflow-hidden">
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
        {cloneError && !stepStates.size && (
          <p className="text-label text-red mb-3 text-center select-text">{cloneError}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          {isFinished ? (
            <button
              onClick={handleOpenProject}
              className="px-6 py-2.5 rounded-lg bg-accent text-white text-ui font-medium hover:bg-accent-light transition-colors"
            >
              Open in CodeMantis
            </button>
          ) : hasError ? (
            <>
              {result && (
                <button
                  onClick={handleOpenProject}
                  className="px-4 py-2 rounded-lg border border-border text-text-secondary text-ui hover:bg-bg-elevated transition-colors"
                >
                  Open Anyway
                </button>
              )}
              <button
                onClick={handleRetry}
                className="px-4 py-2 rounded-lg bg-accent text-white text-ui font-medium hover:bg-accent-light transition-colors"
              >
                Retry
              </button>
              <button
                onClick={onBack}
                className="px-4 py-2 rounded-lg text-text-dim text-ui hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-lg text-text-dim text-ui hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Form view ──
  return (
    <div>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-text-dim text-label hover:text-text-secondary transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      {/* Repository URL */}
      <label className="block mb-3">
        <span className="text-text-secondary text-label mb-1 block">Repository URL</span>
        <div className="flex gap-2">
          <input
            ref={urlRef}
            type="text"
            value={repoUrl}
            onChange={(e) => {
              setRepoUrl(e.target.value);
              if (!urlTouched) setUrlTouched(true);
            }}
            onBlur={() => setUrlTouched(true)}
            placeholder="https://github.com/user/repo"
            className={`flex-1 px-3 py-2 rounded-lg bg-bg-subtle border text-text-primary text-ui placeholder:text-text-ghost outline-none focus:border-accent/50 transition-colors ${
              urlError ? "border-red/50" : "border-border"
            }`}
          />
          <button
            onClick={handlePasteFromClipboard}
            className="px-3 py-2 rounded-lg border border-border bg-bg-subtle text-text-dim hover:text-text-secondary hover:bg-bg-elevated transition-colors"
            title="Paste from clipboard"
          >
            <Clipboard size={15} />
          </button>
        </div>
        {urlError && (
          <p className="text-label text-red/80 mt-1">{urlError}</p>
        )}
      </label>

      {/* Clone to */}
      <label className="block mb-3">
        <span className="text-text-secondary text-label mb-1 block">Clone to</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={cloneTo}
            onChange={(e) => setCloneTo(e.target.value)}
            placeholder="~/Projects"
            className="flex-1 px-3 py-2 rounded-lg bg-bg-subtle border border-border text-text-primary text-ui placeholder:text-text-ghost outline-none focus:border-accent/50 transition-colors"
          />
          <button
            onClick={handleBrowse}
            className="px-3 py-2 rounded-lg border border-border bg-bg-subtle text-text-dim hover:text-text-secondary hover:bg-bg-elevated transition-colors flex items-center gap-1.5"
            title="Browse"
          >
            <FolderOpen size={15} />
          </button>
        </div>
      </label>

      {/* Project name */}
      <label className="block mb-4">
        <span className="text-text-secondary text-label mb-1 block">Project name</span>
        <input
          type="text"
          value={projectName}
          onChange={(e) => {
            setProjectName(e.target.value);
            setNameTouched(true);
          }}
          placeholder="my-project"
          className={`w-full px-3 py-2 rounded-lg bg-bg-subtle border text-text-primary text-ui placeholder:text-text-ghost outline-none focus:border-accent/50 transition-colors ${
            nameError ? "border-red/50" : "border-border"
          }`}
        />
        {nameError && (
          <p className="text-label text-red/80 mt-1">{nameError}</p>
        )}
        {!nameError && projectName && cloneTo && (
          <p className="text-label text-text-ghost mt-1 truncate">
            {cloneTo}/{projectName}/
          </p>
        )}
      </label>

      {/* Checkboxes */}
      <div className="space-y-2.5 mb-5">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={installDeps}
            onChange={(e) => setInstallDeps(e.target.checked)}
            className="rounded border-border accent-accent w-3.5 h-3.5"
          />
          <span className="text-text-secondary text-ui">Install dependencies after cloning</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={generateClaudeMd}
            onChange={(e) => setGenerateClaudeMd(e.target.checked)}
            className="rounded border-border accent-accent w-3.5 h-3.5"
          />
          <span className="text-text-secondary text-ui">Generate CLAUDE.md for AI-assisted development</span>
        </label>
      </div>

      {/* Submit */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-2.5 rounded-lg border border-border text-text-dim text-ui hover:text-text-secondary hover:bg-bg-elevated transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleClone}
          disabled={!canSubmit}
          className={`flex-1 py-2.5 rounded-lg text-ui font-medium transition-all ${
            canSubmit
              ? "bg-accent text-white hover:bg-accent-light"
              : "bg-bg-elevated text-text-ghost cursor-not-allowed"
          }`}
        >
          Clone & Open
        </button>
      </div>
    </div>
  );
}
