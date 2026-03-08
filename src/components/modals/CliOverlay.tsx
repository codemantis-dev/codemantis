import { useState, useEffect, useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TerminalSquare, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useTerminalStore } from "../../stores/terminalStore";
import {
  createTerminal as createTerminalCmd,
  closeTerminal as closeTerminalCmd,
  pauseSessionProcess,
  resumeSessionProcess,
} from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";
import TerminalView from "../rightpanel/TerminalView";

export default function CliOverlay() {
  const showOverlay = useUiStore((s) => s.showCliOverlay);
  const setShowOverlay = useUiStore((s) => s.setShowCliOverlay);
  const claudeBinaryPath = useUiStore((s) => s.claudeBinaryPath);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);

  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closingRef = useRef(false);
  const terminalIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const session = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const cliSessionId = session?.cli_session_id;

  // Open flow: pause stream-json → spawn interactive claude --resume → user interacts
  useEffect(() => {
    if (!showOverlay || !activeSessionId || !session || !claudeBinaryPath) return;

    let cancelled = false;
    sessionIdRef.current = activeSessionId;
    setLoading(true);
    setError(null);

    const openOverlay = async () => {
      try {
        // Step 1: Pause the stream-json process
        console.log("[cli-overlay] Pausing session process:", activeSessionId);
        await pauseSessionProcess(activeSessionId);

        if (cancelled) return;

        // Step 2: Build args for interactive claude
        const termArgs: string[] = [];
        if (cliSessionId) {
          termArgs.push("--resume", cliSessionId);
        }

        // Step 3: Spawn interactive claude CLI in PTY
        console.log("[cli-overlay] Spawning interactive CLI with args:", termArgs);
        const info = await createTerminalCmd(
          activeSessionId,
          session.project_path,
          claudeBinaryPath,
          "Claude CLI",
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
      } catch (e) {
        if (!cancelled) {
          console.error("[cli-overlay] Failed to open:", e);
          setError(String(e));
          setLoading(false);
          // Try to resume the stream-json process so session isn't stuck
          resumeSessionProcess(activeSessionId, cliSessionId ?? undefined).catch((re) =>
            console.error("[cli-overlay] Failed to recover session:", re)
          );
        }
      }
    };

    openOverlay();

    return () => {
      cancelled = true;
    };
  }, [showOverlay, activeSessionId, session, claudeBinaryPath, cliSessionId]);

  // Close flow: kill PTY → resume stream-json with --resume
  const handleClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;

    const tid = terminalIdRef.current;
    const sid = sessionIdRef.current;
    const currentCliSessionId = useSessionStore.getState().sessions.get(sid ?? "")?.cli_session_id;

    // Close the overlay UI immediately
    terminalIdRef.current = null;
    setTerminalId(null);
    setShowOverlay(false);

    try {
      // Step 1: Close the interactive PTY terminal
      if (tid && sid) {
        console.log("[cli-overlay] Closing PTY terminal:", tid);
        await closeTerminalCmd(tid);
        useTerminalStore.getState().removeTerminal(sid, tid);
      }

      // Step 2: Resume the stream-json process (backend falls back to stored CLI session ID)
      if (sid) {
        console.log("[cli-overlay] Resuming stream-json process:", sid, "cli_session_id:", currentCliSessionId);
        await resumeSessionProcess(sid, currentCliSessionId ?? undefined);
        console.log("[cli-overlay] Session resumed successfully");
      }
    } catch (e) {
      console.error("[cli-overlay] Error during close:", e);
      showToast(`Failed to resume session: ${String(e)}`, "error");
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
                Claude CLI
              </Dialog.Title>
              <span className="text-label text-text-ghost">
                — /model, /config, /doctor, /help
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-label text-text-ghost">Esc to close</span>
              <button
                onClick={handleClose}
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
                  Pausing session and starting Claude CLI...
                </p>
              </div>
            )}
            {error && (
              <div className="h-full flex items-center justify-center p-4">
                <div className="text-center">
                  <p className="text-red text-ui mb-2">Failed to start Claude CLI</p>
                  <p className="text-text-dim text-label">{error}</p>
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
