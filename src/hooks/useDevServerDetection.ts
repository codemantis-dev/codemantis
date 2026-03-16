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
