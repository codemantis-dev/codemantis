import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type DragEvent } from "react";
import { Send, Square, Plus, AtSign } from "lucide-react";
import type { ThinkingEffort } from "../../types/session";
import { useSessionStore } from "../../stores/sessionStore";
import { useAttachmentStore } from "../../stores/attachmentStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { useUiStore } from "../../stores/uiStore";
import { saveClipboardImage, getFileInfo, readFileBytes, interruptSession } from "../../lib/tauri-commands";
import { open } from "@tauri-apps/plugin-dialog";
import AttachmentBar from "./AttachmentBar";
import ModeSelector from "./ModeSelector";
import ModelSelector from "./ModelSelector";
import type { Attachment } from "../../types/attachment";
import { showToast } from "../../stores/toastStore";

const EMPTY_ATTACHMENTS: Attachment[] = [];
import { inputDrafts } from "../../lib/input-drafts";
import CommandPalette, { type CommandPaletteHandle } from "./CommandPalette";
import { useCommandExecution } from "../../hooks/useCommandExecution";

/** Read a file via Rust and create a blob: URL for previewing in the webview. */
async function createPreviewUrl(filePath: string, mimeType: string): Promise<string | undefined> {
  try {
    const bytes = await readFileBytes(filePath);
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

function EffortBars({ effort }: { effort: ThinkingEffort }) {
  const count = effort === "high" ? 3 : effort === "medium" ? 2 : 1;
  return (
    <span className="inline-flex gap-px items-end" style={{ height: 12 }}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className="rounded-sm transition-colors"
          style={{
            width: 3,
            height: 4 + i * 3,
            background: i <= count ? "var(--accent)" : "var(--border-light)",
          }}
        />
      ))}
    </span>
  );
}

