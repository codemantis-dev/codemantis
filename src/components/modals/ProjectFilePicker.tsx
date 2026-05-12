import { useEffect, useMemo, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, ChevronDown, Search, File, Folder } from "lucide-react";
import { readFileTree } from "../../lib/tauri-commands";
import type { FileNode } from "../../types/file-tree";

export interface ProjectFilePickerProps {
  open: boolean;
  projectPath: string;
  alreadySelectedPaths?: string[];
  onClose: () => void;
  onConfirm: (relPaths: string[]) => void;
}

/**
 * Convert an absolute path returned by `read_file_tree` to a path relative to
 * the project root. We pass relative paths to Claude Code's REQUEST_FILES
 * channel because `read_project_files` resolves them under the project root.
 */
function toRelPath(absPath: string, projectPath: string): string {
  const root = projectPath.replace(/\/+$/, "");
  if (absPath === root) return "";
  if (absPath.startsWith(root + "/")) return absPath.slice(root.length + 1);
  return absPath;
}

/**
 * Recursively collect every file node into a flat list, preserving order.
 * Used for the search-filtered flat view.
 */
function flattenFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (n.is_dir) {
      if (n.children) flattenFiles(n.children, out);
    } else {
      out.push(n);
    }
  }
  return out;
}

interface RowProps {
  node: FileNode;
  depth: number;
  projectPath: string;
  expanded: Set<string>;
  selected: Set<string>;
  onToggleExpand: (path: string) => void;
  onToggleSelect: (relPath: string) => void;
}

function TreeRow({ node, depth, projectPath, expanded, selected, onToggleExpand, onToggleSelect }: RowProps) {
  const relPath = toRelPath(node.path, projectPath);
  const isExpanded = expanded.has(node.path);
  const isSelected = selected.has(relPath);

  if (node.is_dir) {
    return (
      <>
        <button
          type="button"
          onClick={() => onToggleExpand(node.path)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-ui hover:bg-bg-elevated text-left"
          style={{ paddingLeft: 8 + depth * 14, color: "var(--text-secondary)" }}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={12} style={{ color: "var(--text-ghost)" }} />
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children?.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            projectPath={projectPath}
            expanded={expanded}
            selected={selected}
            onToggleExpand={onToggleExpand}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </>
    );
  }

  return (
    <label
      className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-ui hover:bg-bg-elevated cursor-pointer"
      style={{ paddingLeft: 8 + depth * 14 + 16, color: "var(--text-primary)" }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggleSelect(relPath)}
        className="shrink-0"
        aria-label={`Select ${relPath}`}
      />
      <File size={12} style={{ color: "var(--text-ghost)" }} />
      <span className="truncate">{node.name}</span>
    </label>
  );
}

export default function ProjectFilePicker({
  open,
  projectPath,
  alreadySelectedPaths,
  onClose,
  onConfirm,
}: ProjectFilePickerProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Load tree when opened. Reset query + selection seed each time the dialog
  // opens so a stale tree from a different project never bleeds through.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuery("");
    setExpanded(new Set());
    setSelected(new Set(alreadySelectedPaths ?? []));
    readFileTree(projectPath)
      .then((nodes) => {
        if (cancelled) return;
        setTree(nodes);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, alreadySelectedPaths]);

  const filteredFlat = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const all = flattenFiles(tree);
    return all.filter((n) => toRelPath(n.path, projectPath).toLowerCase().includes(q));
  }, [query, tree, projectPath]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((relPath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm([...selected]);
    onClose();
  }, [selected, onConfirm, onClose]);

  // Esc / ⌘+Enter shortcuts while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, handleConfirm]);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[560px] max-h-[75vh] flex flex-col rounded-xl border border-border"
          style={{ background: "var(--bg-primary)" }}
        >
          <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
            <Dialog.Title className="text-text-primary font-medium text-title">
              Select files from project
            </Dialog.Title>
            <Dialog.Description className="text-ui text-text-dim mt-0.5">
              Selected files are referenced by path. Claude Code reads them on demand.
            </Dialog.Description>
            <div
              className="mt-3 flex items-center gap-2 px-2 py-1.5 rounded-md border"
              style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
            >
              <Search size={14} style={{ color: "var(--text-ghost)" }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter files…"
                autoFocus
                className="flex-1 bg-transparent outline-none text-ui"
                style={{ color: "var(--text-primary)" }}
                aria-label="Filter files"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2" data-testid="project-file-picker-list">
            {loading && (
              <div className="text-ui text-text-dim px-3 py-4">Loading project files…</div>
            )}
            {error && (
              <div className="text-ui px-3 py-4" style={{ color: "var(--error, #ef4444)" }}>
                Failed to load: {error}
              </div>
            )}
            {!loading && !error && filteredFlat !== null && (
              filteredFlat.length === 0 ? (
                <div className="text-ui text-text-dim px-3 py-4">No matching files.</div>
              ) : (
                filteredFlat.map((n) => {
                  const relPath = toRelPath(n.path, projectPath);
                  const isSelected = selected.has(relPath);
                  return (
                    <label
                      key={n.path}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-ui hover:bg-bg-elevated cursor-pointer"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(relPath)}
                        className="shrink-0"
                        aria-label={`Select ${relPath}`}
                      />
                      <File size={12} style={{ color: "var(--text-ghost)" }} />
                      <span className="truncate">{relPath}</span>
                    </label>
                  );
                })
              )
            )}
            {!loading && !error && filteredFlat === null && (
              tree.length === 0 ? (
                <div className="text-ui text-text-dim px-3 py-4">Project is empty.</div>
              ) : (
                tree.map((n) => (
                  <TreeRow
                    key={n.path}
                    node={n}
                    depth={0}
                    projectPath={projectPath}
                    expanded={expanded}
                    selected={selected}
                    onToggleExpand={toggleExpand}
                    onToggleSelect={toggleSelect}
                  />
                ))
              )
            )}
          </div>

          <div
            className="px-5 py-3 border-t flex items-center justify-between gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="text-ui text-text-dim">
              {selected.size === 0
                ? "No files selected"
                : `${selected.size} file${selected.size === 1 ? "" : "s"} selected`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={selected.size === 0}
                className={`px-4 py-1.5 rounded-lg text-ui font-medium transition-colors ${
                  selected.size === 0
                    ? "bg-bg-subtle text-text-ghost cursor-not-allowed"
                    : "bg-accent text-white hover:bg-accent-light"
                }`}
              >
                Add {selected.size > 0 ? `(${selected.size})` : ""}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
