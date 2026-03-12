import { useEffect, useCallback, useRef } from "react";
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
  const activeProjectPathRef = useRef(activeProjectPath);
  activeProjectPathRef.current = activeProjectPath;

  // Listen for preview window close events — register once, read project from ref
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen("preview-window-closed", () => {
      const projectPath = activeProjectPathRef.current;
      if (projectPath) {
        usePreviewStore.getState().setPreviewOpen(projectPath, false);
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
