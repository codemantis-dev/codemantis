import { X, Image as ImageIcon, FileText } from "lucide-react";
import { useAttachmentStore } from "../../stores/attachmentStore";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentBar() {
  const attachments = useAttachmentStore((s) => s.attachments);
  const removeAttachment = useAttachmentStore((s) => s.removeAttachment);

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-subtle border border-border-light text-ui group"
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
            onClick={() => removeAttachment(att.id)}
            className="p-0.5 rounded hover:bg-bg-elevated text-text-ghost hover:text-text-secondary transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
