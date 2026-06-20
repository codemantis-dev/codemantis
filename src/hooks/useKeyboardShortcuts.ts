import { useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useTerminal } from "./useTerminal";
import { useClaudeSession } from "./useClaudeSession";
import { usePreviewWindow } from "./usePreviewWindow";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useChatSearchStore } from "../stores/chatSearchStore";
import {
  setSessionMode as setSessionModeCmd,
  setCodexPolicy,
} from "../lib/tauri-commands";
import type { CodexSessionPolicy } from "../lib/tauri-commands";
import type { SessionMode } from "../types/session";

const MODE_CYCLE: SessionMode[] = [
  "normal",
  "auto-accept",
  "plan",
  "auto",
  "dont-ask",
  "bypass-permissions",
];

// Codex's equivalent of mode-cycle: a curated sweep across the
// (sandbox, approval) product, ordered from safest to most permissive.
// Matches the four meaningful presets the PolicyPill UI exposes; cycling
// through them keeps `network_access` whatever the user last set.
const CODEX_POLICY_CYCLE: Array<
  Pick<CodexSessionPolicy, "sandbox" | "approval">
> = [
  { sandbox: "read-only",           approval: "on-request" },  // safest
  { sandbox: "workspace-write",     approval: "on-request" },  // Auto (default)
  { sandbox: "workspace-write",     approval: "never" },       // Auto-accept
  { sandbox: "danger-full-access",  approval: "never" },       // Bypass
];

function findCodexCycleIndex(p: CodexSessionPolicy | undefined): number {
  if (!p) return -1;
  return CODEX_POLICY_CYCLE.findIndex(
    (c) => c.sandbox === p.sandbox && c.approval === p.approval,
  );
}

const DEFAULT_CODEX_POLICY: CodexSessionPolicy = {
  sandbox: "workspace-write",
  approval: "on-request",
  network_access: false,
};

