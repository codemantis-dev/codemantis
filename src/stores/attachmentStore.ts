import { create } from "zustand";
import type { Attachment } from "../types/attachment";

interface AttachmentState {
  attachments: Attachment[];
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
}

export const useAttachmentStore = create<AttachmentState>((set) => ({
  attachments: [],

  addAttachment: (attachment) =>
    set((s) => ({ attachments: [...s.attachments, attachment] })),

  removeAttachment: (id) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

  clearAttachments: () => set({ attachments: [] }),
}));
