import { useState } from "react";
import { ChevronRight, ChevronDown, File, Folder } from "lucide-react";
import type { FileNode } from "../../types/file-tree";
import { useFileViewer } from "../../hooks/useFileViewer";

interface FileTreeProps {
  nodes: FileNode[];
  depth?: number;
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

function FileTreeNode({ node, depth = 0 }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const { openFile } = useFileViewer();

  const isSpecial = node.name === "CLAUDE.md" || node.name === ".claude";
  const iconColor = node.extension
    ? extensionColors[node.extension] ?? "var(--text-faint)"
    : "var(--text-faint)";

  if (node.is_dir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
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
          <span
            className={`text-ui truncate ${isSpecial ? "text-yellow font-medium" : "text-text-secondary"}`}
          >
            {node.name}
          </span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
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
      className="flex items-center gap-1 w-full px-2 py-0.5 hover:bg-bg-elevated rounded text-left"
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <File
        size={14}
        className="shrink-0"
        style={{ color: isSpecial ? "var(--yellow)" : iconColor }}
      />
      <span
        className={`text-ui truncate ${isSpecial ? "text-yellow font-medium" : "text-text-secondary"}`}
      >
        {node.name}
      </span>
    </button>
  );
}

export default function FileTree({ nodes, depth = 0 }: FileTreeProps) {
  return (
    <div className="py-1">
      {nodes.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={depth} />
      ))}
    </div>
  );
}
