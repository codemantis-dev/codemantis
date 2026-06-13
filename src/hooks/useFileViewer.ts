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

/**
 * True when `filePath` is already absolute (POSIX `/…`, `file://…`, or a
 * Windows drive like `C:\…`). Relative paths are resolved against the active
 * session's project root in {@link openFileInViewer}.
 */
function isAbsolutePath(filePath: string): boolean {
  return (
    filePath.startsWith("/") ||
    filePath.startsWith("file://") ||
    /^[A-Za-z]:[\\/]/.test(filePath)
  );
}

/**
 * Resolve a possibly-relative path against the project root. Chat-message and
 * plan links carry project-relative paths (e.g. `plans/foo.md`), but the Rust
 * file-read commands require an absolute path.
 */
function resolveToAbsolute(filePath: string, projectPath?: string): string {
  if (isAbsolutePath(filePath) || !projectPath) return filePath;
  return `${projectPath.replace(/\/+$/, "")}/${filePath}`;
}

/**
 * Open a file in the right-panel File Viewer. Standalone (no React hooks) so it
 * can be called from non-component code such as the markdown link handler and
 * the plan-accept modal. Relative paths are resolved against the active
 * session's project root.
 */
export async function openFileInViewer(filePath: string): Promise<void> {
  const { activeSessionId: sessionId, sessions } = useSessionStore.getState();
  if (!sessionId) return;

  const projectPath = sessions.get(sessionId)?.project_path;
  const absPath = resolveToAbsolute(filePath, projectPath);

  const extension = getExtension(absPath);
  const mimeType = IMAGE_EXTENSIONS[extension];

  // Image files → open in modal preview instead of Monaco editor
  if (mimeType) {
    try {
      const bytes = await readFileBytes(absPath);
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      const fileName = absPath.split("/").pop() ?? absPath;
      useUiStore.getState().setImagePreview({
        filePath: absPath,
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
    const content = await readFileContent(absPath);
    const fileName = absPath.split("/").pop() ?? absPath;
    const language = getLanguageFromPath(absPath);

    useFileViewerStore.getState().openFile(sessionId, {
      filePath: absPath,
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
}

export function useFileViewer(): UseFileViewerReturn {
  const openFile = useCallback(
    (filePath: string) => openFileInViewer(filePath),
    [],
  );

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
