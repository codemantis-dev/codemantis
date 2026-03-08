import { useState, useRef, useCallback, type KeyboardEvent, type DragEvent } from "react";
import { Send, Plus, Slash, AtSign } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useAttachmentStore } from "../../stores/attachmentStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { saveClipboardImage, getFileInfo } from "../../lib/tauri-commands";
import { open } from "@tauri-apps/plugin-dialog";
import AttachmentBar from "./AttachmentBar";
import ModeSelector from "./ModeSelector";
import SlashCommandPicker from "./SlashCommandPicker";

export default function InputArea() {
  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showSlashPicker, setShowSlashPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionStreaming = useSessionStore((s) => s.sessionStreaming);

  const session = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const streaming = activeSessionId
    ? sessionStreaming.get(activeSessionId)
    : undefined;
  const isStreaming = streaming?.isStreaming ?? false;

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

    // In plan mode, prepend instruction to only plan
    const mode = sessionModes.get(activeSessionId) ?? "normal";
    if (mode === "plan") {
      prompt = "[PLAN MODE] Only describe what you would do step-by-step. Do NOT make any code changes, create files, or run commands. Just explain your plan.\n\n" + prompt;
    }

    setInput("");
    setShowSlashPicker(false);
    clearAttachments();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(activeSessionId, prompt);
  }, [input, activeSessionId, isStreaming, sendMessage, attachments, clearAttachments, sessionModes]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && e.metaKey) {
        e.preventDefault();
        handleSend();
      }
      // Close slash picker on Escape (the picker also handles this, but as a fallback)
      if (e.key === "Escape" && showSlashPicker) {
        setShowSlashPicker(false);
      }
    },
    [handleSend, showSlashPicker]
  );

  const handleInputChange = useCallback((value: string) => {
    setInput(value);

    // Show slash picker when typing "/" at the start of input
    if (value.startsWith("/") && !value.includes(" ") && !value.includes("\n")) {
      setShowSlashPicker(true);
    } else {
      setShowSlashPicker(false);
    }
  }, []);

  const handleSlashSelect = useCallback(
    (command: string, sendImmediately: boolean) => {
      setShowSlashPicker(false);
      if (sendImmediately && activeSessionId && !isStreaming) {
        setInput("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
        sendMessage(activeSessionId, command);
      } else {
        // Fill the input with the command so user can add arguments
        setInput(command + " ");
        textareaRef.current?.focus();
      }
    },
    [activeSessionId, isStreaming, sendMessage]
  );

  const handleSlashClose = useCallback(() => {
    setShowSlashPicker(false);
  }, []);

  const openSlashPicker = useCallback(() => {
    if (!session) return;
    setInput("/");
    setShowSlashPicker(true);
    textareaRef.current?.focus();
  }, [session]);

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
            addAttachment({
              id: `att-${Date.now()}`,
              fileName: info.file_name,
              filePath: info.file_path,
              fileSize: info.file_size,
              mimeType: info.mime_type,
              isImage: info.is_image,
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
            addAttachment({
              id: `att-${Date.now()}-${file.name}`,
              fileName: info.file_name,
              filePath: info.file_path,
              fileSize: info.file_size,
              mimeType: info.mime_type,
              isImage: true,
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
          addAttachment({
            id: `att-${Date.now()}-${info.file_name}`,
            fileName: info.file_name,
            filePath: info.file_path,
            fileSize: info.file_size,
            mimeType: info.mime_type,
            isImage: info.is_image,
          });
        } catch (err) {
          console.error("Failed to get file info:", err);
        }
      }
    } catch (err) {
      console.error("File dialog error:", err);
    }
  }, [session, addAttachment]);

  const isActive = (input.trim().length > 0 || attachments.length > 0) && !!session && !isStreaming;

  // Calculate picker anchor position (above the input container)
  const containerHeight = containerRef.current?.offsetHeight ?? 120;

  return (
    <div
      ref={containerRef}
      className={`relative border-t border-border px-4 py-3 ${dragOver ? "bg-accent/5" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Slash command picker */}
      {showSlashPicker && session && (
        <SlashCommandPicker
          filter={input}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
          anchorBottom={containerHeight}
        />
      )}

      <div className="max-w-[720px] mx-auto">
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
              handleInputChange(e.target.value);
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
                onClick={openSlashPicker}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <Slash size={13} />
                <span>Cmd</span>
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <AtSign size={13} />
                <span>Agent</span>
              </button>
            </div>

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
  );
}
