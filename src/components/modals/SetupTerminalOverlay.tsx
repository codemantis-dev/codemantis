import { useState, useEffect, useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TerminalSquare, X } from "lucide-react";
import { homeDir } from "@tauri-apps/api/path";
import { useUiStore } from "../../stores/uiStore";
import {
  createTerminal as createTerminalCmd,
  closeTerminal as closeTerminalCmd,
  sendTerminalInput,
} from "../../lib/tauri-commands";
import { translateError } from "../../lib/error-messages";
import ErrorCard from "../shared/ErrorCard";
import TerminalView from "../rightpanel/TerminalView";

/** Synthetic terminal-pool key — this overlay owns no real session. */
const SETUP_SESSION_ID = "onboarding-setup";

interface SetupTerminalOverlayProps {
  /** Called once the overlay has fully closed so the caller can re-check auth
   * status (the row should flip to "Logged in" after a successful login). */
  onClosed?: () => void;
}

/**
 * Session-less "Sign in" overlay used from the Welcome screen. Claude login
 * requires a real interactive TTY + browser (it cannot be piped), so we spawn
 * the agent's interactive CLI in a PTY:
 *   - Claude → bare `claude`, then keystroke `/login` to start the browser OAuth.
 *   - Codex  → `codex login` (opens the ChatGPT OAuth in the browser).
 * Unlike {@link CliOverlay} this pauses/resumes no stream-json session — there
 * is none yet on the Welcome screen.
 */
export default function SetupTerminalOverlay({
  onClosed,
}: SetupTerminalOverlayProps): React.ReactElement {
  const show = useUiStore((s) => s.showSetupTerminal);
  const agent = useUiStore((s) => s.setupTerminalAgent);
  const close = useUiStore((s) => s.closeSetupTerminal);
  const claudeBinaryPath = useUiStore((s) => s.claudeBinaryPath);
  const codexBinaryPath = useUiStore((s) => s.codexBinaryPath);

  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const closingRef = useRef(false);

  const isCodex = agent === "codex";
  const binaryPath = isCodex ? codexBinaryPath : claudeBinaryPath;
  const title = isCodex ? "Sign in to OpenAI Codex" : "Sign in to Claude Code";

  useEffect(() => {
    if (!show || !agent || !binaryPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const openTerminal = async (): Promise<void> => {
      try {
        const cwd = await homeDir();
        // Codex carries the login intent as argv; Claude opens bare and we
        // keystroke `/login` below.
        const args = isCodex ? ["login"] : undefined;
        const info = await createTerminalCmd(
          SETUP_SESSION_ID,
          cwd,
          binaryPath,
          title,
          args,
        );
        if (cancelled) {
          closeTerminalCmd(info.id).catch(() => {});
          return;
        }
        terminalIdRef.current = info.id;
        setTerminalId(info.id);
        setLoading(false);
        if (!isCodex) {
          // Give the Claude TUI a moment to render, then start the OAuth flow.
          setTimeout(() => {
            sendTerminalInput(info.id, "/login\n").catch((e) =>
              console.error("[setup-terminal] Failed to send /login:", e),
            );
          }, 800);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[setup-terminal] Failed to open:", e);
          setError(String(e));
          setLoading(false);
        }
      }
    };

    void openTerminal();
    return () => {
      cancelled = true;
    };
  }, [show, agent, binaryPath, isCodex, title]);

  const handleClose = useCallback(async (): Promise<void> => {
    if (closingRef.current) return;
    closingRef.current = true;
    const tid = terminalIdRef.current;
    terminalIdRef.current = null;
    setTerminalId(null);
    close();
    try {
      if (tid) await closeTerminalCmd(tid);
    } catch (e) {
      console.error("[setup-terminal] Error during close:", e);
    } finally {
      closingRef.current = false;
      setError(null);
      setLoading(false);
      onClosed?.();
    }
  }, [close, onClosed]);

  return (
    <Dialog.Root
      open={show}
      onOpenChange={(open) => {
        if (!open) void handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="cli-overlay-content fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border overflow-hidden flex flex-col"
          style={{
            background: "var(--bg-primary)",
            width: "min(80vw, 900px)",
            height: "min(70vh, 600px)",
          }}
          onEscapeKeyDown={() => void handleClose()}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-light shrink-0">
            <div className="flex items-center gap-2">
              <TerminalSquare size={15} className="text-accent" />
              <Dialog.Title className="text-ui text-text-primary font-medium">
                {title}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                {title} — a browser window opens to complete sign-in.
              </Dialog.Description>
              <span className="text-label text-text-ghost">
                — a browser window opens to log in; return here when done
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-label text-text-ghost">Esc to close</span>
              <button
                onClick={() => void handleClose()}
                aria-label="Close sign-in overlay"
                className="text-text-dim hover:text-text-primary transition-colors p-0.5 rounded hover:bg-bg-elevated"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative">
            {loading && (
              <div className="h-full flex items-center justify-center">
                <p className="text-text-dim text-ui">Starting {title}…</p>
              </div>
            )}
            {error && (
              <div className="h-full flex items-center justify-center p-8">
                <div className="max-w-md w-full">
                  <ErrorCard {...translateError(error)} rawError={error} />
                </div>
              </div>
            )}
            {terminalId && !error && (
              <TerminalView terminalId={terminalId} isVisible={true} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
