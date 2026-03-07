import { useState, useCallback } from "react";
import type { FileNode } from "../types/file-tree";
import { readFileTree } from "../lib/tauri-commands";

interface UseFileTreeReturn {
  files: FileNode[];
  loading: boolean;
  error: string | null;
  refresh: (rootPath: string) => Promise<void>;
}

export function useFileTree(): UseFileTreeReturn {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (rootPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const tree = await readFileTree(rootPath);
      setFiles(tree);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return { files, loading, error, refresh };
}
