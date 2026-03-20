import { useCallback } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import { useSessionStore } from "../stores/sessionStore";
import {
  createTerminal as createTerminalCmd,
  closeTerminal as closeTerminalCmd,
  sendTerminalInput as sendInputCmd,
  resizeTerminal as resizeTerminalCmd,
} from "../lib/tauri-commands";
import { handleError } from "../lib/error-handler";

const MAX_TERMINALS = 6;

interface UseTerminalReturn {
  createTerminal: (sessionId: string) => Promise<string | null>;
  closeTerminal: (sessionId: string, terminalId: string) => Promise<void>;
  sendInput: (terminalId: string, data: string) => Promise<void>;
  resizeTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>;
}

export function useTerminal(): UseTerminalReturn {
  const store = useTerminalStore;
  const sessionStore = useSessionStore;

  const createTerminal = useCallback(async (sessionId: string): Promise<string | null> => {
    const terminals = store.getState().getTerminals(sessionId);
    if (terminals.length >= MAX_TERMINALS) {
      console.warn("Maximum terminals reached for session");
      return null;
    }

    const session = sessionStore.getState().sessions.get(sessionId);
    if (!session) return null;

    try {
      const termNum = terminals.length + 1;
      const info = await createTerminalCmd(
        sessionId,
        session.project_path,
        undefined,
        `Terminal ${termNum}`
      );

      store.getState().addTerminal(sessionId, {
        id: info.id,
        sessionId,
        name: info.name,
        sortOrder: termNum,
        createdAt: new Date().toISOString(),
        isRunning: true,
      });

      return info.id;
    } catch (e) {
      handleError("Failed to create terminal", e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store and sessionStore are stable Zustand store references
  }, []);

  const closeTerminalFn = useCallback(async (sessionId: string, terminalId: string) => {
    try {
      await closeTerminalCmd(terminalId);
    } catch (e) {
      handleError("Failed to close terminal", e);
    }
    store.getState().removeTerminal(sessionId, terminalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store is a stable Zustand store reference
  }, []);

  const sendInput = useCallback(async (terminalId: string, data: string) => {
    try {
      await sendInputCmd(terminalId, data);
    } catch (e) {
      console.error("Failed to send terminal input:", e);
    }
  }, []);

  const resizeTerminalFn = useCallback(async (terminalId: string, cols: number, rows: number) => {
    try {
      await resizeTerminalCmd(terminalId, cols, rows);
    } catch (e) {
      console.error("Failed to resize terminal:", e);
    }
  }, []);

  return {
    createTerminal,
    closeTerminal: closeTerminalFn,
    sendInput,
    resizeTerminal: resizeTerminalFn,
  };
}
