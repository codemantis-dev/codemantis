import { useState, useEffect, useCallback, useRef } from "react";
import type { GitStatusInfo } from "../types/git";
import { getGitStatus } from "../lib/tauri-commands";

const POLL_INTERVAL = 10_000;

export function useGitStatus(projectPath: string | null): {
  gitStatus: GitStatusInfo | null;
  refresh: () => void;
} {
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const pathRef = useRef(projectPath);
  pathRef.current = projectPath;

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

    const id = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [projectPath, fetchStatus]);

  return { gitStatus, refresh: fetchStatus };
}
