import { useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePreviewStore } from "../stores/previewStore";
import { useSessionStore } from "../stores/sessionStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useAttachmentStore } from "../stores/attachmentStore";
import {
  openPreviewWindow,
  closePreviewWindow,
  navigatePreview,
  refreshPreview,
  focusPreviewWindow,
  stopDevServer,
  readFileBytes,
} from "../lib/tauri-commands";
import { showToast } from "../stores/toastStore";

export function usePreviewWindow(): {
  openPreview: (url?: string) => Promise<void>;
  closePreview: () => Promise<void>;
  navigateTo: (url: string) => Promise<void>;
  refresh: () => Promise<void>;
  togglePreview: () => Promise<void>;
} {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const activeProjectPathRef = useRef(activeProjectPath);
  activeProjectPathRef.current = activeProjectPath;

  // Listen for screenshot taken from preview toolbar
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<string>("preview-screenshot-taken", async (e) => {
      const filePath = e.payload;
      const sessionId = useSessionStore.getState().activeSessionId;
      if (!sessionId) return;

      let thumbnailUrl: string | undefined;
      let fileSize = 0;
      try {
        const bytes = await readFileBytes(filePath);
        fileSize = bytes.length;
        const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
        thumbnailUrl = URL.createObjectURL(blob);
      } catch {
        // thumbnail optional
      }

      useAttachmentStore.getState().addAttachment(sessionId, {
        id: `screenshot-${Date.now()}`,
        fileName: "preview-screenshot.png",
        filePath,
        fileSize,
        mimeType: "image/png",
        isImage: true,
        thumbnailUrl,
      });
      showToast("Screenshot added to chat", "success");
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Listen for preview window close events — register once, read project from ref
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen("preview-window-closed", () => {
      const projectPath = activeProjectPathRef.current;
      if (projectPath) {
        usePreviewStore.getState().setPreviewOpen(projectPath, false);
        // Auto-stop dev server when preview window is closed
        const devServer = usePreviewStore.getState().devServer.get(projectPath);
        if (devServer && devServer.status === "running") {
          stopDevServer(projectPath)
            .then(() => {
              usePreviewStore.getState().clearDevServer(projectPath);
              if (devServer.sessionId) {
                useTerminalStore.getState().clearSession(devServer.sessionId);
              }
            })
            .catch((err: unknown) => console.error("Failed to stop dev server:", err));
        }
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  const openPreview = useCallback(
    async (url?: string) => {
      const projectPath = activeProjectPathRef.current;
      if (!projectPath) return;

      const targetUrl = url ?? "http://localhost:3000";
      const projectName =
        projectPath.split("/").filter(Boolean).pop() ?? "Preview";

      await openPreviewWindow(targetUrl, projectName);
      usePreviewStore.getState().setPreviewOpen(projectPath, true);
    },
    [],
  );

  const closePreview = useCallback(async () => {
    await closePreviewWindow();
    const projectPath = activeProjectPathRef.current;
    if (projectPath) {
      usePreviewStore.getState().setPreviewOpen(projectPath, false);
      // Also stop dev server on programmatic close
      const devServer = usePreviewStore.getState().devServer.get(projectPath);
      if (devServer && devServer.status === "running") {
        try {
          await stopDevServer(projectPath);
          usePreviewStore.getState().clearDevServer(projectPath);
          if (devServer.sessionId) {
            useTerminalStore.getState().clearSession(devServer.sessionId);
          }
        } catch (err) {
          console.error("Failed to stop dev server:", err);
        }
      }
    }
  }, []);

  const navigateTo = useCallback(async (url: string) => {
    await navigatePreview(url);
  }, []);

  const refresh = useCallback(async () => {
    await refreshPreview();
  }, []);

  const togglePreview = useCallback(async () => {
    const projectPath = activeProjectPathRef.current;
    if (!projectPath) return;

    const isOpen = usePreviewStore.getState().previewOpen.get(projectPath);
    if (isOpen) {
      const focused = await focusPreviewWindow();
      if (!focused) {
        usePreviewStore.getState().setPreviewOpen(projectPath, false);
      }
    } else {
      const devServer = usePreviewStore.getState().devServer.get(projectPath);
      if (devServer?.url) {
        await openPreview(devServer.url);
      }
    }
  }, [openPreview]);

  return { openPreview, closePreview, navigateTo, refresh, togglePreview };
}
