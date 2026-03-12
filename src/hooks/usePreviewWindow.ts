import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePreviewStore } from "../stores/previewStore";
import { useSessionStore } from "../stores/sessionStore";
import {
  openPreviewWindow,
  closePreviewWindow,
  navigatePreview,
  refreshPreview,
  focusPreviewWindow,
} from "../lib/tauri-commands";

export function usePreviewWindow(): {
  openPreview: (url?: string) => Promise<void>;
  closePreview: () => Promise<void>;
  navigateTo: (url: string) => Promise<void>;
  refresh: () => Promise<void>;
  togglePreview: () => Promise<void>;
} {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  // Listen for preview window close events
  useEffect(() => {
    const unlisten = listen("preview-window-closed", () => {
      if (activeProjectPath) {
        usePreviewStore.getState().setPreviewOpen(activeProjectPath, false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeProjectPath]);

  const openPreview = useCallback(
    async (url?: string) => {
      if (!activeProjectPath) return;

      const targetUrl = url ?? "http://localhost:3000";
      const projectName =
        activeProjectPath.split("/").filter(Boolean).pop() ?? "Preview";

      await openPreviewWindow(targetUrl, projectName);
      usePreviewStore.getState().setPreviewOpen(activeProjectPath, true);
    },
    [activeProjectPath],
  );

  const closePreview = useCallback(async () => {
    await closePreviewWindow();
    if (activeProjectPath) {
      usePreviewStore.getState().setPreviewOpen(activeProjectPath, false);
    }
  }, [activeProjectPath]);

  const navigateTo = useCallback(async (url: string) => {
    await navigatePreview(url);
  }, []);

  const refresh = useCallback(async () => {
    await refreshPreview();
  }, []);

  const togglePreview = useCallback(async () => {
    if (!activeProjectPath) return;

    const isOpen = usePreviewStore.getState().previewOpen.get(activeProjectPath);
    if (isOpen) {
      // Try to focus first, if window doesn't exist, mark as closed
      const focused = await focusPreviewWindow();
      if (!focused) {
        usePreviewStore.getState().setPreviewOpen(activeProjectPath, false);
      }
    } else {
      // Check if we have a known dev server URL
      const devServer = usePreviewStore.getState().devServer.get(activeProjectPath);
      if (devServer?.url) {
        await openPreview(devServer.url);
      }
    }
  }, [activeProjectPath, openPreview]);

  return { openPreview, closePreview, navigateTo, refresh, togglePreview };
}
