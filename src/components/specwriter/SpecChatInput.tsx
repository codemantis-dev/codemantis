import { useState, useRef, useCallback } from "react";
import { Send, Square, Paperclip } from "lucide-react";
import { useSpecConversation } from "../../hooks/useSpecConversation";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import type { SpecAttachment } from "../../types/spec-writer";

interface Props {
  projectPath: string;
}

/** Convert a browser File to a base64 data URI */
function fileToBrowserBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Resize an image data URI so the longest edge is at most maxSize px */
function resizeImage(dataUri: string, maxSize: number = 1024): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      if (width <= maxSize && height <= maxSize) {
        resolve(dataUri);
        return;
      }
      const ratio = Math.min(maxSize / width, maxSize / height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUri);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUri);
    img.src = dataUri;
  });
}

export default function SpecChatInput({ projectPath }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<SpecAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const { sendMessage, cancelStream } = useSpecConversation();
  const isStreaming = useSpecWriterStore((s) => s.planningStreaming.get(projectPath) ?? false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isStreaming) return;

    setText("");
    const atts = [...attachments];
    setAttachments([]);

    await sendMessage(projectPath, trimmed, atts.length > 0 ? atts : undefined);
  }, [text, attachments, projectPath, sendMessage, isStreaming]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const rawUri = await fileToBrowserBase64(file);
          const dataUri = await resizeImage(rawUri);
          const att: SpecAttachment = {
            id: `att-${Date.now()}-${i}`,
            type: "image",
            name: file.name || `paste-${Date.now()}.png`,
            size: file.size,
            mime_type: file.type,
            preview_url: dataUri,
            file_path: "",
          };
          setAttachments((prev) => [...prev, att]);
        }
      }
    },
    []
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage = file.type.startsWith("image/");
        let att: SpecAttachment;
        if (isImage) {
          const rawUri = await fileToBrowserBase64(file);
          const dataUri = await resizeImage(rawUri);
          att = {
            id: `att-${Date.now()}-${i}`,
            type: "image",
            name: file.name,
            size: file.size,
            mime_type: file.type,
            preview_url: dataUri,
            file_path: "",
          };
        } else {
          const textContent = await file.text();
          att = {
            id: `att-${Date.now()}-${i}`,
            type: "document",
            name: file.name,
            size: file.size,
            mime_type: file.type,
            text_content: textContent.slice(0, 10000) + (textContent.length > 10000 ? "..." : ""),
            file_path: "",
          };
        }
        setAttachments((prev) => [...prev, att]);
      }
      e.target.value = "";
    },
    []
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage = file.type.startsWith("image/");
        let att: SpecAttachment;
        if (isImage) {
          const rawUri = await fileToBrowserBase64(file);
          const dataUri = await resizeImage(rawUri);
          att = {
            id: `att-${Date.now()}-${i}`,
            type: "image",
            name: file.name,
            size: file.size,
            mime_type: file.type,
            preview_url: dataUri,
            file_path: "",
          };
        } else {
          const textContent = await file.text();
          att = {
            id: `att-${Date.now()}-${i}`,
            type: "document",
            name: file.name,
            size: file.size,
            mime_type: file.type,
            text_content: textContent.slice(0, 10000) + (textContent.length > 10000 ? "..." : ""),
            file_path: "",
          };
        }
        setAttachments((prev) => [...prev, att]);
      }
    },
    []
  );

  return (
    <div
      className={`border-t px-3 py-2 shrink-0 transition-colors ${isDragOver ? "ring-2 ring-inset ring-[var(--accent)]" : ""}`}
      style={{
        borderColor: "var(--border)",
        background: isDragOver ? "var(--bg-elevated)" : undefined,
      }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
            >
              {att.type === "image" && att.preview_url && (
                <img src={att.preview_url} alt="" className="w-6 h-6 rounded object-cover" />
              )}
              {att.type === "document" && <Paperclip size={12} />}
              <span className="truncate max-w-[100px]">{att.name}</span>
              <button
                onClick={() => removeAttachment(att.id)}
                className="ml-1 hover:opacity-70"
                style={{ color: "var(--text-ghost)" }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
          className="p-1.5 rounded hover:bg-bg-elevated transition-colors shrink-0"
          style={{ color: "var(--text-ghost)" }}
        >
          <Paperclip size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf,.txt,.md,.docx"
          multiple
          onChange={handleFileSelect}
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Describe what you want to build..."
          rows={6}
          className="flex-1 resize-none rounded-md px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            maxHeight: 250,
          }}
          disabled={isStreaming}
        />

        {isStreaming ? (
          <button
            onClick={() => cancelStream(projectPath)}
            title="Stop generation"
            className="p-1.5 rounded transition-colors shrink-0"
            style={{ color: "var(--error, #ef4444)" }}
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() && attachments.length === 0}
            title="Send (Cmd+Enter)"
            className="p-1.5 rounded transition-colors shrink-0 disabled:opacity-30"
            style={{ color: "var(--accent)" }}
          >
            <Send size={16} />
          </button>
        )}
      </div>

      <div className="text-[10px] mt-1 text-center select-none" style={{ color: "var(--text-ghost)" }}>
        Cmd+Enter to send
      </div>
    </div>
  );
}
