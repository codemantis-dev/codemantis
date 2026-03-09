import { useCallback } from "react";
import { useFileViewerStore, getLanguageFromPath } from "../stores/fileViewerStore";
import { useUiStore } from "../stores/uiStore";
import { readFileContent } from "../lib/tauri-commands";

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

interface UseFileViewerReturn {
  openFile: (filePath: string) => Promise<void>;
  openDiff: (filePath: string, oldContent: string, newContent: string) => void;
}

export function useFileViewer(): UseFileViewerReturn {
  const openFile = useCallback(async (filePath: string) => {
    try {
      const content = await readFileContent(filePath);
      const fileName = filePath.split("/").pop() ?? filePath;
      const language = getLanguageFromPath(filePath);
      const extension = getExtension(filePath);

      useFileViewerStore.getState().openFile({
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
      console.error("Failed to open file:", e);
    }
  }, []);

  const openDiff = useCallback(
    (filePath: string, oldContent: string, newContent: string) => {
      const fileName = filePath.split("/").pop() ?? filePath;
      const language = getLanguageFromPath(filePath);
      const extension = getExtension(filePath);

      useFileViewerStore.getState().openFile({
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