export default function InputArea() {
  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<CommandPaletteHandle>(null);
  const prevSessionRef = useRef<string | null>(null);
  const { executeCommand } = useCommandExecution();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const session = useSessionStore((s) => s.activeSessionId ? s.sessions.get(s.activeSessionId) ?? null : null);
  const isStreaming = useSessionStore((s) => s.activeSessionId ? s.sessionStreaming.get(s.activeSessionId)?.isStreaming ?? false : false);
  const isBusy = useSessionStore((s) => s.activeSessionId ? s.sessionBusy.get(s.activeSessionId) ?? false : false);

  // Save/restore input drafts per session
  useEffect(() => {
    if (prevSessionRef.current) {
      const currentInput = textareaRef.current?.value ?? "";
      if (currentInput) {
        inputDrafts.set(prevSessionRef.current, currentInput);
      } else {
        inputDrafts.delete(prevSessionRef.current);
      }
    }
    const restored = activeSessionId ? inputDrafts.get(activeSessionId) ?? "" : "";
    setInput(restored);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setShowCommandPalette(false);
    setCommandQuery("");
    setDragOver(false);
    prevSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  const draftInput = useUiStore((s) => s.draftInput);
  const setDraftInput = useUiStore((s) => s.setDraftInput);

  // Consume draftInput from assistant "Use in Chat"
  useEffect(() => {
    if (draftInput !== null) {
      setInput(draftInput);
      setDraftInput(null);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = "auto";
          const maxHeight = 8 * 24;
          el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
          el.focus();
        }
      }, 0);
    }
  }, [draftInput, setDraftInput]);

  // Consume pendingInputInsert — append path text to current input
  const pendingInputInsert = useUiStore((s) => s.pendingInputInsert);
  const setPendingInputInsert = useUiStore((s) => s.setPendingInputInsert);

  useEffect(() => {
    if (pendingInputInsert !== null) {
      setInput((prev) => {
        const separator = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
        return prev + separator + pendingInputInsert;
      });
      setPendingInputInsert(null);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = "auto";
          const maxHeight = 8 * 24;
          el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
          el.focus();
        }
      }, 0);
    }
  }, [pendingInputInsert, setPendingInputInsert]);

  // Global Escape key to interrupt generation
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!activeSessionId || !isBusy) return;
      // Don't intercept if a modal is open
      const ui = useUiStore.getState();
      if (ui.showSettingsModal || ui.showClaudeHistory) return;
      e.preventDefault();
      interruptSession(activeSessionId).catch((e) =>
        console.error("Failed to interrupt session:", e)
      );
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSessionId, isBusy]);

  // Listen for Cmd+/ to open command palette
  useEffect(() => {
    const handler = () => {
      setInput("/");
      setShowCommandPalette(true);
      setCommandQuery("");
      textareaRef.current?.focus();
    };
    window.addEventListener("open-command-palette", handler);
    return () => window.removeEventListener("open-command-palette", handler);
  }, []);

  const attachments = useAttachmentStore((s) => activeSessionId ? s.attachments.get(activeSessionId) ?? EMPTY_ATTACHMENTS : EMPTY_ATTACHMENTS);
  const addAttachment = useAttachmentStore((s) => s.addAttachment);
  const clearAttachments = useAttachmentStore((s) => s.clearAttachments);

  const { sendMessage } = useClaudeSession();

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    const hasAttachments = attachments.length > 0;
    if ((!trimmed && !hasAttachments) || !activeSessionId || isStreaming) return;

    // Build prompt with attachment references
    let prompt = trimmed;
    if (hasAttachments) {
      const attachmentRefs = attachments
        .map((a) => `[Attached file: ${a.filePath}]`)
        .join("\n");
      prompt = attachmentRefs + (trimmed ? "\n\n" + trimmed : "");
    }

    setInput("");
    if (activeSessionId) inputDrafts.delete(activeSessionId);
    clearAttachments(activeSessionId!);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(activeSessionId, prompt);
  }, [input, activeSessionId, isStreaming, sendMessage, attachments, clearAttachments]);

  const handleStop = useCallback(() => {
    if (!activeSessionId || !isBusy) return;
    interruptSession(activeSessionId).catch((e) =>
      console.error("Failed to interrupt session:", e)
    );
  }, [activeSessionId, isBusy]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // When command palette is open, intercept navigation keys
      if (showCommandPalette && paletteRef.current) {
        const handled = paletteRef.current.handleKeyDown(e.key);
        if (handled) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Enter" && e.metaKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showCommandPalette]
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 8 * 24; // 8 rows
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, []);

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (!session) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const now = new Date();
          const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
          const filename = `clipboard_${timeStr}.png`;

          const arrayBuffer = await blob.arrayBuffer();
          const imageData = Array.from(new Uint8Array(arrayBuffer));

          try {
            const info = await saveClipboardImage(
              session.project_path,
              imageData,
              filename
            );
            const thumbnailUrl = info.is_image
              ? await createPreviewUrl(info.file_path, info.mime_type)
              : undefined;
            addAttachment(activeSessionId!, {
              id: `att-${Date.now()}`,
              fileName: info.file_name,
              filePath: info.file_path,
              fileSize: info.file_size,
              mimeType: info.mime_type,
              isImage: info.is_image,
              thumbnailUrl,
            });
          } catch (err) {
            console.error("Failed to save clipboard image:", err);
            showToast("Failed to save clipboard image", "error");
          }
          return; // Only handle one image
        }
      }
    },
    [session, activeSessionId, addAttachment]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (!session) return;

      const files = e.dataTransfer?.files;
      if (!files) return;

      for (const file of files) {
        try {
          // For drag-and-drop we reference the original file path
          // In web context, File objects don't have full paths — use name + save
          const isImage = file.type.startsWith("image/");
          if (isImage) {
            const arrayBuffer = await file.arrayBuffer();
            const imageData = Array.from(new Uint8Array(arrayBuffer));
            const info = await saveClipboardImage(
              session.project_path,
              imageData,
              file.name
            );
            const thumbUrl = await createPreviewUrl(info.file_path, info.mime_type);
            addAttachment(activeSessionId!, {
              id: `att-${Date.now()}-${file.name}`,
              fileName: info.file_name,
              filePath: info.file_path,
              fileSize: info.file_size,
              mimeType: info.mime_type,
              isImage: true,
              thumbnailUrl: thumbUrl,
            });
          } else {
            // Non-image files: just reference by name
            addAttachment(activeSessionId!, {
              id: `att-${Date.now()}-${file.name}`,
              fileName: file.name,
              filePath: file.name, // Limited in web context
              fileSize: file.size,
              mimeType: file.type || "application/octet-stream",
              isImage: false,
            });
          }
        } catch (err) {
          console.error("Failed to process dropped file:", err);
          showToast("Failed to process dropped file", "error");
        }
      }
    },
    [session, activeSessionId, addAttachment]
  );

  const handleFileDialog = useCallback(async () => {
    if (!session) return;

    try {
      const result = await open({
        multiple: true,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
          { name: "Documents", extensions: ["pdf", "txt", "md"] },
          { name: "Code", extensions: ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!result) return;

      const paths = Array.isArray(result) ? result : [result];
      for (const filePath of paths) {
        try {
          const info = await getFileInfo(filePath);
          const previewUrl = info.is_image
            ? await createPreviewUrl(info.file_path, info.mime_type)
            : undefined;
          addAttachment(activeSessionId!, {
            id: `att-${Date.now()}-${info.file_name}`,
            fileName: info.file_name,
            filePath: info.file_path,
            fileSize: info.file_size,
            mimeType: info.mime_type,
            isImage: info.is_image,
            thumbnailUrl: previewUrl,
          });
        } catch (err) {
          console.error("Failed to get file info:", err);
          showToast("Failed to attach file", "error");
        }
      }
    } catch (err) {
      console.error("File dialog error:", err);
      showToast("Failed to open file dialog", "error");
    }
  }, [session, activeSessionId, addAttachment]);

  const effort: ThinkingEffort = useSessionStore((s) => s.activeSessionId
    ? s.sessionEffort.get(s.activeSessionId) ?? "high"
    : "high");

  const isActive = (input.trim().length > 0 || attachments.length > 0) && !!session && !isStreaming;

  return (
    <div
      className={`relative border-t border-border px-4 py-3 ${dragOver ? "bg-accent/5" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-[720px] mx-auto relative">
        {/* Command palette dropdown */}
        {showCommandPalette && session && (
          <CommandPalette
            ref={paletteRef}
            query={commandQuery}
            onSelect={(cmd, args) => {
              setShowCommandPalette(false);
              setInput("");
              executeCommand(cmd, args);
            }}
            onClose={() => {
              setShowCommandPalette(false);
              setInput("");
            }}
          />
        )}

        <div
          className={`rounded-xl border transition-colors focus-within:border-accent/40 ${
            dragOver ? "border-accent/60 bg-accent/5" : "border-border bg-bg-elevated"
          }`}
          style={!dragOver ? { background: "var(--bg-elevated)" } : undefined}
        >
          {/* Attachment bar */}
          <AttachmentBar sessionId={activeSessionId ?? ""} />

          {/* Drop zone overlay text */}
          {dragOver && (
            <div className="px-4 py-2 text-center text-accent text-ui">
              Drop files to attach
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              const newValue = e.target.value;
              if (newValue.startsWith("/") && !newValue.includes("\n")) {
                setShowCommandPalette(true);
                setCommandQuery(newValue.slice(1));
                setInput(newValue);
                handleInput();
                return;
              }
              if (showCommandPalette && !newValue.startsWith("/")) {
                setShowCommandPalette(false);
              }
              setInput(newValue);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              session
                ? isBusy
                  ? "Ask Claude anything... even while Claude is busy! (\u2318+Enter to send)"
                  : "Ask Claude anything... (\u2318+Enter to send)"
                : "Open a project to start..."
            }
            disabled={!session}
            rows={3}
            className="w-full resize-none bg-transparent px-4 py-3 text-chat text-text-primary placeholder:text-text-ghost outline-none"
          />

          {/* Action bar */}
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-1">
              <button
                onClick={handleFileDialog}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <Plus size={13} />
                <span>File</span>
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <AtSign size={13} />
                <span>Agent</span>
              </button>
              <button
                onClick={() => {
                  setInput("/");
                  setShowCommandPalette(true);
                  setCommandQuery("");
                  textareaRef.current?.focus();
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
                title="Command palette (type / or Cmd+/)"
              >
                <span className="font-mono text-xs leading-none">/</span>
                <span>Cmd</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              {session && (
                <div className="flex items-center gap-2 select-none">
                  <ModeSelector />
                  <div className="w-px h-4 bg-border-light" />
                  <ModelSelector />
                  <button
                    onClick={() => useUiStore.getState().setShowSettingsModal(true)}
                    className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-dim hover:bg-bg-subtle transition-colors"
                    title={`Thinking: ${effort} — click to open settings`}
                  >
                    <EffortBars effort={effort} />
                    <span className="capitalize">{effort}</span>
                  </button>
                </div>
              )}
              {isBusy ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui font-medium transition-all text-red hover:brightness-90"
                  style={{ background: "color-mix(in srgb, var(--red) 15%, transparent)" }}
                >
                  <Square size={12} />
                  <span>Stop</span>
                  <span className="text-label opacity-60">Esc</span>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!isActive}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui font-medium transition-all ${
                    isActive
                      ? "bg-accent text-white hover:bg-accent-light"
                      : "bg-bg-subtle text-text-ghost cursor-not-allowed"
                  }`}
                >
                  <Send size={13} />
                  <span>Send</span>
                  <span className="text-label opacity-60">{"⌘↵"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Keyboard shortcut hints */}
          {session && (
            <div className="flex items-center justify-center gap-4 pb-1.5 -mt-0.5 text-[11px] text-text-ghost select-none">
              <span>Shift+Tab to switch mode</span>
              <span>⌘+/⌘− to adjust font size</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
