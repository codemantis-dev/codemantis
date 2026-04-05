import { useState } from "react";
import { X, Image as ImageIcon, FileText } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { Attachment } from "../../types/attachment";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

export default function AssistantAttachmentBar({ attachments, onRemove }: Props) {
  const [preview, setPreview] = useState<Attachment | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-1">
        {attachments.map((att) => (
          <div
            key={att.id}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-subtle border border-border-light text-ui group cursor-pointer hover:border-accent/30 transition-colors"
            onClick={() => {
              if (att.isImage && att.thumbnailUrl) setPreview(att);
            }}
          >
            {att.isImage ? (
              att.thumbnailUrl ? (
                <img
                  src={att.thumbnailUrl}
                  alt={att.fileName}
                  className="w-[28px] h-[28px] rounded object-cover shrink-0"
                />
              ) : (
                <ImageIcon size={12} className="text-blue shrink-0" />
              )
            ) : (
              <FileText size={12} className="text-text-dim shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-label text-text-secondary truncate max-w-[100px]">{att.fileName}</p>
              <p className="text-fine text-text-ghost">{formatSize(att.fileSize)}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(att.id); }}
              aria-label={`Remove ${att.fileName}`}
              className="p-0.5 rounded hover:bg-bg-elevated text-text-ghost hover:text-text-secondary transition-colors shrink-0 opacity-0 group-hover:opacity-100"
            >
              <X size={10} />
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
                    aria-label="Close preview"
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
