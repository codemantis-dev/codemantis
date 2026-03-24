import { useCallback } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { listSpecDocuments } from "../lib/tauri-commands";

interface UseSavedSpecsReturn {
  refreshSavedSpecs: () => void;
}

export function useSavedSpecs(activeProjectPath: string | null): UseSavedSpecsReturn {
  const setSavedSpecs = useSpecWriterStore((s) => s.setSavedSpecs);

  const refreshSavedSpecs = useCallback(() => {
    if (activeProjectPath) {
      listSpecDocuments(activeProjectPath).then((specs) => {
        setSavedSpecs(activeProjectPath, specs);
      }).catch(() => {});
    }
  }, [activeProjectPath, setSavedSpecs]);

  return { refreshSavedSpecs };
}
