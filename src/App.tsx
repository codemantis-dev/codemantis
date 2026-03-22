import { useEffect, useState } from "react";
import { Plus, FolderOpen, GitBranch } from "lucide-react";
import { checkClaudeStatus, setClaudeBinaryOverride, cleanupOldAttachments, type ClaudeStatus } from "./lib/tauri-commands";
import { useClaudeSession } from "./hooks/useClaudeSession";
import { useSessionStore } from "./stores/sessionStore";
import { useUiStore } from "./stores/uiStore";
import { useSettingsStore } from "./stores/settingsStore";
import AppShell from "./components/layout/AppShell";
import ToolApproval from "./components/modals/ToolApproval";
import ProjectPicker from "./components/modals/ProjectPicker";
import WelcomeScreen from "./components/onboarding/WelcomeScreen";
import { addRecentProject, getRecentProjects } from "./lib/recent-projects";
import SettingsModal from "./components/modals/SettingsModal";
import McpModal from "./components/modals/McpModal";
import QuestionModal from "./components/modals/QuestionModal";
import PlanCompleteModal from "./components/modals/PlanCompleteModal";
import CliOverlay from "./components/modals/CliOverlay";
import Toast from "./components/shared/Toast";
import ErrorCard from "./components/shared/ErrorCard";
import UpdateNotification from "./components/shared/UpdateNotification";
import UpdateModal from "./components/modals/UpdateModal";
import { showToast } from "./stores/toastStore";
import { translateError, translateErrorForToast } from "./lib/error-messages";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useToolApprovalListener } from "./hooks/useToolApprovalListener";

