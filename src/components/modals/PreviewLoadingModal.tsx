import * as Dialog from "@radix-ui/react-dialog";
import { Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePreviewStore } from "../../stores/previewStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { DevServerProgressEvent } from "../../types/preview";

interface ProgressLine {
  id: number;
  text: string;
}

const MAX_LINES = 3;

/**
 * Non-interactive modal shown while the dev server is starting and
 * CodeMantis is scanning for the port.  Dismisses automatically once
 * the preview window opens (status moves to "running") or on error.
 *
 * Streams a 3-line transcript of detection progress (terminal scan,
 * lsof discovery, port probes) so users can see *why* a slow start is
 * slow instead of staring at an opaque spinner.
 */
export default function PreviewLoadingModal() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const devServer = usePreviewStore((s) =>
    activeProjectPath ? s.devServer.get(activeProjectPath) : undefined,
  );

  const open =
    devServer?.status === "starting" || devServer?.status === "scanning";

  const [lines, setLines] = useState<ProgressLine[]>([]);
  const idRef = useRef(0);

  // Subscribe to progress events for the active project. Reset transcript
  // when the modal closes so the next start begins fresh.
  useEffect(() => {
    if (!open || !activeProjectPath) {
      setLines([]);
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<DevServerProgressEvent>("dev-server-progress", (e) => {
      if (e.payload.projectPath !== activeProjectPath) return;
      const text = e.payload.message;
      idRef.current += 1;
      const id = idRef.current;
      setLines((prev) => {
        // Drop consecutive duplicates so noisy probes don't spam the UI
        if (prev[prev.length - 1]?.text === text) return prev;
        return [...prev, { id, text }].slice(-MAX_LINES);
      });
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [open, activeProjectPath]);

  if (!open) return null;

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] rounded-xl border border-border p-6"
          style={{ background: "var(--bg-primary)" }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-accent/10">
              <Globe size={24} className="text-accent animate-pulse" />
            </div>

            <Dialog.Title className="text-text-primary font-medium text-title">
              Opening preview&hellip;
            </Dialog.Title>

            <Dialog.Description className="text-ui text-text-dim">
              Starting the dev server and detecting the port.
              <br />
              This may take a moment.
            </Dialog.Description>

            {/* Spinner bar */}
            <div className="w-full h-1 rounded-full bg-bg-elevated overflow-hidden mt-1">
              <div
                className="h-full bg-accent rounded-full"
                style={{
                  width: "40%",
                  animation: "preview-loading-bar 1.5s ease-in-out infinite",
                }}
              />
            </div>

            {/* Progress transcript */}
            {lines.length > 0 && (
              <div
                className="w-full mt-2 px-3 py-2 rounded-md text-left text-text-dim font-mono text-xs leading-snug"
                style={{
                  background: "var(--bg-elevated)",
                  minHeight: `${MAX_LINES * 1.25}rem`,
                }}
                aria-live="polite"
              >
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className="truncate"
                    title={line.text}
                  >
                    {line.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          <style>{`
            @keyframes preview-loading-bar {
              0%   { transform: translateX(-100%); }
              50%  { transform: translateX(150%); }
              100% { transform: translateX(-100%); }
            }
          `}</style>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
