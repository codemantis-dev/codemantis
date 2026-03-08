import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listenTerminalOutput, sendTerminalInput } from "../../lib/tauri-commands";
import { useTerminal } from "../../hooks/useTerminal";
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

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
        cursor: "#a78bfa",
        selectionBackground: "rgba(124, 58, 237, 0.3)",
        black: "#09090b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#fafafa",
      },
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

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
    let unlistenFn: (() => void) | null = null;
    listenTerminalOutput(terminalId, (data) => {
      terminal.write(data);
    }).then((unlisten) => {
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
      observer.disconnect();
      clearTimeout(resizeTimeout);
      if (unlistenFn) unlistenFn();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId, resizeTerminal]);

  // Re-fit when visibility changes
  useEffect(() => {
    if (isVisible && fitAddonRef.current && terminalRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (terminalRef.current) {
            resizeTerminal(terminalId, terminalRef.current.cols, terminalRef.current.rows);
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
      style={{ display: isVisible ? "block" : "none" }}
    />
  );
}
