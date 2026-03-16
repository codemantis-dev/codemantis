import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { ChevronRight, ChevronDown, File, Folder } from "lucide-react";
import type { FileNode } from "../../types/file-tree";
import { useFileViewer } from "../../hooks/useFileViewer";
import { renameFile, createFile, createDirectory } from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";
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

export interface NewItemState {
  parentPath: string;
  type: "file" | "folder";
}

export interface FileTreeHandle {
  openContextMenu(x: number, y: number): void;
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  editingPath: string | null;
  setEditingPath: (path: string | null) => void;
  projectPath: string;
  onRefresh: () => void;
  onContextMenu: (x: number, y: number, node: FileNode) => void;
  expandOverride: boolean | null; // null = use local state, true = expand all, false = collapse all
  newItemState: NewItemState | null;
  onNewItemDone: () => void;
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
  const committedRef = useRef(false);

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
    if (committedRef.current) return;
    committedRef.current = true;
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
      showToast("Failed to rename item", "error");
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

function InlineNewItemInput({
  parentPath,
  type,
  depth,
  onRefresh,
  onDone,
}: {
  parentPath: string;
  type: "file" | "folder";
  depth: number;
  onRefresh: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const { openFile } = useFileViewer();

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  async function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (!trimmed) {
      onDone();
      return;
    }
    const fullPath = `${parentPath}/${trimmed}`;
    try {
      if (type === "file") {
        await createFile(fullPath);
        onRefresh();
        setTimeout(() => openFile(fullPath), 200);
      } else {
        await createDirectory(fullPath);
        onRefresh();
      }
    } catch (e) {
      console.error(`Failed to create ${type}:`, e);
      showToast(`Failed to create ${type}`, "error");
    }
    onDone();
  }

  return (
    <div
      className="flex items-center gap-1 w-full px-2 py-0.5"
      style={{ paddingLeft: type === "folder" ? `${depth * 12 + 8}px` : `${depth * 12 + 20}px` }}
    >
      {type === "folder" ? (
        <>
          <ChevronRight size={12} className="text-text-faint shrink-0" />
          <Folder size={14} className="shrink-0" style={{ color: "var(--text-dim)" }} />
        </>
      ) : (
        <File size={14} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      )}
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
        placeholder={type === "file" ? "filename" : "folder name"}
        className="text-ui bg-bg-elevated border border-accent/40 rounded px-1 py-0 outline-none text-text-primary min-w-0 w-full"
        style={{ fontSize: "inherit", lineHeight: "inherit" }}
      />
    </div>
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
  newItemState,
  onNewItemDone,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const { openFile } = useFileViewer();

  // Sync local state when expand override changes
  useEffect(() => {
    if (expandOverride !== null) {
      setExpanded(expandOverride);
    }
  }, [expandOverride]);

  // Auto-expand folder when creating a new item inside it
  useEffect(() => {
    if (newItemState && newItemState.parentPath === node.path) {
      setExpanded(true);
    }
  }, [newItemState, node.path]);

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
                newItemState={newItemState}
                onNewItemDone={onNewItemDone}
              />
            ))}
            {newItemState && newItemState.parentPath === node.path && (
              <InlineNewItemInput
                parentPath={node.path}
                type={newItemState.type}
                depth={depth + 1}
                onRefresh={onRefresh}
                onDone={onNewItemDone}
              />
            )}
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

const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  { nodes, depth = 0, projectPath, onRefresh },
  ref,
) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode | null;
  } | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [newItemState, setNewItemState] = useState<NewItemState | null>(null);
  // null = no override (use local state), true/false = expand/collapse all
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null);

  useImperativeHandle(ref, () => ({
    openContextMenu(x: number, y: number) {
      setNewItemState(null);
      setContextMenu({ x, y, node: null });
    },
  }));

  function handleContextMenu(x: number, y: number, node: FileNode) {
    setNewItemState(null); // Cancel any in-progress new item
    setContextMenu({ x, y, node });
  }

  function handleEmptyContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setNewItemState(null);
    setContextMenu({ x: e.clientX, y: e.clientY, node: null });
  }

  const handleStartNewItem = useCallback((parentPath: string, type: "file" | "folder") => {
    setNewItemState({ parentPath, type });
  }, []);

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
    <div className="py-1 min-h-full" onContextMenu={handleEmptyContextMenu}>
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
          newItemState={newItemState}
          onNewItemDone={() => setNewItemState(null)}
        />
      ))}
      {newItemState && newItemState.parentPath === projectPath && (
        <InlineNewItemInput
          parentPath={projectPath}
          type={newItemState.type}
          depth={0}
          onRefresh={onRefresh}
          onDone={() => setNewItemState(null)}
        />
      )}
      {contextMenu && (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          projectPath={projectPath}
          onClose={() => setContextMenu(null)}
          onRefresh={onRefresh}
          onStartRename={setEditingPath}
          onStartNewItem={handleStartNewItem}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />
      )}
    </div>
  );
});

export default FileTree;
