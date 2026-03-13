import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listenTerminalOutput, sendTerminalInput } from "../../lib/tauri-commands";
import { useTerminal } from "../../hooks/useTerminal";
import { useSettingsStore } from "../../stores/settingsStore";
import { getXtermTheme } from "../../lib/editor-themes";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  terminalId: string;
  isVisible: boolean;
}

export default function TerminalView({ terminalId, isVisible }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { resizeTerminal } = useTerminal();
  const themeId = useSettingsStore((s) => s.settings.theme);
  const xtermColors = getXtermTheme(themeId);

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getXtermTheme(themeId);
    }
  }, [themeId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: xtermColors,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      openUrl(uri).catch((e) => console.error("Failed to open URL:", e));
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Input handler
    terminal.onData((data) => {
      sendTerminalInput(terminalId, data).catch((e) =>
        console.error("Failed to send input:", e)
      );
    });

    // Listen for output
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listenTerminalOutput(terminalId, (data) => {
      terminal.write(data);
    }).then((unlisten) => {
      if (cancelled) { unlisten(); return; }
      unlistenFn = unlisten;
    });

    // Initial fit
    setTimeout(() => {
      try {
        fitAddon.fit();
        resizeTerminal(terminalId, terminal.cols, terminal.rows);
      } catch {
        // Container might not be visible yet
      }
    }, 100);

    // ResizeObserver for auto-fit
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        try {
          fitAddon.fit();
          resizeTerminal(terminalId, terminal.cols, terminal.rows);
        } catch {
          // ignore fit errors
        }
      }, 100);
    });

    observer.observe(containerRef.current);

    return () => {
      cancelled = true;
      observer.disconnect();
      clearTimeout(resizeTimeout);
      if (unlistenFn) unlistenFn();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- xtermColors used only for initial creation; theme changes handled by separate effect above
  }, [terminalId, resizeTerminal]);

  // Re-fit and focus when visibility changes
  useEffect(() => {
    if (isVisible && fitAddonRef.current && terminalRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (terminalRef.current) {
            resizeTerminal(terminalId, terminalRef.current.cols, terminalRef.current.rows);
            terminalRef.current.focus();
          }
        } catch {
          // ignore
        }
      }, 50);
    }
  }, [isVisible, terminalId, resizeTerminal]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{
        display: isVisible ? "block" : "none",
        backgroundColor: xtermColors.background,
      }}
    />
  );
}
