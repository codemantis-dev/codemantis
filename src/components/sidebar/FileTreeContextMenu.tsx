import { useEffect, useRef, useState } from "react";
import {
  Paperclip,
  MessageSquare,
  FolderOpen,
  Copy,
  ClipboardCopy,
  FilePlus,
  Pencil,
  Trash2,
  Files,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import type { FileNode } from "../../types/file-tree";
import type { Attachment } from "../../types/attachment";
import { useAttachmentStore } from "../../stores/attachmentStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useAssistantStore } from "../../stores/assistantStore";
import { useFileViewerStore } from "../../stores/fileViewerStore";
import { useFileViewer } from "../../hooks/useFileViewer";
import {
  getFileInfo,
  readFileContent,
  deleteFile,
  duplicateFile,
  createFile,
} from "../../lib/tauri-commands";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

interface FileTreeContextMenuProps {
  x: number;
  y: number;
  node: FileNode | null;
  projectPath: string;
  onClose: () => void;
  onRefresh: () => void;
  onStartRename: (path: string) => void;
}

function Separator() {
  return <div className="h-px bg-border-light my-1 mx-2" />;
}

interface MenuItemProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: MenuItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-ui text-left transition-colors ${
        disabled
          ? "text-text-faint cursor-default"
          : danger
            ? "text-red hover:bg-bg-subtle"
            : "text-text-secondary hover:text-text-primary hover:bg-bg-subtle"
      }`}
    >
      <Icon size={14} className="shrink-0" />
      {label}
    </button>
  );
}

export default function FileTreeContextMenu({
  x,
  y,
  node,
  projectPath,
  onClose,
  onRefresh,
  onStartRename,
}: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { openFile } = useFileViewer();
  const [assistantExpanded, setAssistantExpanded] = useState(false);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const menuWidth = 220;
  const menuHeight = node ? (node.is_dir ? 240 : 380) : 60;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  async function buildAttachment(filePath: string): Promise<Attachment | null> {
    try {
      const info = await getFileInfo(filePath);
      return {
        id: crypto.randomUUID(),
        fileName: info.file_name,
        filePath: info.file_path,
        fileSize: info.file_size,
        mimeType: info.mime_type,
        isImage: info.is_image,
      };
    } catch {
      return null;
    }
  }

  async function handleAddToChat() {
    if (!node || node.is_dir) return;
    const attachment = await buildAttachment(node.path);
    if (attachment) {
      const sessionId = useSessionStore.getState().activeSessionId;
      if (sessionId) {
        useAttachmentStore.getState().addAttachment(sessionId, attachment);
      }
    }
    onClose();
  }

  function handleAddToAssistant(assistantId: string) {
    if (!node || node.is_dir) return;
    buildAttachment(node.path).then((attachment) => {
      if (attachment) {
        useAssistantStore.getState().addAssistantAttachment(assistantId, attachment);
      }
    });
    onClose();
  }

  async function handleOpen() {
    if (!node) return;
    if (!node.is_dir) {
      await openFile(node.path);
    }
    onClose();
  }

  async function handleDuplicate() {
    if (!node || node.is_dir) return;
    try {
      await duplicateFile(node.path);
      onRefresh();
    } catch (e) {
      console.error("Failed to duplicate:", e);
    }
    onClose();
  }

  function handleRename() {
    if (!node) return;
    onStartRename(node.path);
    onClose();
  }

  async function handleDelete() {
    if (!node) return;
    const label = node.is_dir
      ? `Delete folder "${node.name}" and all its contents? This cannot be undone.`
      : `Delete "${node.name}"? This cannot be undone.`;
    if (!window.confirm(label)) return;

    try {
      await deleteFile(node.path);
      // Clean up FileViewer if the deleted file/folder has open tabs
      const store = useFileViewerStore.getState();
      const openFiles = store.projectOpenFiles.get(projectPath) ?? [];
      for (const tab of openFiles) {
        if (tab.filePath === node.path || tab.filePath.startsWith(node.path + "/")) {
          store.closeFile(projectPath, tab.filePath);
        }
      }
      onRefresh();
    } catch (e) {
      console.error("Failed to delete:", e);
    }
    onClose();
  }

  async function handleReveal() {
    if (!node) return;
    try {
      await revealItemInDir(node.path);
    } catch (e) {
      console.error("Failed to reveal:", e);
    }
    onClose();
  }

  async function handleCopyContent() {
    if (!node || node.is_dir) return;
    try {
      const content = await readFileContent(node.path);
      await navigator.clipboard.writeText(content);
    } catch (e) {
      console.error("Failed to copy file content:", e);
    }
    onClose();
  }

  function handleCopyPath() {
    if (!node) return;
    navigator.clipboard.writeText(node.path);
    onClose();
  }

  function handleCopyRelativePath() {
    if (!node) return;
    const rel = node.path.startsWith(projectPath + "/")
      ? node.path.slice(projectPath.length + 1)
      : node.path;
    navigator.clipboard.writeText(rel);
    onClose();
  }

  async function handleNewFile(parentPath: string) {
    const name = window.prompt("File name:");
    if (!name?.trim()) return;
    const filePath = `${parentPath}/${name.trim()}`;
    try {
      await createFile(filePath);
      onRefresh();
      // Auto-open the new file
      setTimeout(() => openFile(filePath), 200);
    } catch (e) {
      console.error("Failed to create file:", e);
    }
    onClose();
  }

  // Empty space context menu
  if (!node) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50 border border-border rounded-lg shadow-lg py-1"
        style={{ background: "var(--bg-primary)", left: clampedX, top: clampedY, minWidth: menuWidth }}
      >
        <MenuItem icon={FilePlus} label="New File" onClick={() => handleNewFile(projectPath)} />
      </div>
    );
  }

  // Folder context menu
  if (node.is_dir) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50 border border-border rounded-lg shadow-lg py-1"
        style={{ background: "var(--bg-primary)", left: clampedX, top: clampedY, minWidth: menuWidth }}
      >
        <MenuItem icon={FilePlus} label="New File" onClick={() => handleNewFile(node.path)} />
        <MenuItem icon={Pencil} label="Rename" onClick={handleRename} />
        <MenuItem icon={Trash2} label="Delete" onClick={handleDelete} danger />
        <Separator />
        <MenuItem icon={FolderOpen} label="Reveal in Finder" onClick={handleReveal} />
        <MenuItem icon={ClipboardCopy} label="Copy Path" onClick={handleCopyPath} />
        <MenuItem icon={ClipboardCopy} label="Copy Relative Path" onClick={handleCopyRelativePath} />
      </div>
    );
  }

  // File context menu
  const assistants = useAssistantStore.getState().getAssistants(projectPath);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 border border-border rounded-lg shadow-lg py-1"
      style={{ background: "var(--bg-primary)", left: clampedX, top: clampedY, minWidth: menuWidth }}
    >
      <MenuItem icon={Paperclip} label="Add to Main Chat" onClick={handleAddToChat} />
      {/* Add to Assistant - inline expandable */}
      <button
        onClick={() => setAssistantExpanded(!assistantExpanded)}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-ui text-text-secondary hover:text-text-primary hover:bg-bg-subtle transition-colors text-left"
      >
        <MessageSquare size={14} className="shrink-0" />
        <span className="flex-1">Add to Assistant</span>
        {assistantExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {assistantExpanded && (
        <div className="border-l-2 border-border-light ml-5">
          {assistants.length === 0 ? (
            <div className="px-3 py-1.5 text-ui text-text-faint">No assistants</div>
          ) : (
            assistants.map((a) => (
              <button
                key={a.id}
                onClick={() => handleAddToAssistant(a.id)}
                className="w-full text-left px-3 py-1 text-ui text-text-secondary hover:text-text-primary hover:bg-bg-subtle transition-colors truncate"
              >
                {a.name}
              </button>
            ))
          )}
        </div>
      )}
      <Separator />
      <MenuItem icon={FolderOpen} label="Open" onClick={handleOpen} />
      <MenuItem icon={Files} label="Duplicate" onClick={handleDuplicate} />
      <MenuItem icon={Pencil} label="Rename" onClick={handleRename} />
      <MenuItem icon={Trash2} label="Delete" onClick={handleDelete} danger />
      <Separator />
      <MenuItem icon={FolderOpen} label="Reveal in Finder" onClick={handleReveal} />
      <MenuItem icon={Copy} label="Copy Contents" onClick={handleCopyContent} />
      <MenuItem icon={ClipboardCopy} label="Copy Path" onClick={handleCopyPath} />
      <MenuItem icon={ClipboardCopy} label="Copy Relative Path" onClick={handleCopyRelativePath} />
    </div>
  );
}
