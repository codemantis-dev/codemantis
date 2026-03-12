import { useState } from "react";
import { X, Image as ImageIcon, FileText } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAttachmentStore } from "../../stores/attachmentStore";
import type { Attachment } from "../../types/attachment";

const EMPTY_ATTACHMENTS: Attachment[] = [];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentBar({ sessionId }: { sessionId: string }) {
  const attachments = useAttachmentStore((s) => s.attachments.get(sessionId) ?? EMPTY_ATTACHMENTS);
  const removeAttachment = useAttachmentStore((s) => s.removeAttachment);
  const [preview, setPreview] = useState<Attachment | null>(null);

  if (attachments.length === 0) return null;

  const handleClick = (att: Attachment) => {
    if (att.isImage && att.thumbnailUrl) {
      setPreview(att);
    } else {
      // Open non-image files with the OS default app
      openUrl(att.filePath).catch((e) =>
        console.error("Failed to open file:", e)
      );
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5 px-3 pt-2">
        {attachments.map((att) => (
          <div
            key={att.id}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-subtle border border-border-light text-ui group cursor-pointer hover:border-accent/30 transition-colors"
            onClick={() => handleClick(att)}
          >
            {att.isImage ? (
              att.thumbnailUrl ? (
                <img
                  src={att.thumbnailUrl}
                  alt={att.fileName}
                  className="w-[36px] h-[36px] rounded object-cover shrink-0"
                />
              ) : (
                <ImageIcon size={14} className="text-blue shrink-0" />
              )
            ) : (
              <FileText size={14} className="text-text-dim shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-text-secondary truncate max-w-[120px]">{att.fileName}</p>
              <p className="text-label text-text-ghost">{formatSize(att.fileSize)}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); removeAttachment(sessionId, att.id); }}
              className="p-0.5 rounded hover:bg-bg-elevated text-text-ghost hover:text-text-secondary transition-colors shrink-0 opacity-0 group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Image preview modal */}
      <Dialog.Root open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" />
          <Dialog.Content
            className="fixed inset-4 z-50 flex items-center justify-center"
            onClick={() => setPreview(null)}
          >
            <Dialog.Title className="sr-only">
              {preview?.fileName ?? "Image preview"}
            </Dialog.Title>
            {preview?.thumbnailUrl && (
              <div className="relative max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
                <img
                  src={preview.thumbnailUrl}
                  alt={preview.fileName}
                  className="max-w-full max-h-[calc(100vh-4rem)] rounded-lg shadow-2xl object-contain"
                />
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2 rounded-b-lg" style={{ background: "rgba(0,0,0,0.6)" }}>
                  <span className="text-white text-ui truncate">{preview.fileName} — {formatSize(preview.fileSize)}</span>
                  <button
                    onClick={() => setPreview(null)}
                    className="text-white/70 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
