// useProjectPreflight — keeps the preflight store in sync with the active
// project. On project switch: load that project's manifest (if it has one)
// and refresh status. On unmount: tear down event listeners cleanly.
//
// Legacy compatibility: projects without a `preflight.yaml` produce a null
// manifest in the store, which AppShell uses to skip rendering the tray.

import { useEffect } from "react";
import {
  attachPreflightEventListeners,
  detachPreflightEventListeners,
  usePreflightStore,
} from "../stores/preflightStore";

export function useProjectPreflight(projectPath: string | null): void {
  const loadManifest = usePreflightStore((s) => s.loadManifest);
  const refreshStatus = usePreflightStore((s) => s.refreshStatus);
  const reset = usePreflightStore((s) => s.reset);

  // Attach event listeners once for the app lifetime.
  useEffect(() => {
    void attachPreflightEventListeners();
    return () => {
      detachPreflightEventListeners();
    };
  }, []);

  // Reload manifest + status whenever the active project changes.
  useEffect(() => {
    if (!projectPath) {
      reset();
      return;
    }
    let cancelled = false;
    (async () => {
      await loadManifest(projectPath);
      if (cancelled) return;
      await refreshStatus(projectPath);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, loadManifest, refreshStatus, reset]);
}
