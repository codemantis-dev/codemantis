import { describe, it, expect, beforeEach } from "vitest";
import { useAttachmentStore } from "./attachmentStore";
import type { Attachment } from "../types/attachment";

const IMG: Attachment = {
  id: "att-1",
  fileName: "screenshot.png",
  filePath: "/tmp/screenshot.png",
  fileSize: 1024,
  mimeType: "image/png",
  isImage: true,
};

const FILE: Attachment = {
  id: "att-2",
  fileName: "data.json",
  filePath: "/tmp/data.json",
  fileSize: 256,
  mimeType: "application/json",
  isImage: false,
};

describe("attachmentStore", () => {
  beforeEach(() => {
    useAttachmentStore.setState({ attachments: new Map() });
  });

  it("starts empty", () => {
    expect(useAttachmentStore.getState().attachments.size).toBe(0);
  });

  it("adds attachment to session", () => {
    useAttachmentStore.getState().addAttachment("s1", IMG);
    const list = useAttachmentStore.getState().attachments.get("s1") ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toBe("screenshot.png");
  });

  it("adds multiple attachments to same session", () => {
    useAttachmentStore.getState().addAttachment("s1", IMG);
    useAttachmentStore.getState().addAttachment("s1", FILE);
    const list = useAttachmentStore.getState().attachments.get("s1") ?? [];
    expect(list).toHaveLength(2);
  });

  it("removes attachment by id from session", () => {
    useAttachmentStore.getState().addAttachment("s1", IMG);
    useAttachmentStore.getState().addAttachment("s1", FILE);
    useAttachmentStore.getState().removeAttachment("s1", "att-1");
    const remaining = useAttachmentStore.getState().attachments.get("s1") ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("att-2");
  });

  it("clears all attachments for a session", () => {
    useAttachmentStore.getState().addAttachment("s1", IMG);
    useAttachmentStore.getState().addAttachment("s1", FILE);
    useAttachmentStore.getState().clearAttachments("s1");
    const list = useAttachmentStore.getState().attachments.get("s1") ?? [];
    expect(list).toEqual([]);
  });

  it("clearSession removes session entry entirely", () => {
    useAttachmentStore.getState().addAttachment("s1", IMG);
    useAttachmentStore.getState().clearSession("s1");
    expect(useAttachmentStore.getState().attachments.has("s1")).toBe(false);
  });

  it("isolates attachments between sessions", () => {
    useAttachmentStore.getState().addAttachment("s1", IMG);
    useAttachmentStore.getState().addAttachment("s2", FILE);

    const s1 = useAttachmentStore.getState().attachments.get("s1") ?? [];
    const s2 = useAttachmentStore.getState().attachments.get("s2") ?? [];

    expect(s1).toHaveLength(1);
    expect(s1[0].id).toBe("att-1");
    expect(s2).toHaveLength(1);
    expect(s2[0].id).toBe("att-2");
  });

  it("removing from one session does not affect another", () => {
    useAttachmentStore.getState().addAttachment("s1", IMG);
    useAttachmentStore.getState().addAttachment("s2", IMG);
    useAttachmentStore.getState().removeAttachment("s1", "att-1");

    expect(useAttachmentStore.getState().attachments.get("s1") ?? []).toHaveLength(0);
    expect(useAttachmentStore.getState().attachments.get("s2") ?? []).toHaveLength(1);
  });
});
