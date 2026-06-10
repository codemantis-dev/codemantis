import { useState, useEffect, useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TerminalSquare, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useAssistantStore } from "../../stores/assistantStore";
import { useTerminalStore } from "../../stores/terminalStore";
import {
  createTerminal as createTerminalCmd,
  closeTerminal as closeTerminalCmd,
  sendTerminalInput,
  pauseSessionProcess,
  resumeSessionProcess,
} from "../../lib/tauri-commands";
import { handleError } from "../../lib/error-handler";
import { translateError } from "../../lib/error-messages";
import ErrorCard from "../shared/ErrorCard";
import TerminalView from "../rightpanel/TerminalView";

export default function CliOverlay() {
  const showOverlay = useUiStore((s) => s.showCliOverlay);
  const setShowOverlay = useUiStore((s) => s.setShowCliOverlay);
  const claudeBinaryPath = useUiStore((s) => s.claudeBinaryPath);
  const codexBinaryPath = useUiStore((s) => s.codexBinaryPath);
  const cliOverlaySessionId = useUiStore((s) => s.cliOverlaySessionId);
  const cliOverlayProjectPath = useUiStore((s) => s.cliOverlayProjectPath);
  const mainActiveSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);

  // Use the explicit target session (from assistant), falling back to main session
  const activeSessionId = cliOverlaySessionId ?? mainActiveSessionId;

  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closingRef = useRef(false);
  const terminalIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Whether the open flow paused (shut down) the session's CLI process, so
  // the close flow knows it must resume it. True for Claude always, and for
  // Codex in resume-tui mode (where the app-server is torn down so the real
  // `codex resume` TUI owns the rollout file exclusively).
  const pausedRef = useRef(false);

  // For main sessions: look up from sessionStore. For assistants: use explicit project path + assistant store.
  const mainSession = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const projectPath = mainSession?.project_path ?? cliOverlayProjectPath;
  const assistantCliSessionId = useAssistantStore((s) => activeSessionId ? s.cliSessionIds.get(activeSessionId) : undefined);
  const cliSessionId = mainSession?.cli_session_id ?? assistantCliSessionId;

  // v1.5.0 — agent-aware dispatch. Claude sessions spawn `claude
  // --resume <cli_session_id>`; Codex sessions spawn `codex` (bare TUI)
  // or `codex <subcommand>` from cliOverlayInitialInput like
  // "/login" / "/mcp" / "/logout". Codex's subcommands are
  // top-level argv entries, NOT TUI slash commands — so we pass them
  // as args instead of sending them as keystrokes.
  const agentId = mainSession?.agent_id ?? "claude_code";
  const isCodex = agentId === "codex";
  const binaryPath = isCodex ? codexBinaryPath : claudeBinaryPath;
  const overlayTitle = isCodex ? "Codex CLI" : "Claude CLI";
  const overlayHint = isCodex
    ? "— /plan, /model, /approvals, /review  ·  /login, /logout  (config & MCP: Codex panel)"
    : "— /model, /config, /doctor, /help";

  // Open flow: pause stream-json → spawn interactive CLI → user interacts
  useEffect(() => {
    if (!showOverlay || !activeSessionId || !projectPath || !binaryPath) return;

    let cancelled = false;
    sessionIdRef.current = activeSessionId;
    setLoading(true);
    setError(null);

    // Codex resume-tui mode → spawn the real `codex resume <thread_id>` TUI,
    // exactly like Claude's overlay. Requires tearing down the app-server so
    // the TUI owns the rollout file. Any other Codex command is a one-shot
    // subcommand (`codex login`, …) that doesn't touch the running thread.
    const codexResumeTui =
      isCodex && useUiStore.getState().cliOverlayCodexMode === "resume-tui";

    const openOverlay = async () => {
      try {
        // Step 1: Pause (shut down) the session's CLI process when the
        // overlay will run a SECOND instance against the same conversation:
        //   • Claude → always (`claude --resume`).
        //   • Codex resume-tui → `codex resume <thread_id>` must own the
        //     rollout file exclusively; the app-server is re-attached on
        //     close via `thread/resume` (→ `thread/start` fallback).
        // Codex one-shot subcommands (`codex login`, etc.) are independent
        // processes that don't touch the thread, so we keep the app-server
        // ALIVE — killing it there is what made closing call `thread/resume`
        // → "no rollout found" → dead session.
        if (!isCodex || codexResumeTui) {
          await pauseSessionProcess(activeSessionId);
          pausedRef.current = true;
        }

        if (cancelled) return;

        // Step 2: Build args for the interactive CLI. Three protocols:
        //   • Claude → bare CLI with `--resume <cli_session_id>` so the
        //     user lands in the conversation they were having. The initial
        //     slash command (e.g. /config) is sent as keystrokes via
        //     Claude's TUI slash-command grammar.
        //   • Codex resume-tui → `codex resume <thread_id>` lands directly
        //     in the thread's real TUI (no picker), and the slash command
        //     (e.g. /plan) is keystroked in — the exact analog of Claude.
        //   • Codex subcommand → subcommands are top-level argv (e.g.
        //     `codex login`), NOT TUI slash commands. We parse the
        //     initialInput (e.g. "/login") into argv and DON'T keystroke —
        //     argv carries the intent. No initialInput → bare `codex`.
        const initialInput = useUiStore.getState().cliOverlayInitialInput;
        const termArgs: string[] = [];
        let consumedInitialInput = false;
        if (codexResumeTui) {
          // Real interactive TUI resumed into the current thread — the exact
          // analog of Claude's `--resume`. `codex resume <SESSION_ID>` opens
          // the thread directly (no picker; verified on cli 0.139.0). The
          // slash command (e.g. /plan) flows through keystrokes below, just
          // like Claude. With no thread id yet, fall back to bare `codex`.
          if (cliSessionId) {
            termArgs.push("resume", cliSessionId);
          }
        } else if (isCodex) {
          if (initialInput) {
            // "/login" → ["login"], "/mcp list" → ["mcp", "list"]
            const stripped = initialInput.replace(/^\//, "").trim();
            if (stripped) {
              termArgs.push(...stripped.split(/\s+/));
              consumedInitialInput = true;
            }
          }
          // else: bare `codex` opens the interactive TUI.
        } else {
          if (cliSessionId) {
            termArgs.push("--resume", cliSessionId);
          }
          // Claude's initial input flows through keystrokes below.
        }

        // Step 3: Spawn the interactive CLI in a PTY
        const info = await createTerminalCmd(
          activeSessionId,
          projectPath,
          binaryPath,
          overlayTitle,
          termArgs.length > 0 ? termArgs : undefined
        );

        if (cancelled) {
          closeTerminalCmd(info.id).catch(() => {});
          return;
        }

        useTerminalStore.getState().addTerminal(activeSessionId, {
          id: info.id,
          sessionId: activeSessionId,
          name: info.name,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
          isRunning: true,
          kind: "cli-overlay",
        });
        terminalIdRef.current = info.id;
        setTerminalId(info.id);
        setLoading(false);

        // For Claude (or Codex with no argv-consumed initial input):
        // send the pre-typed command as keystrokes. Codex consumes its
        // initial input via argv above so this branch only fires for
        // the Claude path.
        if (initialInput && !consumedInitialInput) {
          // Codex's TUI has to load+render the resumed thread before it
          // accepts input, so give it more headroom than Claude.
          const inputDelay = codexResumeTui ? 1200 : 800;
          setTimeout(() => {
            sendTerminalInput(info.id, initialInput + "\n").catch((e) =>
              console.error("[cli-overlay] Failed to send initial input:", e)
            );
            useUiStore.getState().setCliOverlayInitialInput(null);
          }, inputDelay);
        } else if (consumedInitialInput) {
          // Codex consumed argv — clear the staged input so it doesn't
          // re-fire on the next overlay open.
          useUiStore.getState().setCliOverlayInitialInput(null);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[cli-overlay] Failed to open:", e);
          setError(String(e));
          setLoading(false);
          // Try to resume the CLI process so the session isn't left stuck —
          // but ONLY if we actually paused it. For a Codex one-shot
          // subcommand we never paused, and resuming would risk the "no
          // rollout" failure.
          if (pausedRef.current) {
            pausedRef.current = false;
            resumeSessionProcess(activeSessionId, cliSessionId ?? undefined).catch((re) =>
              console.error("[cli-overlay] Failed to recover session:", re)
            );
          }
        }
      }
    };

    openOverlay();

    return () => {
      cancelled = true;
    };
  }, [showOverlay, activeSessionId, projectPath, binaryPath, cliSessionId, isCodex, overlayTitle]);

  // Close flow: kill PTY → resume stream-json with --resume
  const handleClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;

    const tid = terminalIdRef.current;
    const sid = sessionIdRef.current;
    // Resume only if the open flow actually paused the CLI process (Claude
    // always; Codex only in resume-tui mode). A one-shot Codex subcommand
    // never paused, so resuming would risk the "no rollout" failure.
    const didPause = pausedRef.current;
    pausedRef.current = false;
    const currentCliSessionId =
      useSessionStore.getState().sessions.get(sid ?? "")?.cli_session_id
      ?? useAssistantStore.getState().cliSessionIds.get(sid ?? "");

    // Close the overlay UI immediately
    terminalIdRef.current = null;
    setTerminalId(null);
    setShowOverlay(false);

    try {
      // Step 1: Close the interactive PTY terminal
      if (tid && sid) {
        await closeTerminalCmd(tid);
        useTerminalStore.getState().removeTerminal(sid, tid);
      }

      // Step 2: Resume the CLI process if we paused it. For Codex resume-tui
      // this re-attaches via `thread/resume` (→ `thread/start` fallback),
      // picking up any state the TUI persisted to the rollout (model swap,
      // plan, etc.). A one-shot Codex subcommand never paused → skip, since
      // resuming would trigger `thread/resume` → "no rollout found".
      if (sid && didPause) {
        await resumeSessionProcess(sid, currentCliSessionId ?? undefined);
      }
    } catch (e) {
      handleError("cli-overlay: Error during close", e);
    } finally {
      closingRef.current = false;
      setError(null);
      setLoading(false);
    }
  }, [setShowOverlay]);

  return (
    <Dialog.Root
      open={showOverlay}
      onOpenChange={(open) => {
        if (!open) handleClose();
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
          onEscapeKeyDown={() => handleClose()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-light shrink-0">
            <div className="flex items-center gap-2">
              <TerminalSquare size={15} className="text-accent" />
              <Dialog.Title className="text-ui text-text-primary font-medium">
                {overlayTitle}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                {overlayTitle} terminal overlay
              </Dialog.Description>
              <span className="text-label text-text-ghost">
                {overlayHint}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-label text-text-ghost">Esc to close</span>
              <button
                onClick={handleClose}
                aria-label="Close CLI overlay"
                className="text-text-dim hover:text-text-primary transition-colors p-0.5 rounded hover:bg-bg-elevated"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden relative">
            {loading && (
              <div className="h-full flex items-center justify-center">
                <p className="text-text-dim text-ui">
                  Pausing session and starting {overlayTitle}...
                </p>
              </div>
            )}
            {error && (
              <div className="h-full flex items-center justify-center p-8">
                <div className="max-w-md w-full">
                  <ErrorCard
                    {...translateError(error)}
                    rawError={error}
                  />
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
