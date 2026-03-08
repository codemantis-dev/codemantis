import { useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { useTerminal } from "./useTerminal";
import type { SessionMode } from "../types/session";

const MODE_CYCLE: SessionMode[] = ["normal", "auto-accept", "plan"];

export function useKeyboardShortcuts(): void {
  const { createTerminal } = useTerminal();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Shift+Tab — cycle working mode (no Cmd/Ctrl required)
      if (e.key === "Tab" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Don't intercept if focus is in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        e.preventDefault();
        const store = useSessionStore.getState();
        const activeId = store.activeSessionId;
        if (activeId) {
          const current = store.sessionModes.get(activeId) ?? "normal";
          const idx = MODE_CYCLE.indexOf(current);
          const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
          store.setSessionMode(activeId, next);
        }
        return;
      }

      // Only handle Cmd/Ctrl key combos below
      if (!e.metaKey && !e.ctrlKey) return;

      const key = e.key.toLowerCase();
      const shift = e.shiftKey;

      // Cmd+N — open project picker (new session)
      if (key === "n" && !shift) {
        e.preventDefault();
        useUiStore.getState().setShowProjectPicker(true);
        return;
      }

      // Cmd+W — close active session
      if (key === "w" && !shift) {
        e.preventDefault();
        const activeId = useSessionStore.getState().activeSessionId;
        if (activeId) {
          // Import dynamically to avoid circular deps in this hook
          import("../lib/tauri-commands").then(({ closeSession }) => {
            closeSession(activeId).catch(console.error);
          });
          useSessionStore.getState().removeSession(activeId);
        }
        return;
      }

      // Cmd+, — open settings
      if (key === ",") {
        e.preventDefault();
        useUiStore.getState().setShowSettingsModal(true);
        return;
      }

      // Cmd+1-9 — switch to session tab N
      if (key >= "1" && key <= "9" && !shift) {
        const idx = parseInt(key) - 1;
        const { tabOrder } = useSessionStore.getState();
        if (idx < tabOrder.length) {
          e.preventDefault();
          useSessionStore.getState().setActiveSession(tabOrder[idx]);
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
  }, [createTerminal]);
}
