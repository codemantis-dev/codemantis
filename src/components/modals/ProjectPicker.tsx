import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LayoutGrid, FolderOpen, Clock, GitBranch, History, Loader2, Play, RotateCcw, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useUiStore, type ProjectPickerTab } from "../../stores/uiStore";
import { showToast } from "../../stores/toastStore";
import { translateError } from "../../lib/error-messages";
import ErrorCard from "../shared/ErrorCard";
import TemplatePicker from "./TemplatePicker";
import CloneForm from "./CloneForm";
import AgentPicker from "../onboarding/AgentPicker";
import { getRecentProjects, addRecentProject, removeRecentProject } from "../../lib/recent-projects";
import { listRecentSessions } from "../../lib/tauri-commands";
import { sessionIconFor, formatRelativeTime, projectBasename } from "../../lib/session-display";
import type { SessionHistoryEntry } from "../../types/session";
import type { AgentId } from "../../types/agent-events";

const TAB_ITEMS: { id: ProjectPickerTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "templates", label: "Templates", icon: LayoutGrid },
  { id: "open", label: "Open Folder", icon: FolderOpen },
  { id: "clone", label: "Clone", icon: GitBranch },
  { id: "recent", label: "Recent", icon: Clock },
  { id: "resume", label: "Resume Session", icon: History },
];

interface ProjectPickerProps {
  onSelectProject: (path: string) => void;
  onResumeSession: (
    projectPath: string,
    cliSessionId: string,
    name: string,
    sessionId: string,
    agentId: AgentId,
    forceFreshThread?: boolean,
  ) => Promise<void> | void;
}

