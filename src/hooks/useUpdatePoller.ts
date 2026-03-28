import { useEffect, useRef } from "react";
import { checkForUpdate } from "../lib/update-checker";
import { enableUpdateMenuItem, listenOpenUpdateModal } from "../lib/tauri-commands";
import { useUiStore } from "../stores/uiStore";
import { showToast } from "../stores/toastStore";

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const INITIAL_DELAY_MS = 5_000;           // 5 seconds

export function useUpdatePoller(): void {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const doCheck = async (): Promise<void> => {
      try {
        const info = await checkForUpdate();
        if (info && !cancelled) {
          useUiStore.getState().setUpdateAvailable(info.version, info.body);
          enableUpdateMenuItem(info.version).catch((e) =>
            console.warn("[updater] Failed to enable menu item:", e),
          );
        }
      } catch (e) {
        console.warn("[updater] Periodic check failed:", e);
      }
    };

    // Initial check after short delay, then poll every 30 minutes
    const timer = setTimeout(() => {
      if (cancelled) return;
      doCheck();
      intervalId = setInterval(doCheck, POLL_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    // Listen for native menu click → "open-update-modal" event
    let unlistenMenu: (() => void) | null = null;
    listenOpenUpdateModal(() => {
      const state = useUiStore.getState();
      if (state.availableVersion) {
        state.openUpdateModal(state.availableVersion, state.availableNotes);
      } else {
        // No update known yet — trigger a manual check
        checkForUpdate()
          .then((info) => {
            if (info) {
              useUiStore.getState().setUpdateAvailable(info.version, info.body);
              useUiStore.getState().openUpdateModal(info.version, info.body);
              enableUpdateMenuItem(info.version).catch(() => {});
            } else {
              showToast("You're on the latest version", "success");
            }
          })
          .catch(() => {
            showToast("Failed to check for updates", "error");
          });
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlistenMenu = fn;
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (intervalId) clearInterval(intervalId);
      unlistenMenu?.();
    };
  }, []);
}
