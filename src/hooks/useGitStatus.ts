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
  const fetchIdRef = useRef(0);

  const fetchStatus = useCallback(async (): Promise<GitStatusInfo | null> => {
    const path = pathRef.current;
    if (!path) {
      setGitStatus(null);
      return null;
    }
    const id = ++fetchIdRef.current;
    try {
      const status = await getGitStatus(path);
      // Only update if this is still the latest fetch and path hasn't changed
      if (fetchIdRef.current === id && pathRef.current === path) {
        setGitStatus(status);
        return status;
      }
      return null; // Stale fetch, discarded
    } catch {
      if (fetchIdRef.current === id) {
        setGitStatus(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    pathRef.current = projectPath;

    if (!projectPath) {
      setGitStatus(null);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    // Async poll loop: fetch, then schedule based on the actual result
    const poll = async (): Promise<void> => {
      const result = await fetchStatus();
      if (cancelled) return;
      const hasChanges = (result?.uncommitted_changes ?? 0) > 0;
      timeoutId = setTimeout(poll, hasChanges ? POLL_ACTIVE : POLL_CLEAN);
    };
    poll();

    // Refresh immediately when window regains focus
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [projectPath, fetchStatus]);

  return { gitStatus, refresh: fetchStatus };
}
