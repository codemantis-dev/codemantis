import { useCallback } from "react";
import { useFileViewerStore, getLanguageFromPath } from "../stores/fileViewerStore";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { readFileContent, readFileBytes } from "../lib/tauri-commands";
import { handleError } from "../lib/error-handler";

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

interface UseFileViewerReturn {
  openFile: (filePath: string) => Promise<void>;
  openDiff: (filePath: string, oldContent: string, newContent: string) => void;
}

export function useFileViewer(): UseFileViewerReturn {
  const openFile = useCallback(async (filePath: string) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;

    const extension = getExtension(filePath);
    const mimeType = IMAGE_EXTENSIONS[extension];

    // Image files → open in modal preview instead of Monaco editor
    if (mimeType) {
      try {
        const bytes = await readFileBytes(filePath);
        const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        const fileName = filePath.split("/").pop() ?? filePath;
        useUiStore.getState().setImagePreview({
          filePath,
          fileName,
          blobUrl,
          fileSize: bytes.length,
        });
      } catch (e) {
        handleError("Failed to open image", e);
      }
      return;
    }

    try {
      const content = await readFileContent(filePath);
      const fileName = filePath.split("/").pop() ?? filePath;
      const language = getLanguageFromPath(filePath);

      useFileViewerStore.getState().openFile(sessionId, {
        filePath,
        fileName,
        language,
        extension,
        fileSize: new Blob([content]).size,
        content,
        isDiff: false,
      });
      useUiStore.getState().setRightTab("files");
    } catch (e) {
      handleError("Failed to open file", e);
    }
  }, []);

  const openDiff = useCallback(
    (filePath: string, oldContent: string, newContent: string) => {
      const sessionId = useSessionStore.getState().activeSessionId;
      if (!sessionId) return;
      const fileName = filePath.split("/").pop() ?? filePath;
      const language = getLanguageFromPath(filePath);
      const extension = getExtension(filePath);

      useFileViewerStore.getState().openFile(sessionId, {
        filePath,
        fileName,
        language,
        extension,
        fileSize: new Blob([newContent]).size,
        content: null,
        isDiff: true,
        oldContent,
        newContent,
      });
      useUiStore.getState().setRightTab("files");
    },
    []
  );

  return { openFile, openDiff };
}
