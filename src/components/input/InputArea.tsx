import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type DragEvent } from "react";
import { Send, Plus, AtSign } from "lucide-react";
import type { ThinkingEffort } from "../../types/session";
import { useSessionStore } from "../../stores/sessionStore";
import { useAttachmentStore } from "../../stores/attachmentStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { useUiStore } from "../../stores/uiStore";
import { saveClipboardImage, getFileInfo, readFileBytes } from "../../lib/tauri-commands";
import { open } from "@tauri-apps/plugin-dialog";
import AttachmentBar from "./AttachmentBar";
import ModeSelector from "./ModeSelector";
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

function formatModelName(model: string | null | undefined): string | null {
  if (!model) return null;
  // "claude-opus-4-20250514" → "Opus 4"
  // "claude-sonnet-4-6-20250514" → "Sonnet 4.6"
  // "claude-haiku-4-5-20241022" → "Haiku 4.5"
  const m = model.toLowerCase();
  const families = ["opus", "sonnet", "haiku"];
  for (const family of families) {
    const idx = m.indexOf(family);
    if (idx === -1) continue;
    const after = m.slice(idx + family.length).replace(/^-/, "");
    // Extract version numbers before the date stamp (8+ digits)
    const versionPart = after.replace(/-?\d{8,}.*$/, "").replace(/-/g, ".");
    const name = family.charAt(0).toUpperCase() + family.slice(1);
    return versionPart ? `${name} ${versionPart}` : name;
  }
  return model;
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
  const { executeCommand } = useCommandExecution();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionStreaming = useSessionStore((s) => s.sessionStreaming);

  const session = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const streaming = activeSessionId
    ? sessionStreaming.get(activeSessionId)
    : undefined;
  const isStreaming = streaming?.isStreaming ?? false;

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

  const attachments = useAttachmentStore((s) => s.attachments);
  const addAttachment = useAttachmentStore((s) => s.addAttachment);
  const clearAttachments = useAttachmentStore((s) => s.clearAttachments);

  const { sendMessage } = useClaudeSession();
  const sessionModes = useSessionStore((s) => s.sessionModes);

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
    clearAttachments();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(activeSessionId, prompt);
  }, [input, activeSessionId, isStreaming, sendMessage, attachments, clearAttachments, sessionModes]);

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
            addAttachment({
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
          }
          return; // Only handle one image
        }
      }
    },
    [session, addAttachment]
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
            addAttachment({
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
            addAttachment({
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
        }
      }
    },
    [session, addAttachment]
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
          addAttachment({
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
        }
      }
    } catch (err) {
      console.error("File dialog error:", err);
    }
  }, [session, addAttachment]);

  const sessionEffort = useSessionStore((s) => s.sessionEffort);
  const effort: ThinkingEffort = activeSessionId
    ? sessionEffort.get(activeSessionId) ?? "high"
    : "high";

  const modelName = formatModelName(session?.model);
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
          <AttachmentBar />

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
                ? "Ask Claude anything... (\u2318+Enter to send)"
                : "Open a project to start..."
            }
            disabled={!session}
            rows={3}
            className="w-full resize-none bg-transparent px-4 py-3 text-chat text-text-primary placeholder:text-text-ghost outline-none"
          />

          {/* Action bar */}
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-1">
              <ModeSelector />
              <div className="w-px h-4 bg-border-light mx-0.5" />
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
                  {modelName && (
                    <span className="text-label text-text-ghost">
                      {modelName}
                    </span>
                  )}
                  <button
                    onClick={() => useUiStore.getState().setShowCliOverlay(true)}
                    className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-dim hover:bg-bg-subtle transition-colors"
                    title={`Thinking: ${effort} — click to open CLI and change with /config`}
                  >
                    <EffortBars effort={effort} />
                    <span className="capitalize">{effort}</span>
                  </button>
                </div>
              )}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
