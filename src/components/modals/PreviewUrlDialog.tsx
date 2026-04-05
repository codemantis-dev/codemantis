import { useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Globe, AlertTriangle } from "lucide-react";
import { usePreviewStore } from "../../stores/previewStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { openPreviewWindow } from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";

export default function PreviewUrlDialog() {
  const prompt = usePreviewStore((s) => s.previewUrlPrompt);
  const open = prompt !== null;

  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-fill with last-used URL when dialog opens
  useEffect(() => {
    if (prompt) {
      const lastUrls = useSettingsStore.getState().settings.previewLastUrls;
      setUrl(lastUrls[prompt.projectPath] ?? "");
      // Focus input after render
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [prompt]);

  const handleClose = (): void => {
    usePreviewStore.getState().setPreviewUrlPrompt(null);
  };

  const handleOpen = async (): Promise<void> => {
    const trimmed = url.trim();
    if (!trimmed || !prompt) return;

    // Auto-add http:// if missing
    const finalUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const projectName =
      prompt.projectPath.split("/").filter(Boolean).pop() ?? "Preview";

    try {
      usePreviewStore.getState().setPreviewOpen(prompt.projectPath, true);
      await openPreviewWindow(finalUrl, projectName, prompt.projectPath);

      // Save last-used URL for this project
      const { previewLastUrls } = useSettingsStore.getState().settings;
      useSettingsStore.getState().updateSettings({
        previewLastUrls: {
          ...previewLastUrls,
          [prompt.projectPath]: finalUrl,
        },
      });
    } catch (err) {
      usePreviewStore.getState().setPreviewOpen(prompt.projectPath, false);
      showToast(`Failed to open preview: ${String(err)}`, "error");
    }

    handleClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleOpen();
    }
  };

  if (!prompt) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] rounded-xl border border-border p-6" style={{ background: "var(--bg-primary)" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-yellow/10">
              <AlertTriangle size={20} className="text-yellow" />
            </div>
            <div>
              <Dialog.Title className="text-text-primary font-medium text-title">
                Dev server failed
              </Dialog.Title>
              <Dialog.Description className="text-ui text-text-dim mt-0.5">
                {prompt.errorMessage}
              </Dialog.Description>
            </div>
          </div>

          <p className="text-ui text-text-secondary mb-3">
            Enter the URL of your running dev server (e.g. from Docker or a remote host):
          </p>

          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-elevated">
              <Globe size={14} className="text-text-ghost shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="http://localhost:3000"
                className="flex-1 bg-transparent text-ui text-text-primary outline-none placeholder:text-text-ghost"
                autoFocus
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleOpen}
              disabled={!url.trim()}
              className="px-4 py-2 rounded-lg text-ui text-white bg-accent hover:brightness-110 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Open Preview
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
