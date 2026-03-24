import { useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAssistantStore } from "../stores/assistantStore";
import { useFileDrop } from "./useFileDrop";
import {
  saveClipboardImage,
  getFileInfo,
} from "../lib/tauri-commands";
import { createPreviewUrl, processDroppedPaths } from "../lib/file-utils";
import { EMPTY_ARRAY } from "../lib/empty-refs";

interface UseAssistantAttachmentsParams {
  activeAssistantId: string | null;
  activeProjectPath: string | null;
}

interface UseAssistantAttachmentsReturn {
  currentAttachments: import("../types/attachment").Attachment[];
  addAssistantAttachment: (sessionId: string, attachment: import("../types/attachment").Attachment) => void;
  removeAssistantAttachment: (sessionId: string, attachmentId: string) => void;
  clearAssistantAttachments: (sessionId: string) => void;
  inputContainerRef: React.RefObject<HTMLDivElement | null>;
  dragOver: boolean;
  handlePaste: (e: React.ClipboardEvent) => Promise<void>;
  handleFileDialog: () => Promise<void>;
}

export function useAssistantAttachments({
  activeAssistantId,
  activeProjectPath,
}: UseAssistantAttachmentsParams): UseAssistantAttachmentsReturn {
  const currentAttachments = useAssistantStore((s) => activeAssistantId ? s.attachments.get(activeAssistantId) ?? EMPTY_ARRAY : EMPTY_ARRAY);
  const addAssistantAttachment = useAssistantStore((s) => s.addAssistantAttachment);
  const removeAssistantAttachment = useAssistantStore((s) => s.removeAssistantAttachment);
  const clearAssistantAttachments = useAssistantStore((s) => s.clearAssistantAttachments);

  const inputContainerRef = useRef<HTMLDivElement>(null);

  const handleFileDrop = useCallback(async (paths: string[]) => {
    if (!activeAssistantId) return;
    const atts = await processDroppedPaths(paths);
    for (const att of atts) addAssistantAttachment(activeAssistantId, att);
  }, [activeAssistantId, addAssistantAttachment]);

  const { isDragOver: dragOver } = useFileDrop({
    id: "assistant-panel",
    containerRef: inputContainerRef,
    onDrop: handleFileDrop,
    priority: 5,
    enabled: !!activeAssistantId,
  });

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (!activeAssistantId || !activeProjectPath) return;

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
            const info = await saveClipboardImage(activeProjectPath, imageData, filename);
            const thumbnailUrl = info.is_image
              ? await createPreviewUrl(info.file_path, info.mime_type)
              : undefined;
            addAssistantAttachment(activeAssistantId, {
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
          return;
        }
      }
    },
    [activeAssistantId, activeProjectPath, addAssistantAttachment]
  );

  const handleFileDialog = useCallback(async () => {
    if (!activeAssistantId || !activeProjectPath) return;

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
          addAssistantAttachment(activeAssistantId, {
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
  }, [activeAssistantId, activeProjectPath, addAssistantAttachment]);

  return {
    currentAttachments,
    addAssistantAttachment,
    removeAssistantAttachment,
    clearAssistantAttachments,
    inputContainerRef,
    dragOver,
    handlePaste,
    handleFileDialog,
  };
}
