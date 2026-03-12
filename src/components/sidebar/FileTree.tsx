import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronRight, ChevronDown, File, Folder } from "lucide-react";
import type { FileNode } from "../../types/file-tree";
import { useFileViewer } from "../../hooks/useFileViewer";
import { renameFile } from "../../lib/tauri-commands";
import FileTreeContextMenu from "./FileTreeContextMenu";

interface FileTreeProps {
  nodes: FileNode[];
  depth?: number;
  projectPath: string;
  onRefresh: () => void;
}

const extensionColors: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#f7df1e",
  jsx: "#f7df1e",
  json: "#a1a1aa",
  md: "#fbbf24",
  rs: "#dea584",
  css: "#60a5fa",
  html: "#f87171",
  py: "#3572A5",
};

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  editingPath: string | null;
  setEditingPath: (path: string | null) => void;
  projectPath: string;
  onRefresh: () => void;
  onContextMenu: (x: number, y: number, node: FileNode) => void;
  expandOverride: boolean | null; // null = use local state, true = expand all, false = collapse all
}

function InlineRenameInput({
  node,
  onRefresh,
  onDone,
}: {
  node: FileNode;
  onRefresh: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // Select the name without extension for files
      if (!node.is_dir && node.extension) {
        const nameWithoutExt = node.name.slice(0, node.name.length - node.extension.length - 1);
        inputRef.current.setSelectionRange(0, nameWithoutExt.length);
      } else {
        inputRef.current.select();
      }
    }
  }, [node]);

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === node.name) {
      onDone();
      return;
    }
    const parentDir = node.path.substring(0, node.path.lastIndexOf("/"));
    const newPath = `${parentDir}/${trimmed}`;
    try {
      await renameFile(node.path, newPath);
      onRefresh();
    } catch (e) {
      console.error("Failed to rename:", e);
    }
    onDone();
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
      }}
      onBlur={commit}
      className="text-ui bg-bg-elevated border border-border rounded px-1 py-0 outline-none text-text-primary min-w-0 w-full"
      style={{ fontSize: "inherit", lineHeight: "inherit" }}
    />
  );
}

function FileTreeNode({
  node,
  depth = 0,
  editingPath,
  setEditingPath,
  projectPath,
  onRefresh,
  onContextMenu,
  expandOverride,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const { openFile } = useFileViewer();

  // Sync local state when expand override changes
  useEffect(() => {
    if (expandOverride !== null) {
      setExpanded(expandOverride);
    }
  }, [expandOverride]);

  const isSpecial = node.name === "CLAUDE.md" || node.name === ".claude";
  const iconColor = node.extension
    ? extensionColors[node.extension] ?? "var(--text-faint)"
    : "var(--text-faint)";
  const isEditing = editingPath === node.path;

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e.clientX, e.clientY, node);
  }

  if (node.is_dir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          onContextMenu={handleContextMenu}
          className="flex items-center gap-1 w-full px-2 py-0.5 hover:bg-bg-elevated rounded text-left group"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown size={12} className="text-text-faint shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-text-faint shrink-0" />
          )}
          <Folder
            size={14}
            className="shrink-0"
            style={{ color: isSpecial ? "var(--yellow)" : "var(--text-dim)" }}
          />
          {isEditing ? (
            <InlineRenameInput
              node={node}
              onRefresh={onRefresh}
              onDone={() => setEditingPath(null)}
            />
          ) : (
            <span
              className={`text-ui truncate ${isSpecial ? "text-yellow font-medium" : "text-text-secondary"}`}
            >
              {node.name}
            </span>
          )}
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                editingPath={editingPath}
                setEditingPath={setEditingPath}
                projectPath={projectPath}
                onRefresh={onRefresh}
                onContextMenu={onContextMenu}
                expandOverride={expandOverride}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => openFile(node.path)}
      onContextMenu={handleContextMenu}
      className="flex items-center gap-1 w-full px-2 py-0.5 hover:bg-bg-elevated rounded text-left"
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <File
        size={14}
        className="shrink-0"
        style={{ color: isSpecial ? "var(--yellow)" : iconColor }}
      />
      {isEditing ? (
        <InlineRenameInput
          node={node}
          onRefresh={onRefresh}
          onDone={() => setEditingPath(null)}
        />
      ) : (
        <span
          className={`text-ui truncate ${isSpecial ? "text-yellow font-medium" : "text-text-secondary"}`}
        >
          {node.name}
        </span>
      )}
    </button>
  );
}

export default function FileTree({ nodes, depth = 0, projectPath, onRefresh }: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode | null;
  } | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  // null = no override (use local state), true/false = expand/collapse all
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null);

  function handleContextMenu(x: number, y: number, node: FileNode) {
    setContextMenu({ x, y, node });
  }

  function handleEmptyContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node: null });
  }

  const handleExpandAll = useCallback(() => {
    setExpandOverride(true);
    // Reset override so subsequent manual toggles work
    setTimeout(() => setExpandOverride(null), 0);
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandOverride(false);
    setTimeout(() => setExpandOverride(null), 0);
  }, []);

  return (
    <div className="py-1" onContextMenu={handleEmptyContextMenu}>
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={depth}
          editingPath={editingPath}
          setEditingPath={setEditingPath}
          projectPath={projectPath}
          onRefresh={onRefresh}
          onContextMenu={handleContextMenu}
          expandOverride={expandOverride}
        />
      ))}
      {contextMenu && (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          projectPath={projectPath}
          onClose={() => setContextMenu(null)}
          onRefresh={onRefresh}
          onStartRename={setEditingPath}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />
      )}
    </div>
  );
}