export function useKeyboardShortcuts(): void {
  const { createTerminal } = useTerminal();
  const { addSessionToProject, closeSession, closeAllSessionsInProject } = useClaudeSession();
  const { togglePreview } = usePreviewWindow();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Home / End — move cursor to start/end of line in text inputs
      // macOS WebView defaults Home/End to page scroll; override for text editing
      if (e.key === "Home" || e.key === "End") {
        const el = document.activeElement;
        if (
          el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLInputElement && (el.type === "text" || el.type === "search" || el.type === "url"))
        ) {
          e.preventDefault();
          const value = el.value;

          if (e.key === "Home") {
            const cursorPos = el.selectionStart ?? 0;
            const lineStart = value.lastIndexOf("\n", cursorPos - 1) + 1;
            if (e.shiftKey) {
              el.setSelectionRange(lineStart, el.selectionEnd!, "backward");
            } else {
              el.setSelectionRange(lineStart, lineStart);
            }
          } else {
            const cursorPos = el.selectionEnd ?? 0;
            const nextNewline = value.indexOf("\n", cursorPos);
            const lineEnd = nextNewline === -1 ? value.length : nextNewline;
            if (e.shiftKey) {
              el.setSelectionRange(el.selectionStart!, lineEnd, "forward");
            } else {
              el.setSelectionRange(lineEnd, lineEnd);
            }
          }
          return;
        }
      }

      // Shift+Tab — cycle the working mode (Claude) / sandbox+approval
      // policy (Codex). Agent-aware so Codex sessions don't silently call
      // the no-op `setSessionMode` Tauri command on every press.
      if (e.key === "Tab" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const store = useSessionStore.getState();
        const activeId = store.activeSessionId;
        if (!activeId) return;

        const session = store.sessions.get(activeId);
        const isCodex = (session?.agent_id ?? "claude_code") === "codex";

        if (isCodex) {
          const ui = useUiStore.getState();
          const current = ui.codexPolicies[activeId];
          const idx = findCodexCycleIndex(current);
          const nextEntry = CODEX_POLICY_CYCLE[(idx + 1) % CODEX_POLICY_CYCLE.length];
          const next: CodexSessionPolicy = {
            sandbox: nextEntry.sandbox,
            approval: nextEntry.approval,
            network_access: current?.network_access ?? DEFAULT_CODEX_POLICY.network_access,
          };
          ui.updateCodexPolicyLocal(activeId, next);
          setCodexPolicy(activeId, next).catch(console.error);
        } else {
          const current = store.sessionModes.get(activeId) ?? "normal";
          const idx = MODE_CYCLE.indexOf(current);
          const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
          store.setSessionMode(activeId, next);
          setSessionModeCmd(activeId, next).catch(console.error);
        }
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — switch between project tabs
      if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const store = useSessionStore.getState();
        const { projectOrder, activeProjectPath } = store;
        if (projectOrder.length <= 1) return;
        const currentIdx = activeProjectPath ? projectOrder.indexOf(activeProjectPath) : -1;
        let nextIdx: number;
        if (e.shiftKey) {
          nextIdx = currentIdx <= 0 ? projectOrder.length - 1 : currentIdx - 1;
        } else {
          nextIdx = currentIdx >= projectOrder.length - 1 ? 0 : currentIdx + 1;
        }
        store.setActiveProject(projectOrder[nextIdx]);
        return;
      }

      // Only handle Cmd/Ctrl key combos below
      if (!e.metaKey && !e.ctrlKey) return;

      const key = e.key.toLowerCase();
      const shift = e.shiftKey;

      // Cmd+= / Cmd++ — zoom in (increase font size)
      if ((e.key === "=" || e.key === "+") && !shift) {
        e.preventDefault();
        useSettingsStore.getState().adjustFontSize(1);
        return;
      }

      // Cmd+- — zoom out (decrease font size)
      if (e.key === "-" && !shift) {
        e.preventDefault();
        useSettingsStore.getState().adjustFontSize(-1);
        return;
      }

      // Cmd+0 — reset zoom
      if (key === "0" && !shift) {
        e.preventDefault();
        useSettingsStore.getState().resetFontSize();
        return;
      }

      // Cmd+N — add new session to current project (or open project picker if no project)
      if (key === "n" && !shift) {
        e.preventDefault();
        const store = useSessionStore.getState();
        if (store.activeProjectPath) {
          addSessionToProject();
        } else {
          useUiStore.getState().openProjectPicker("open");
        }
        return;
      }

      // Cmd+Shift+N — new project from template
      if (key === "n" && shift) {
        e.preventDefault();
        useUiStore.getState().openProjectPicker("templates");
        return;
      }

      // Cmd+O — open existing project
      if (key === "o" && !shift) {
        e.preventDefault();
        useUiStore.getState().openProjectPicker("open");
        return;
      }

      // Cmd+W — close current session sub-tab
      if (key === "w" && !shift) {
        e.preventDefault();
        const activeId = useSessionStore.getState().activeSessionId;
        if (activeId) {
          closeSession(activeId);
        }
        return;
      }

      // Cmd+Shift+W — close all sessions in current project
      if (key === "w" && shift) {
        e.preventDefault();
        const store = useSessionStore.getState();
        if (store.activeProjectPath) {
          closeAllSessionsInProject(store.activeProjectPath);
        }
        return;
      }

      // Cmd+, — open settings
      if (key === ",") {
        e.preventDefault();
        useUiStore.getState().setShowSettingsModal(true);
        return;
      }

      // Cmd+Shift+P — toggle preview window
      if (key === "p" && shift) {
        e.preventDefault();
        togglePreview();
        return;
      }

      // Cmd+Shift+B — toggle task board slide-over
      if (key === "b" && shift) {
        e.preventDefault();
        const activeProject = useSessionStore.getState().activeProjectPath;
        if (activeProject) {
          useSpecWriterStore.getState().toggleSlideOver(activeProject);
        }
        return;
      }

      // Cmd+Shift+M — open MCP servers
      if (key === "m" && shift) {
        e.preventDefault();
        useUiStore.getState().setShowMcpModal(true);
        return;
      }

      // Cmd+Shift+G — open Mission Control (Preflight) for the active project
      if (key === "g" && shift) {
        e.preventDefault();
        if (useSessionStore.getState().activeProjectPath) {
          useUiStore.getState().setShowMissionControl(true);
        }
        return;
      }

      // Cmd+Shift+D — toggle the Duo-Coding dashboard for the active project
      // (only when the feature is enabled in Settings).
      if (key === "d" && shift) {
        e.preventDefault();
        const duoEnabled =
          useSettingsStore.getState().settings.duo?.enabled ?? true;
        if (duoEnabled && useSessionStore.getState().activeProjectPath) {
          useUiStore.getState().toggleDuoDashboard();
        }
        return;
      }

      // Cmd+Shift+O — toggle the Activity Overview lay-over
      if (key === "o" && shift) {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setShowActivityOverview(!ui.showActivityOverview);
        return;
      }

      // Cmd+? (Cmd+Shift+/) — toggle help panel
      if (key === "?" || (key === "/" && shift)) {
        e.preventDefault();
        useUiStore.getState().toggleHelpPanel();
        return;
      }

      // Cmd+F — open in-chat search (Cmd+Shift+F is reserved for Files tab)
      if (key === "f" && !shift) {
        if (useSessionStore.getState().activeSessionId) {
          e.preventDefault();
          useChatSearchStore.getState().open();
        }
        return;
      }

      // Cmd+/ — focus input and open command palette
      if (key === "/" && !shift) {
        e.preventDefault();
        if (useSessionStore.getState().activeSessionId) {
          // Dispatch custom event that InputArea listens for
          window.dispatchEvent(new CustomEvent("open-command-palette"));
        }
        return;
      }

      // Cmd+1-9 — switch between session sub-tabs within the current project
      if (key >= "1" && key <= "9" && !shift) {
        const idx = parseInt(key) - 1;
        const store = useSessionStore.getState();
        const { activeProjectPath, tabOrder, sessions } = store;
        if (!activeProjectPath) return;
        const projectSessions = tabOrder.filter((id) => {
          const s = sessions.get(id);
          return s && s.project_path === activeProjectPath;
        });
        if (idx < projectSessions.length) {
          e.preventDefault();
          store.setActiveSessionInProject(activeProjectPath, projectSessions[idx]);
        }
        return;
      }

      // Cmd+Shift+T — switch to Terminal tab
      if (key === "t" && shift) {
        e.preventDefault();
        useUiStore.getState().setRightTab("terminal");
        return;
      }

      // Cmd+Shift+A — switch to Activity tab
      if (key === "a" && shift) {
        e.preventDefault();
        useUiStore.getState().setRightTab("activity");
        return;
      }

      // Cmd+Shift+F — switch to Files tab
      if (key === "f" && shift) {
        e.preventDefault();
        useUiStore.getState().setRightTab("files");
        return;
      }

      // Cmd+Shift+L — switch to Changelog tab
      if (key === "l" && shift) {
        e.preventDefault();
        useUiStore.getState().setRightTab("changelog");
        return;
      }

      // Cmd+` — create new terminal
      if (key === "`" && !shift) {
        e.preventDefault();
        const activeId = useSessionStore.getState().activeSessionId;
        if (activeId) {
          useUiStore.getState().setRightTab("terminal");
          createTerminal(activeId);
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createTerminal, addSessionToProject, closeSession, closeAllSessionsInProject, togglePreview]);
}
