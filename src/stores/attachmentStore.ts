import { create } from "zustand";
import type { Attachment } from "../types/attachment";

interface AttachmentState {
  attachments: Map<string, Attachment[]>; // sessionId → attachments
  addAttachment: (sessionId: string, attachment: Attachment) => void;
  removeAttachment: (sessionId: string, id: string) => void;
  clearAttachments: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
}

export const useAttachmentStore = create<AttachmentState>((set) => ({
  attachments: new Map(),

  addAttachment: (sessionId, attachment) =>
    set((s) => {
      const next = new Map(s.attachments);
      const list = next.get(sessionId) ?? [];
      next.set(sessionId, [...list, attachment]);
      return { attachments: next };
    }),

  removeAttachment: (sessionId, id) =>
    set((s) => {
      const next = new Map(s.attachments);
      const list = next.get(sessionId) ?? [];
      next.set(sessionId, list.filter((a) => a.id !== id));
      return { attachments: next };
    }),

  clearAttachments: (sessionId) =>
    set((s) => {
      const next = new Map(s.attachments);
      next.set(sessionId, []);
      return { attachments: next };
    }),

  clearSession: (sessionId) =>
    set((s) => {
      const next = new Map(s.attachments);
      next.delete(sessionId);
      return { attachments: next };
    }),
}));
