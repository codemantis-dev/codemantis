import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ExternalLink, Check, X, RefreshCw, Download, Loader2 } from "lucide-react";
import {
  Zap, Component, Triangle, CreditCard, FolderTree,
  Server, Database, Rocket, Smartphone, Globe,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { TemplateEntry, PrerequisiteResult } from "../../types/project-templates";
import { checkTemplatePrerequisites, installPrerequisite } from "../../lib/tauri-commands";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  zap: Zap,
  component: Component,
  triangle: Triangle,
  "credit-card": CreditCard,
  "folder-tree": FolderTree,
  server: Server,
  database: Database,
  rocket: Rocket,
  smartphone: Smartphone,
  globe: Globe,
};

const LAST_SCAFFOLD_DIR_KEY = "codemantis-last-scaffold-dir";

function getLastScaffoldDir(): string {
  return localStorage.getItem(LAST_SCAFFOLD_DIR_KEY) ?? "";
}

function saveLastScaffoldDir(dir: string): void {
  localStorage.setItem(LAST_SCAFFOLD_DIR_KEY, dir);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface TemplateDetailProps {
  template: TemplateEntry;
  onBack: () => void;
  onUseTemplate: (template: TemplateEntry, parentDir: string, projectName: string) => void;
}

export default function TemplateDetail({ template, onBack, onUseTemplate }: TemplateDetailProps) {
  const [projectName, setProjectName] = useState(slugify(template.name));
  const [parentDir, setParentDir] = useState(getLastScaffoldDir);
  const [nameError, setNameError] = useState<string | null>(null);
  const [prereqResults, setPrereqResults] = useState<PrerequisiteResult[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const Icon = ICON_MAP[template.icon] ?? Zap;

  const runChecks = useCallback(() => {
    if (!template.prerequisite_checks?.length) return;
    setChecking(true);
    checkTemplatePrerequisites(template.prerequisite_checks)
      .then(setPrereqResults)
      .catch(() => setPrereqResults(null))
      .finally(() => setChecking(false));
  }, [template.id]);

  // Check prerequisites on mount
  useEffect(() => { runChecks(); }, [runChecks]);

  const hasRequiredMissing = prereqResults?.some((r) => r.required && !r.found) ?? false;
  const hasMissing = prereqResults?.some((r) => !r.found) ?? false;

  // Find the install_command for a given prerequisite from template data
  const getInstallCommand = (command: string): string | undefined =>
    template.prerequisite_checks?.find((c) => c.command === command)?.install_command;

  const handleInstall = async (prereqCommand: string) => {
    const installCmd = getInstallCommand(prereqCommand);
    if (!installCmd) return;

    setInstalling(prereqCommand);
    setInstallError(null);

    try {
      const result = await installPrerequisite(installCmd);
      if (result.success) {
        // Re-check all prerequisites after successful install
        runChecks();
      } else {
        setInstallError(result.output || `Failed to install: ${installCmd}`);
      }
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(null);
    }
  };

  const handlePickDir = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose project location",
      defaultPath: parentDir || undefined,
    });
    if (selected) {
      setParentDir(selected as string);
      saveLastScaffoldDir(selected as string);
    }
  };

  const handleSubmit = () => {
    const trimmed = projectName.trim();
    if (!trimmed) {
      setNameError("Project name is required");
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
      setNameError("Only letters, numbers, hyphens, underscores, dots");
      return;
    }
    if (trimmed.startsWith(".") || trimmed.startsWith("-")) {
      setNameError("Cannot start with '.' or '-'");
      return;
    }
    if (!parentDir) {
      setNameError("Choose a location first");
      return;
    }
    setNameError(null);
    onUseTemplate(template, parentDir, trimmed);
  };

  const canSubmit = projectName.trim() && parentDir && !nameError && !hasRequiredMissing;

  return (
    <div className="flex flex-col h-full">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-text-dim hover:text-text-secondary text-label mb-4 transition-colors self-start"
      >
        <ArrowLeft size={14} />
        Back to templates
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
          <Icon size={20} className="text-accent" />
        </div>
        <div className="min-w-0">
          <h3 className="text-text-primary text-base font-medium">{template.name}</h3>
          <div className="flex items-center gap-3 mt-0.5">
            {template.stars && (
              <span className="text-label text-text-dim">
                {template.stars >= 1000
                  ? `${(template.stars / 1000).toFixed(1).replace(/\.0$/, "")}K`
                  : template.stars}{" "}
                stars
              </span>
            )}
            <span className="text-label text-text-dim">{template.license}</span>
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {template.tags.map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 rounded-md text-[11px] bg-bg-elevated text-text-secondary"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Description */}
      <p className="text-text-secondary text-ui leading-relaxed mb-4">
        {template.long_description ?? template.description}
      </p>

      {/* Prerequisite checks */}
      {prereqResults && prereqResults.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2.5 mb-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-label text-text-dim">Prerequisites</span>
            {hasMissing && (
              <button
                onClick={runChecks}
                disabled={checking}
                title="Re-check prerequisites"
                className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text-secondary transition-colors"
              >
                <RefreshCw size={10} className={checking ? "animate-spin" : ""} />
                Re-check
              </button>
            )}
          </div>
          {prereqResults.map((r) => (
            <div key={r.command} className="flex items-center gap-2 text-label">
              {r.found ? (
                <Check size={13} className="text-green shrink-0" />
              ) : (
                <X size={13} className={`shrink-0 ${r.required ? "text-red" : "text-text-dim"}`} />
              )}
              <span className={r.found ? "text-text-secondary" : r.required ? "text-red" : "text-text-dim"}>
                {r.label}
              </span>
              {!r.found && !r.required && (
                <span className="text-text-ghost text-[10px]">optional</span>
              )}
              {!r.found && r.required && (
                <span className="text-red/60 text-[10px]">required</span>
              )}
              {!r.found && getInstallCommand(r.command) && (
                <button
                  onClick={() => handleInstall(r.command)}
                  disabled={installing !== null}
                  title={`Run: ${getInstallCommand(r.command)}`}
                  className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                >
                  {installing === r.command ? (
                    <>
                      <Loader2 size={10} className="animate-spin" />
                      Installing...
                    </>
                  ) : (
                    <>
                      <Download size={10} />
                      Install
                    </>
                  )}
                </button>
              )}
            </div>
          ))}
          {installError && (
            <p className="text-red text-[10px] mt-1 leading-snug break-words">{installError}</p>
          )}
        </div>
      )}

      {/* Spacer to push form to bottom */}
      <div className="flex-1" />

      {/* Project setup form */}
      <div className="border-t border-border pt-4 space-y-3">
        {/* Project name */}
        <div>
          <label className="text-label text-text-dim block mb-1">Project name</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => {
              setProjectName(e.target.value);
              setNameError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) handleSubmit();
            }}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-subtle text-text-primary text-ui focus:border-accent/50 focus:outline-none transition-colors"
            placeholder="my-project"
          />
        </div>

        {/* Location */}
        <div>
          <label className="text-label text-text-dim block mb-1">Location</label>
          <button
            onClick={handlePickDir}
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-subtle hover:bg-bg-elevated text-left text-ui transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-ghost shrink-0">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className={parentDir ? "text-text-secondary truncate" : "text-text-ghost"}>
              {parentDir || "Choose a folder..."}
            </span>
          </button>
        </div>

        {nameError && (
          <p className="text-red text-label">{nameError}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {template.repo_url && (
            <a
              href={template.repo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-label text-text-dim hover:text-text-secondary transition-colors"
              onClick={(e) => {
                e.preventDefault();
                import("@tauri-apps/plugin-opener").then((mod) => mod.openUrl(template.repo_url));
              }}
            >
              <ExternalLink size={12} />
              View on GitHub
            </a>
          )}

          <div className="flex-1" />

          <button
            onClick={handleSubmit}
            disabled={hasRequiredMissing}
            title={hasRequiredMissing ? "Install missing prerequisites first" : undefined}
            className={`px-5 py-2 rounded-lg text-ui font-medium transition-all ${
              hasRequiredMissing
                ? "bg-bg-elevated text-text-ghost cursor-not-allowed"
                : canSubmit
                  ? "bg-accent text-white hover:bg-accent-light"
                  : "bg-bg-elevated text-text-ghost"
            }`}
          >
            Use This Template
          </button>
        </div>
      </div>
    </div>
  );
}
