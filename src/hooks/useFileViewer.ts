import { useCallback } from "react";
import { useFileViewerStore, getLanguageFromPath } from "../stores/fileViewerStore";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { readFileContent } from "../lib/tauri-commands";
import { showToast } from "../stores/toastStore";

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
    const projectPath = useSessionStore.getState().activeProjectPath;
    if (!projectPath) return;
    try {
      const content = await readFileContent(filePath);
      const fileName = filePath.split("/").pop() ?? filePath;
      const language = getLanguageFromPath(filePath);
      const extension = getExtension(filePath);

      useFileViewerStore.getState().openFile(projectPath, {
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
      showToast("Failed to open file", "error");
    }
  }, []);

  const openDiff = useCallback(
    (filePath: string, oldContent: string, newContent: string) => {
      const projectPath = useSessionStore.getState().activeProjectPath;
      if (!projectPath) return;
      const fileName = filePath.split("/").pop() ?? filePath;
      const language = getLanguageFromPath(filePath);
      const extension = getExtension(filePath);

      useFileViewerStore.getState().openFile(projectPath, {
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
