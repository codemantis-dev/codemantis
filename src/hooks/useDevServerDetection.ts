import { useEffect } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import {
  listenDevServerDetected,
  listenDevServerClosed,
} from "../lib/tauri-commands";

export function useDevServerDetection(): void {
  const addDetectedDevServer = useTerminalStore((s) => s.addDetectedDevServer);
  const removeDetectedDevServersForTerminal = useTerminalStore(
    (s) => s.removeDetectedDevServersForTerminal
  );

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const unlistenDetected = await listenDevServerDetected((event) => {
        if (!cancelled) {
          if (import.meta.env.DEV) {
            console.debug("[DevServer] detected:", event);
          }
          addDetectedDevServer({
            terminalId: event.terminalId,
            sessionId: event.sessionId,
            port: event.port,
            url: event.url,
          });
        }
      });

      const unlistenClosed = await listenDevServerClosed((event) => {
        if (!cancelled) {
          if (import.meta.env.DEV) {
            console.debug("[DevServer] closed:", event);
          }
          removeDetectedDevServersForTerminal(event.terminalId);
        }
      });

      return () => {
        cancelled = true;
        unlistenDetected();
        unlistenClosed();
      };
    };

    let cleanup: (() => void) | undefined;
    setup().then((fn) => {
      if (cancelled) {
        fn();
      } else {
        cleanup = fn;
      }
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [addDetectedDevServer, removeDetectedDevServersForTerminal]);
}