export default function ProjectPicker({ onSelectProject, onResumeSession }: ProjectPickerProps) {
  const showProjectPicker = useUiStore((s) => s.showProjectPicker);
  const setShowProjectPicker = useUiStore((s) => s.setShowProjectPicker);
  const activeTab = useUiStore((s) => s.projectPickerTab);
  const setActiveTab = useUiStore((s) => s.setProjectPickerTab);
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);

  const [projectPath, setProjectPath] = useState("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [recentSessions, setRecentSessions] = useState<SessionHistoryEntry[] | null>(null);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(false);
  const [recentSessionsError, setRecentSessionsError] = useState<string | null>(null);
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (showProjectPicker) {
      setRecentProjects(getRecentProjects());
      setProjectPath("");
      setError(null);
      setStarting(false);
      setRecentSessions(null);
      setRecentSessionsError(null);
      setResumingSessionId(null);
    }
  }, [showProjectPicker]);

  useEffect(() => {
    if (!showProjectPicker || activeTab !== "resume") return;
    if (recentSessions !== null) return; // already loaded for this opening
    let cancelled = false;
    setRecentSessionsLoading(true);
    setRecentSessionsError(null);
    listRecentSessions(20)
      .then((entries) => {
        if (!cancelled) setRecentSessions(entries);
      })
      .catch((e) => {
        if (!cancelled) {
          const detail = e instanceof Error ? e.message : String(e);
          setRecentSessionsError(detail);
        }
      })
      .finally(() => {
        if (!cancelled) setRecentSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showProjectPicker, activeTab, recentSessions]);

  const handleResume = async (entry: SessionHistoryEntry, forceFreshThread = false): Promise<void> => {
    if (resumingSessionId) return;
    setResumingSessionId(entry.session_id);
    try {
      await onResumeSession(
        entry.project_path,
        entry.cli_session_id,
        entry.name,
        entry.session_id,
        entry.agent_id,
        forceFreshThread,
      );
      setShowProjectPicker(false);
    } catch (e) {
      console.error("Failed to resume session:", e);
      const detail = e instanceof Error ? e.message : String(e);
      showToast(`Failed to resume session: ${detail}`, "error");
    } finally {
      setResumingSessionId(null);
    }
  };

  const handlePickFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Project Folder",
    });
    if (selected) {
      setProjectPath(selected as string);
      setError(null);
    }
  };

  const handleStart = async (path?: string) => {
    const resolvedPath = (path ?? projectPath).trim();
    if (!resolvedPath) return;
    setStarting(true);
    setError(null);
    try {
      addRecentProject(resolvedPath);
      setRecentProjects(getRecentProjects());
      onSelectProject(resolvedPath);
      setShowProjectPicker(false);
    } catch (e) {
      console.error("Failed to start session:", e);
      const detail = e instanceof Error ? e.message : String(e);
      setError(`Failed to open project: ${detail}`);
    } finally {
      setStarting(false);
    }
  };

  const handleTemplateProjectCreated = (projectPath: string) => {
    addRecentProject(projectPath);
    onSelectProject(projectPath);
    setShowProjectPicker(false);
  };

  const handleCloneComplete = (projectPath: string) => {
    addRecentProject(projectPath);
    onSelectProject(projectPath);
    setShowProjectPicker(false);
  };

  const handleClose = (): void => {
    if (busy) {
      showToast("Cannot close while an operation is in progress", "info");
      return;
    }
    setShowProjectPicker(false);
  };

  const handleRemoveRecent = (e: React.MouseEvent, path: string): void => {
    e.stopPropagation();
    removeRecentProject(path);
    setRecentProjects(getRecentProjects());
  };

  const folderName = projectPath
    ? projectPath.split("/").filter(Boolean).pop()
    : "";

  return (
    <Dialog.Root open={showProjectPicker} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border flex flex-col"
          style={{
            background: "var(--bg-primary)",
            width: "min(90vw, 680px)",
            height: "min(85vh, 600px)",
          }}
          onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        >
          {/* Header with tabs */}
          <div className="flex items-center justify-between px-5 pt-5 pb-0">
            <Dialog.Title className="text-lg text-text-primary font-medium">
              {activeTab === "templates"
                ? "New Project"
                : activeTab === "open"
                ? "Open Project"
                : activeTab === "clone"
                ? "Clone from Git"
                : activeTab === "resume"
                ? "Resume Session"
                : "Recent Projects"}
            </Dialog.Title>
            {!busy && (
              <Dialog.Close asChild>
                <button className="p-1 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors">
                  <X size={16} />
                </button>
              </Dialog.Close>
            )}
          </div>

          <Dialog.Description className="sr-only">
            Create a new project from a template, open an existing folder, or clone from Git
          </Dialog.Description>

          {/* Tab bar */}
          <div className="flex gap-1 px-5 pt-3 pb-0">
            {TAB_ITEMS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const recentCount = tab.id === "recent" ? recentProjects.length : 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-label transition-colors ${
                    isActive
                      ? "bg-accent/15 text-accent"
                      : "text-text-dim hover:text-text-secondary hover:bg-bg-elevated"
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                  {tab.id === "recent" && recentCount > 0 && (
                    <span className="text-detail text-text-ghost ml-0.5">({recentCount})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-b border-border mx-5 mt-2" />

          {/* Phase 2 §5: agent picker shared across every new-session tab
              (Templates, Open, Clone). Sits below the tab bar so users
              always see + change which agent the next session will use.
              Auto-collapses to a static label when only one binary is on
              PATH; hidden on Recent / Resume tabs (those open existing
              sessions, where agent is already chosen). */}
          {(activeTab === "templates" || activeTab === "open" || activeTab === "clone") && (
            <div className="px-5 pt-3" data-testid="project-picker-agent-strip">
              <AgentPicker
                value={selectedAgentId}
                onChange={setSelectedAgentId}
              />
            </div>
          )}

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            {activeTab === "templates" && (
              <div className="h-full">
                <TemplatePicker onProjectCreated={handleTemplateProjectCreated} onBusyChange={setBusy} />
              </div>
            )}

            {activeTab === "open" && (
              <div>
                {/* Folder picker */}
                <button
                  onClick={handlePickFolder}
                  className="w-full mb-3 px-4 py-3 rounded-lg border border-dashed border-border hover:border-accent/40 bg-bg-subtle hover:bg-bg-elevated transition-colors text-left flex items-center gap-3"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-dim shrink-0">
                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  {projectPath ? (
                    <div className="min-w-0">
                      <span className="text-text-primary text-ui font-medium block truncate">{folderName}</span>
                      <span className="text-text-dim text-label block truncate">{projectPath}</span>
                    </div>
                  ) : (
                    <span className="text-text-secondary text-ui">Select a project folder...</span>
                  )}
                </button>

                {/* Start button */}
                <button
                  onClick={() => handleStart()}
                  disabled={!projectPath.trim() || starting}
                  className={`w-full py-2.5 rounded-lg text-ui font-medium transition-all ${
                    projectPath.trim() && !starting
                      ? "bg-accent text-white hover:bg-accent-light"
                      : "bg-bg-elevated text-text-ghost cursor-not-allowed"
                  }`}
                >
                  {starting ? "Starting..." : "Open Project"}
                </button>

                {error && (
                  <ErrorCard
                    {...translateError(error)}
                    rawError={error}
                    compact
                    onDismiss={() => setError(null)}
                  />
                )}
              </div>
            )}

            {activeTab === "clone" && (
              <div>
                <CloneForm
                  onBack={() => setActiveTab("templates")}
                  onCloned={handleCloneComplete}
                  onBusyChange={setBusy}
                />
              </div>
            )}

            {activeTab === "resume" && (
              <div data-testid="resume-tab">
                {recentSessionsLoading ? (
                  <div className="flex items-center justify-center h-32 gap-2 text-text-dim text-label">
                    <Loader2 size={14} className="animate-spin" />
                    <span>Loading recent sessions...</span>
                  </div>
                ) : recentSessionsError ? (
                  <ErrorCard
                    {...translateError(recentSessionsError)}
                    rawError={recentSessionsError}
                    compact
                    onDismiss={() => setRecentSessionsError(null)}
                  />
                ) : !recentSessions || recentSessions.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-text-dim text-label">No closed sessions yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border-light">
                    {recentSessions.map((entry) => {
                      const icon = sessionIconFor(entry.icon_index);
                      const projectName = projectBasename(entry.project_path);
                      const modelLabel = entry.model
                        ? entry.model.replace(/^claude-/, "").split("-")[0]
                        : null;
                      const capitalizedModel = modelLabel
                        ? modelLabel.charAt(0).toUpperCase() + modelLabel.slice(1)
                        : null;
                      const isResuming = resumingSessionId === entry.session_id;
                      return (
                        <div
                          key={entry.session_id}
                          data-testid={`resume-row-${entry.session_id}`}
                          className="px-2 py-3 hover:bg-bg-subtle transition-colors"
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="text-text-dim text-base mt-0.5 shrink-0">{icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="text-ui font-medium text-text-primary truncate">
                                  {entry.name}
                                </span>
                                {capitalizedModel && (
                                  <span className="text-detail font-medium text-accent bg-accent-dim rounded px-1 py-px shrink-0">
                                    {capitalizedModel}
                                  </span>
                                )}
                                {entry.has_stored_messages && (
                                  <span
                                    className="text-fine font-medium rounded px-1 py-px shrink-0"
                                    style={{
                                      color: "var(--green, #22c55e)",
                                      background: "color-mix(in srgb, var(--green, #22c55e) 12%, transparent)",
                                    }}
                                  >
                                    Saved
                                  </span>
                                )}
                                <span className="text-detail text-text-ghost ml-auto shrink-0">
                                  {formatRelativeTime(entry.closed_at)}
                                </span>
                              </div>
                              <div
                                className="text-label text-text-dim truncate"
                                title={entry.project_path}
                              >
                                <span className="text-text-ghost">in </span>
                                <span className="text-text-secondary">{projectName}</span>
                              </div>
                              {entry.recent_headlines.length > 0 && (
                                <ul className="mt-1 space-y-0.5">
                                  {entry.recent_headlines.slice(0, 2).map((headline, i) => (
                                    <li
                                      key={`${headline}-${i}`}
                                      className="text-label text-text-dim leading-snug flex items-start gap-1.5"
                                    >
                                      <span className="text-text-ghost mt-[3px] shrink-0">&#x2022;</span>
                                      <span className="truncate">{headline}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-col items-end gap-1 shrink-0">
                              <button
                                onClick={() => handleResume(entry)}
                                disabled={isResuming || resumingSessionId !== null}
                                data-testid={`resume-button-${entry.session_id}`}
                                className="flex items-center gap-1 px-2 py-1 rounded text-label font-medium bg-accent-dim text-accent hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
                              >
                                {isResuming ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Play size={12} />
                                )}
                                <span>Resume</span>
                              </button>
                              {/* Codex large-thread escape: resume into a fresh thread
                                  carrying the prior chat as context. Avoids the
                                  upstream compaction deadlock on big sessions. */}
                              {entry.agent_id === "codex" && (
                                <button
                                  onClick={() => handleResume(entry, true)}
                                  disabled={isResuming || resumingSessionId !== null}
                                  data-testid={`resume-fresh-button-${entry.session_id}`}
                                  title="Start a fresh Codex thread carrying this chat as context — use if a normal Resume hangs on 'Compacting…'"
                                  className="flex items-center gap-1 px-2 py-1 rounded text-label text-text-dim hover:text-accent hover:bg-accent-dim transition-colors disabled:opacity-50"
                                >
                                  <RotateCcw size={11} />
                                  <span>Resume in fresh thread</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "recent" && (
              <div>
                {recentProjects.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-text-dim text-label">No recent projects</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentProjects.map((path) => {
                      const name = path.split("/").filter(Boolean).pop();
                      return (
                        <button
                          key={path}
                          onClick={() => handleStart(path)}
                          disabled={starting}
                          className="w-full px-3 py-2.5 rounded-lg text-left hover:bg-bg-elevated transition-colors group flex items-center gap-3"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-ghost group-hover:text-text-dim shrink-0">
                            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          </svg>
                          <div className="min-w-0 flex-1">
                            <span className="text-text-secondary group-hover:text-text-primary text-ui block truncate">{name}</span>
                            <span className="text-text-ghost group-hover:text-text-dim text-label block truncate">{path}</span>
                          </div>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={`Remove ${name} from recent projects`}
                            onClick={(e) => handleRemoveRecent(e, path)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRemoveRecent(e as unknown as React.MouseEvent, path); } }}
                            className="p-1 rounded-md text-text-ghost opacity-0 group-hover:opacity-100 hover:text-red hover:bg-red/10 transition-all shrink-0"
                          >
                            <X size={14} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
