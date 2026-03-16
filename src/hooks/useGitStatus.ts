import { useState, useEffect, useCallback, useRef } from "react";
import type { GitStatusInfo } from "../types/git";
import { getGitStatus } from "../lib/tauri-commands";

const POLL_ACTIVE = 5_000;  // Uncommitted changes present
const POLL_CLEAN = 10_000;  // Working tree clean

export function useGitStatus(projectPath: string | null): {
  gitStatus: GitStatusInfo | null;
  refresh: () => void;
} {
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const pathRef = useRef(projectPath);
  pathRef.current = projectPath;
  const statusRef = useRef(gitStatus);
  statusRef.current = gitStatus;

  const fetchStatus = useCallback(async () => {
    const path = pathRef.current;
    if (!path) {
      setGitStatus(null);
      return;
    }
    try {
      const status = await getGitStatus(path);
      // Only update if path hasn't changed during the fetch
      if (pathRef.current === path) {
        setGitStatus(status);
      }
    } catch {
      setGitStatus(null);
    }
  }, []);

  useEffect(() => {
    pathRef.current = projectPath;
    fetchStatus();

    if (!projectPath) return;

    // setTimeout chain so interval adapts based on current status
    let timeoutId: ReturnType<typeof setTimeout>;
    const schedule = (): void => {
      const hasChanges = (statusRef.current?.uncommitted_changes ?? 0) > 0;
      timeoutId = setTimeout(() => {
        fetchStatus().then(schedule);
      }, hasChanges ? POLL_ACTIVE : POLL_CLEAN);
    };
    schedule();

    // Refresh immediately when window regains focus
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [projectPath, fetchStatus]);

  return { gitStatus, refresh: fetchStatus };
}
