import { useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePreviewStore } from "../stores/previewStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useSessionStore } from "../stores/sessionStore";
import {
  startDevServer,
  stopDevServer,
  getDevServerStatus,
  openPreviewWindow,
} from "../lib/tauri-commands";
import type { DevServerReadyEvent, DevServerErrorEvent } from "../types/preview";

export function usePreviewServer(): {
  startServer: (devCommand?: string, devPort?: number) => Promise<void>;
  stopServer: () => Promise<void>;
  checkStatus: () => Promise<void>;
} {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const activeProjectPathRef = useRef(activeProjectPath);
  activeProjectPathRef.current = activeProjectPath;

  // Listen for dev server events — register once, read state from refs/stores
  useEffect(() => {
    let cancelled = false;
    let unlistenReadyFn: (() => void) | null = null;
    let unlistenErrorFn: (() => void) | null = null;

    listen<DevServerReadyEvent>("dev-server-ready", (e) => {
      const { port, url, terminalId, projectPath } = e.payload;
      usePreviewStore.getState().setDevServer(projectPath, {
        port,
        url,
        terminalId,
        status: "running",
      });

      // Auto-open preview window if this project is active
      if (activeProjectPathRef.current === projectPath) {
        const projectName =
          projectPath.split("/").filter(Boolean).pop() ?? "Preview";
        openPreviewWindow(url, projectName)
          .then(() => {
            usePreviewStore.getState().setPreviewOpen(projectPath, true);
          })
          .catch((err) => {
            console.error("Failed to open preview window:", err);
            usePreviewStore.getState().setDevServer(projectPath, {
              status: "error",
              errorMessage: `Failed to open preview: ${String(err)}`,
            });
          });
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenReadyFn = fn;
      }
    });

    listen<DevServerErrorEvent>("dev-server-error", (e) => {
      const { message, projectPath } = e.payload;
      usePreviewStore.getState().setDevServer(projectPath, {
        status: "error",
        errorMessage: message,
      });
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenErrorFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenReadyFn?.();
      unlistenErrorFn?.();
    };
  }, []);

  const startServer = useCallback(
    async (devCommand?: string, devPort?: number) => {
      const projectPath = activeProjectPathRef.current;
      if (!projectPath) return;

      usePreviewStore.getState().setDevServer(projectPath, {
        terminalId: "",
        sessionId: "",
        port: null,
        url: null,
        status: "starting",
      });

      try {
        const terminalId = await startDevServer(
          projectPath,
          devCommand ?? null,
          devPort ?? null,
        );

        const hash = simpleHash(projectPath);
        const syntheticSessionId = `devserver-${hash}`;

        usePreviewStore.getState().setDevServer(projectPath, {
          terminalId,
          sessionId: syntheticSessionId,
          status: "scanning",
        });

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
        usePreviewStore.getState().setDevServer(projectPath, {
          terminalId: "",
          sessionId: "",
          port: null,
          url: null,
          status: "error",
          errorMessage: String(e),
        });
      }
    },
    [],
  );

  const stopServer = useCallback(async () => {
    const projectPath = activeProjectPathRef.current;
    if (!projectPath) return;

    const devServer = usePreviewStore.getState().devServer.get(projectPath);
    if (devServer) {
      await stopDevServer(projectPath);
      usePreviewStore.getState().clearDevServer(projectPath);

      if (devServer.sessionId) {
        useTerminalStore.getState().clearSession(devServer.sessionId);
      }
    }
  }, []);

  const checkStatus = useCallback(async () => {
    const projectPath = activeProjectPathRef.current;
    if (!projectPath) return;

    const status = await getDevServerStatus(projectPath);
    if (status) {
      usePreviewStore.getState().setDevServer(projectPath, {
        terminalId: status.terminal_id,
        sessionId: status.synthetic_session_id,
        port: status.port ?? null,
        url: status.url ?? null,
        status:
          status.status === "detected"
            ? "running"
            : status.status === "failed"
              ? "error"
              : status.status === "starting"
                ? "starting"
                : "scanning",
      });
    }
  }, []);

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
