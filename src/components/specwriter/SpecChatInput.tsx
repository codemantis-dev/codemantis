import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { Send, Square, Paperclip, FolderTree } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import type { SpecAttachment } from "../../types/spec-writer";
import { useFileDrop } from "../../hooks/useFileDrop";
import { processDroppedPathsForSpec } from "../../lib/file-utils";
import { useSettingsStore } from "../../stores/settingsStore";
import { shouldSend, sendShortcutHint, sendShortcutLabel } from "../../lib/keyboard";
import ProjectFilePicker from "../modals/ProjectFilePicker";

interface Props {
  projectPath: string;
  isOpen?: boolean;
  sendMessage: (projectPath: string, content: string, attachments?: SpecAttachment[]) => Promise<void>;
  cancelStream: (projectPath: string) => void;
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

const EMPTY_ATTACHMENTS: SpecAttachment[] = [];

export default function SpecChatInput({ projectPath, isOpen, sendMessage, cancelStream }: Props) {
  const text = useSpecWriterStore((s) => s.draftText.get(projectPath) ?? "");
  const attachments = useSpecWriterStore((s) => s.draftAttachments.get(projectPath) ?? EMPTY_ATTACHMENTS);
  const setDraftText = useSpecWriterStore((s) => s.setDraftText);
  const setDraftAttachments = useSpecWriterStore((s) => s.setDraftAttachments);
  const clearDraft = useSpecWriterStore((s) => s.clearDraft);
  const isStreaming = useSpecWriterStore((s) => s.planningStreaming.get(projectPath) ?? false);
  const sendShortcut = useSettingsStore((s) => s.settings.sendShortcut);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const alreadyRefPaths = useMemo(
    () => attachments.filter((a) => a.type === "project-ref").map((a) => a.file_path),
    [attachments]
  );

  // Convenience wrappers that support the updater-function pattern
  const setText = useCallback(
    (val: string) => setDraftText(projectPath, val),
    [projectPath, setDraftText]
  );
  const setAttachments = useCallback(
    (val: SpecAttachment[] | ((prev: SpecAttachment[]) => SpecAttachment[])) => {
      if (typeof val === "function") {
        const current = useSpecWriterStore.getState().draftAttachments.get(projectPath) ?? [];
        setDraftAttachments(projectPath, val(current));
      } else {
        setDraftAttachments(projectPath, val);
      }
    },
    [projectPath, setDraftAttachments]
  );

  // Focus textarea when panel opens or project switches
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [isOpen, projectPath]);

  // Tauri native file drop
  const handleFileDrop = useCallback(async (paths: string[]) => {
    const specAtts = await processDroppedPathsForSpec(paths);
    setAttachments((prev) => [...prev, ...specAtts]);
  }, [setAttachments]);
  const { isDragOver } = useFileDrop({
    id: "spec-chat-input",
    containerRef,
    onDrop: handleFileDrop,
    priority: 10,
  });

  const handleSend = useCallback(async () => {
    const store = useSpecWriterStore.getState();
    const currentText = (store.draftText.get(projectPath) ?? "").trim();
    const currentAtts = store.draftAttachments.get(projectPath) ?? [];
    if (!currentText && currentAtts.length === 0) return;
    if (isStreaming) return;

    clearDraft(projectPath);

    await sendMessage(projectPath, currentText, currentAtts.length > 0 ? [...currentAtts] : undefined);
  }, [projectPath, sendMessage, isStreaming, clearDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && isStreaming) {
        e.preventDefault();
        cancelStream(projectPath);
        return;
      }
      if (shouldSend(e, sendShortcut)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, sendShortcut, isStreaming, cancelStream, projectPath]
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
    [setAttachments]
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
    [setAttachments]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, [setAttachments]);

