import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useUiStore } from "../../stores/uiStore";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImagePreviewModal() {
  const preview = useUiStore((s) => s.imagePreview);
  const setImagePreview = useUiStore((s) => s.setImagePreview);

  const close = () => setImagePreview(null);

  return (
    <Dialog.Root open={preview !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed inset-4 z-50 flex items-center justify-center"
          onClick={close}
        >
          <Dialog.Title className="sr-only">
            {preview?.fileName ?? "Image preview"}
          </Dialog.Title>
          {preview && (
            <div className="relative max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
              <img
                src={preview.blobUrl}
                alt={preview.fileName}
                className="max-w-full max-h-[calc(100vh-4rem)] rounded-lg shadow-2xl object-contain"
              />
              <div
                className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2 rounded-b-lg"
                style={{ background: "rgba(0,0,0,0.6)" }}
              >
                <span className="text-white text-ui truncate">
                  {preview.fileName} — {formatFileSize(preview.fileSize)}
                </span>
                <button
                  onClick={close}
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
  );
}
