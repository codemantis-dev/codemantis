import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePreviewStore } from "../stores/previewStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useSessionStore } from "../stores/sessionStore";
import {
  startDevServer,
  stopDevServer,
  getDevServerStatus,
} from "../lib/tauri-commands";
import type { DevServerReadyEvent, DevServerErrorEvent } from "../types/preview";
import { usePreviewWindow } from "./usePreviewWindow";

export function usePreviewServer(): {
  startServer: (devCommand?: string, devPort?: number) => Promise<void>;
  stopServer: () => Promise<void>;
  checkStatus: () => Promise<void>;
} {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const { openPreview } = usePreviewWindow();

  // Listen for dev server events
  useEffect(() => {
    const unlistenReady = listen<DevServerReadyEvent>("dev-server-ready", (e) => {
      const { port, url, terminalId, projectPath } = e.payload;
      usePreviewStore.getState().setDevServer(projectPath, {
        port,
        url,
        terminalId,
        status: "running",
      });

      // Auto-open preview window
      if (activeProjectPath === projectPath) {
        openPreview(url);
      }
    });

    const unlistenError = listen<DevServerErrorEvent>("dev-server-error", (e) => {
      const { message, projectPath } = e.payload;
      usePreviewStore.getState().setDevServer(projectPath, {
        status: "error",
        errorMessage: message,
      });
    });

    return () => {
      unlistenReady.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [activeProjectPath, openPreview]);

  const startServer = useCallback(
    async (devCommand?: string, devPort?: number) => {
      if (!activeProjectPath) return;

      usePreviewStore.getState().setDevServer(activeProjectPath, {
        terminalId: "",
        sessionId: "",
        port: null,
        url: null,
        status: "starting",
      });

      try {
        const terminalId = await startDevServer(
          activeProjectPath,
          devCommand ?? null,
          devPort ?? null,
        );

        // Hash the project path to get the synthetic session ID
        const hash = simpleHash(activeProjectPath);
        const syntheticSessionId = `devserver-${hash}`;

        usePreviewStore.getState().setDevServer(activeProjectPath, {
          terminalId,
          sessionId: syntheticSessionId,
          status: "scanning",
        });

        // Add terminal to terminal store so it shows up in the terminal tab
        useTerminalStore.getState().addTerminal(syntheticSessionId, {
          id: terminalId,
          sessionId: syntheticSessionId,
          name: "Dev Server",
          sortOrder: 0,
          createdAt: new Date().toISOString(),
          isRunning: true,
          kind: "shell",
        });
      } catch (e) {
        usePreviewStore.getState().setDevServer(activeProjectPath, {
          terminalId: "",
          sessionId: "",
          port: null,
          url: null,
          status: "error",
          errorMessage: String(e),
        });
      }
    },
    [activeProjectPath],
  );

  const stopServer = useCallback(async () => {
    if (!activeProjectPath) return;

    const devServer = usePreviewStore.getState().devServer.get(activeProjectPath);
    if (devServer) {
      await stopDevServer(activeProjectPath);
      usePreviewStore.getState().clearDevServer(activeProjectPath);

      // Clean up terminal store
      if (devServer.sessionId) {
        useTerminalStore.getState().clearSession(devServer.sessionId);
      }
    }
  }, [activeProjectPath]);

  const checkStatus = useCallback(async () => {
    if (!activeProjectPath) return;

    const status = await getDevServerStatus(activeProjectPath);
    if (status) {
      usePreviewStore.getState().setDevServer(activeProjectPath, {
        terminalId: status.terminal_id,
        sessionId: status.synthetic_session_id,
        port: status.port ?? null,
        url: status.url ?? null,
        status:
          status.status === "detected"
            ? "running"
            : status.status === "failed"
              ? "error"
              : "scanning",
      });
    }
  }, [activeProjectPath]);

  return { startServer, stopServer, checkStatus };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}
