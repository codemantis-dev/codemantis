import { useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useTerminal } from "./useTerminal";
import { useClaudeSession } from "./useClaudeSession";
import { usePreviewWindow } from "./usePreviewWindow";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { setSessionMode as setSessionModeCmd } from "../lib/tauri-commands";
import type { SessionMode } from "../types/session";

const MODE_CYCLE: SessionMode[] = ["normal", "auto-accept", "plan"];

export function useKeyboardShortcuts(): void {
  const { createTerminal } = useTerminal();
  const { addSessionToProject, closeSession, closeAllSessionsInProject } = useClaudeSession();
  const { togglePreview } = usePreviewWindow();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Shift+Tab — cycle working mode (no Cmd/Ctrl required)
      if (e.key === "Tab" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const store = useSessionStore.getState();
        const activeId = store.activeSessionId;
        if (activeId) {
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