export default function App() {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasSessions = useSessionStore((s) => s.tabOrder.length > 0);
  const openProjectPicker = useUiStore((s) => s.openProjectPicker);
  const openSettingsToTab = useUiStore((s) => s.openSettingsToTab);
  const { startSession } = useClaudeSession();
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const onboardingCompleted = useSettingsStore((s) => s.settings.onboardingCompleted);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  useKeyboardShortcuts();
  useToolApprovalListener();

  useEffect(() => {
    checkClaudeStatus()
      .then((status) => {
        setClaudeStatus(status);
        if (status.binary_path) {
          useUiStore.getState().setClaudeBinaryPath(status.binary_path);
        }
      })
      .catch((e) => console.error("Status check failed:", e))
      .finally(() => setChecking(false));
    loadSettings();
  }, [loadSettings]);

  const handleRecheck = async (): Promise<void> => {
    setRechecking(true);
    try {
      const status = await checkClaudeStatus();
      setClaudeStatus(status);
      if (status.binary_path) {
        useUiStore.getState().setClaudeBinaryPath(status.binary_path);
      }
    } catch (e) {
      console.error("Recheck failed:", e);
    } finally {
      setRechecking(false);
    }
  };

  const handleGetStarted = (skipFuture: boolean): void => {
    if (skipFuture) {
      updateSettings({ onboardingCompleted: true });
    }
    setOnboardingDismissed(true);
  };

  const handleSelectClaudeBinary = async (): Promise<void> => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      title: "Locate Claude Code binary",
      multiple: false,
      directory: false,
    });
    if (!selected) return;
    try {
      const status = await setClaudeBinaryOverride(selected);
      setClaudeStatus(status);
      if (status.binary_path) {
        useUiStore.getState().setClaudeBinaryPath(status.binary_path);
      }
    } catch (e) {
      const { showToast } = await import("./stores/toastStore");
      showToast(String(e), "error");
    }
  };

  const handleSelectProject = async (path: string) => {
    setError(null);
    try {
      await startSession(path);
      addRecentProject(path);
      // Cleanup old attachments (7 days) for this project
      cleanupOldAttachments(path, 7).catch(() => {});
    } catch (e) {
      console.error("Failed to start session:", e);
      const msg = String(e);
      setError(msg);
      showToast(translateErrorForToast(msg), "error");
    }
  };

  if (checking || !settingsLoaded) {
    return (
      <div className="h-screen w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <div className="h-12 shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-dim">Checking Claude Code installation...</p>
        </div>
      </div>
    );
  }

  // Show onboarding welcome screen on first launch (before settings are loaded or when not completed)
  if (settingsLoaded && !onboardingCompleted && !onboardingDismissed) {
    return (
      <WelcomeScreen
        claudeStatus={claudeStatus}
        rechecking={rechecking}
        onRecheck={handleRecheck}
        onGetStarted={handleGetStarted}
        onOpenProject={() => {
          handleGetStarted(true);
          openProjectPicker("open");
        }}
        onCloneRepo={() => {
          handleGetStarted(true);
          openProjectPicker("clone");
        }}
        onNewProject={() => {
          handleGetStarted(true);
          openProjectPicker("templates");
        }}
        onOpenSettings={() => {
          handleGetStarted(true);
          openSettingsToTab("ai-providers");
        }}
        onSelectClaudeBinary={handleSelectClaudeBinary}
      />
    );
  }

  if (!hasSessions) {
    const recentProjects = getRecentProjects();

    return (
      <div className="h-screen w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <UpdateNotification />
        <div className="h-12 shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <div className="w-full max-w-lg p-8 flex flex-col max-h-full">
            {/* Logo and title */}
            <div className="text-center mb-8">
              <img
                src="/CodeMantisIcon.png"
                alt="CodeMantis"
                className="w-28 h-28 rounded-2xl mb-4 inline-block"
              />
              <h2 className="text-2xl text-text-primary font-semibold mb-1">
                CodeMantis
              </h2>
              <p className="text-text-secondary text-ui">
                {claudeStatus?.version ? (
                  <span>Claude Code {claudeStatus.version}</span>
                ) : (
                  <span>Native UI for Claude Code</span>
                )}
              </p>
              <p className="text-text-ghost text-label mt-1">v{__APP_VERSION__}</p>
            </div>

            {/* Three action cards */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <button
                onClick={() => openProjectPicker("templates")}
                className="px-4 py-5 rounded-xl border border-dashed border-border hover:border-accent/50 bg-bg-subtle hover:bg-bg-elevated transition-all text-center group"
              >
                <Plus size={22} className="mx-auto mb-2 text-text-ghost group-hover:text-accent transition-colors" />
                <span className="text-text-primary text-ui font-medium block mb-0.5">
                  New Project
                </span>
                <span className="text-text-dim text-label">
                  Start from a template
                </span>
              </button>

              <button
                onClick={() => openProjectPicker("clone")}
                className="px-4 py-5 rounded-xl border border-dashed border-border hover:border-accent/50 bg-bg-subtle hover:bg-bg-elevated transition-all text-center group"
              >
                <GitBranch size={22} className="mx-auto mb-2 text-text-ghost group-hover:text-accent transition-colors" />
                <span className="text-text-primary text-ui font-medium block mb-0.5">
                  Clone Repo
                </span>
                <span className="text-text-dim text-label">
                  Clone from GitHub
                </span>
              </button>

              <button
                onClick={() => openProjectPicker("open")}
                className="px-4 py-5 rounded-xl border border-dashed border-border hover:border-accent/50 bg-bg-subtle hover:bg-bg-elevated transition-all text-center group"
              >
                <FolderOpen size={22} className="mx-auto mb-2 text-text-ghost group-hover:text-accent transition-colors" />
                <span className="text-text-primary text-ui font-medium block mb-0.5">
                  Open Project
                </span>
                <span className="text-text-dim text-label">
                  Open an existing folder
                </span>
              </button>
            </div>

            {/* Inline recent projects */}
            {recentProjects.length > 0 && (
              <div className="min-h-0 flex flex-col">
                <p className="text-text-ghost text-label uppercase tracking-wider mb-2 shrink-0">Recent Projects</p>
                <div className="space-y-1 overflow-y-auto min-h-0">
                  {recentProjects.map((path) => {
                    const name = path.split("/").filter(Boolean).pop();
                    return (
                      <button
                        key={path}
                        onClick={() => handleSelectProject(path)}
                        className="w-full px-3 py-2 rounded-lg text-left hover:bg-bg-elevated transition-colors group flex items-center gap-3"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-ghost group-hover:text-text-dim shrink-0">
                          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <div className="min-w-0">
                          <span className="text-text-secondary group-hover:text-text-primary text-ui block truncate">{name}</span>
                          <span className="text-text-ghost group-hover:text-text-dim text-label block truncate">{path}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Keyboard hint */}
            <p className="text-center text-text-ghost text-label mt-6">
              <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-light text-text-faint">Cmd+Shift+N</kbd> new project
              <span className="mx-2 text-text-ghost/40">|</span>
              <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-light text-text-faint">Cmd+O</kbd> open folder
            </p>

            {error && (
              <ErrorCard
                {...translateError(error)}
                rawError={error}
                onDismiss={() => setError(null)}
              />
            )}
          </div>
        </div>

        <ProjectPicker onSelectProject={handleSelectProject} />
        <SettingsModal />
        <McpModal />
        <UpdateModal />
        <Toast />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <UpdateNotification />
      <AppShell />
      <ToolApproval />
      <QuestionModal />
      <PlanCompleteModal />
      <CliOverlay />
      <ProjectPicker onSelectProject={handleSelectProject} />
      <SettingsModal />
      <McpModal />
      <UpdateModal />
      <Toast />
    </div>
  );
}