  const handlePickerConfirm = useCallback(
    (relPaths: string[]) => {
      setAttachments((prev) => {
        const existing = new Set(
          prev.filter((a) => a.type === "project-ref").map((a) => a.file_path)
        );
        const additions: SpecAttachment[] = [];
        for (const p of relPaths) {
          if (existing.has(p)) continue;
          const name = p.split("/").pop() || p;
          additions.push({
            id: `ref-${Date.now()}-${additions.length}`,
            type: "project-ref",
            name,
            size: 0,
            mime_type: "text/plain",
            file_path: p,
          });
        }
        return additions.length === 0 ? prev : [...prev, ...additions];
      });
    },
    [setAttachments]
  );

  return (
    <div
      ref={containerRef}
      className={`border-t px-3 py-2 shrink-0 transition-colors ${isDragOver ? "ring-2 ring-inset ring-[var(--accent)]" : ""}`}
      style={{
        borderColor: "var(--border)",
        background: isDragOver ? "var(--bg-elevated)" : undefined,
      }}
    >
      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((att) => {
            const isRef = att.type === "project-ref";
            const label = isRef ? att.file_path : att.name;
            return (
              <div
                key={att.id}
                className="flex items-center gap-1 px-2 py-1 rounded text-ui"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
                title={isRef ? `Project reference: ${att.file_path}` : att.name}
              >
                {att.type === "image" && att.preview_url && (
                  <img src={att.preview_url} alt="" className="w-6 h-6 rounded object-cover" />
                )}
                {att.type === "document" && <Paperclip size={12} />}
                {isRef && <FolderTree size={12} />}
                <span className={`truncate ${isRef ? "max-w-[200px]" : "max-w-[100px]"}`}>{label}</span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="ml-1 hover:opacity-70"
                  style={{ color: "var(--text-ghost)" }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            className="p-1.5 rounded hover:bg-bg-elevated transition-colors"
            style={{ color: "var(--text-ghost)" }}
          >
            <Paperclip size={14} />
          </button>
          <button
            onClick={() => setPickerOpen(true)}
            title="Select from project folder"
            className="p-1.5 rounded hover:bg-bg-elevated transition-colors"
            style={{ color: "var(--text-ghost)" }}
          >
            <FolderTree size={14} />
          </button>
        </div>
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
          rows={9}
          className="flex-1 resize-none rounded-md px-3 py-2 text-chat outline-none"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            maxHeight: 375,
          }}
          disabled={isStreaming}
        />

        {isStreaming ? (
          <button
            onClick={() => cancelStream(projectPath)}
            title="Stop generation (Esc)"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-ui font-medium transition-colors shrink-0"
            style={{ color: "var(--error, #ef4444)", background: "color-mix(in srgb, var(--error, #ef4444) 15%, transparent)" }}
          >
            <Square size={12} fill="currentColor" />
            <span>Stop</span>
            <span className="text-label opacity-60">Esc</span>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() && attachments.length === 0}
            title={`Send (${sendShortcut === "enter" ? "Enter" : "Cmd+Enter"})`}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-ui font-medium transition-colors shrink-0 ${
              text.trim() || attachments.length > 0
                ? "bg-accent text-white hover:bg-accent-light"
                : "bg-bg-subtle text-text-ghost cursor-not-allowed"
            }`}
          >
            <Send size={13} />
            <span>Send</span>
            <span className="text-label opacity-60">{sendShortcutLabel(sendShortcut)}</span>
          </button>
        )}
      </div>

      <div className="text-detail mt-1 flex justify-center gap-3 select-none" style={{ color: "var(--text-ghost)" }}>
        <span>{sendShortcutHint(sendShortcut)}</span>
        {isStreaming && <span>Esc to stop</span>}
      </div>

      <ProjectFilePicker
        open={pickerOpen}
        projectPath={projectPath}
        alreadySelectedPaths={alreadyRefPaths}
        onClose={() => setPickerOpen(false)}
        onConfirm={handlePickerConfirm}
      />
    </div>
  );
}
