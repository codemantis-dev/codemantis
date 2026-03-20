import { Plus, FolderOpen, Blocks, Settings, PenTool, Globe, Camera } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { usePreviewStore } from "../../stores/previewStore";
import { useAttachmentStore } from "../../stores/attachmentStore";
import { usePreviewServer } from "../../hooks/usePreviewServer";
import { focusPreviewWindow, openPreviewWindow, capturePreviewScreenshot, readFileBytes } from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";
import ProjectTab from "./ProjectTab";
import SpecWriterBadge from "../specwriter/SpecWriterBadge";
import type { Attachment } from "../../types/attachment";

interface TitleBarProps {
  onCloseProject: (projectPath: string) => void;
}

export default function TitleBar({ onCloseProject }: TitleBarProps) {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const projectOrder = useSessionStore((s) => s.projectOrder);
  const sessions = useSessionStore((s) => s.sessions);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const openProjectPicker = useUiStore((s) => s.openProjectPicker);
  const setShowMcpModal = useUiStore((s) => s.setShowMcpModal);
  const setShowSettingsModal = useUiStore((s) => s.setShowSettingsModal);
  const toggleSlideOver = useSpecWriterStore((s) => s.toggleSlideOver);
  const previewOpen = usePreviewStore((s) => activeProjectPath ? s.previewOpen.get(activeProjectPath) : false);
  const devServer = usePreviewStore((s) => activeProjectPath ? s.devServer.get(activeProjectPath) : undefined);
  const { startServer } = usePreviewServer();

  const handleScreenshot = async (): Promise<void> => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    try {
      const filePath = await capturePreviewScreenshot();
      let thumbnailUrl: string | undefined;
      try {
        const bytes = await readFileBytes(filePath);
        const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
        thumbnailUrl = URL.createObjectURL(blob);
      } catch {
        // Preview thumbnail optional
      }
      const attachment: Attachment = {
        id: `screenshot-${Date.now()}`,
        fileName: "preview-screenshot.png",
        filePath,
        fileSize: 0,
        mimeType: "image/png",
        isImage: true,
        thumbnailUrl,
      };
      useAttachmentStore.getState().addAttachment(sessionId, attachment);
      showToast("Screenshot added to chat", "success");
    } catch (err) {
      showToast(`Screenshot failed: ${err}`, "error");
    }
  };

  const handleRunApplication = async (): Promise<void> => {
    if (!activeProjectPath) {
      showToast("Open a project first", "info");
      return;
    }

    // If preview is already open, just focus it
    if (previewOpen) {
      const focused = await focusPreviewWindow();
      if (focused) return;
    }

    // If dev server is running, open/focus the preview
    if (devServer?.status === "running" && devServer.url) {
      const projectName = activeProjectPath.split("/").filter(Boolean).pop() ?? "Preview";
      // Set previewOpen eagerly to prevent the dev-server-ready listener
      // from racing and opening a second window
      usePreviewStore.getState().setPreviewOpen(activeProjectPath, true);
      try {
        await openPreviewWindow(devServer.url, projectName);
      } catch (err) {
        usePreviewStore.getState().setPreviewOpen(activeProjectPath, false);
        showToast(`Failed to open preview window: ${err}`, "error");
      }
      return;
    }

    // Dev server is starting/scanning — just wait, it will auto-open when ready
    if (devServer?.status === "starting" || devServer?.status === "scanning") {
      showToast("Dev server is starting…", "info");
      return;
    }

    // Start dev server (will auto-open preview when ready)
    try {
      await startServer();
      // Check if startServer set an error state
      const ds = usePreviewStore.getState().devServer.get(activeProjectPath);
      if (ds?.status === "error") {
        showToast(ds.errorMessage ?? "Failed to start dev server", "error");
      }
    } catch (err) {
      showToast(`Preview failed: ${err}`, "error");
    }
  };

  return (
    <div
      className="h-12 flex items-center border-b border-border select-none"
      data-tauri-drag-region
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Traffic light spacer */}
      <div className="w-[78px] shrink-0" data-tauri-drag-region />

      {/* Project tabs */}
      <div className="flex items-center h-full flex-1 overflow-x-auto overflow-y-hidden" data-tauri-drag-region>
        {projectOrder.map((projectPath) => {
          const projectName = projectPath
            .split("/")
            .filter(Boolean)
            .pop() ?? "";
          const sessionCount = tabOrder.filter((id) => {
            const s = sessions.get(id);
            return s && s.project_path === projectPath;
          }).length;

          return (
            <ProjectTab
              key={projectPath}
              projectPath={projectPath}
              projectName={projectName}
              sessionCount={sessionCount}
              isActive={projectPath === activeProjectPath}
              onSelect={() => setActiveProject(projectPath)}
              onClose={() => onCloseProject(projectPath)}
            />
          );
        })}

        {/* Empty drag region if no tabs */}
        {projectOrder.length === 0 && (
          <span className="text-ui text-text-dim px-2" data-tauri-drag-region>
            CodeMantis
          </span>
        )}
      </div>

      {/* New project button (templates) */}
      <button
        onClick={() => openProjectPicker("templates")}
        title="New project from template (Cmd+Shift+N)"
        className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Plus size={15} />
      </button>

      {/* Open existing project */}
      <button
        onClick={() => openProjectPicker("open")}
        title="Open existing project (Cmd+O)"
        className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <FolderOpen size={14} />
      </button>

      {/* SpecWriter button */}
      <button
        onClick={() => activeProjectPath && toggleSlideOver(activeProjectPath)}
        title="SpecWriter (Cmd+Shift+B)"
        className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors flex items-center gap-1"
      >
        <PenTool size={14} />
        {activeProjectPath && <SpecWriterBadge projectPath={activeProjectPath} />}
      </button>

      {/* Run Application (Preview) button */}
      <button
        onClick={handleRunApplication}
        title="Run Application"
        className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Globe size={14} />
      </button>

      {/* Screenshot preview to chat */}
      {previewOpen && (
        <button
          onClick={handleScreenshot}
          title="Screenshot preview to chat"
          className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
        >
          <Camera size={14} />
        </button>
      )}

      {/* MCP Servers button */}
      <button
        onClick={() => setShowMcpModal(true)}
        title="MCP Servers (Cmd+Shift+M)"
        className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Blocks size={14} />
      </button>

      {/* Settings button */}
      <button
        onClick={() => setShowSettingsModal(true)}
        title="Settings (Cmd+,)"
        className="mr-3 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Settings size={14} />
      </button>
    </div>
  );
}
