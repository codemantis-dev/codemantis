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
    useAttachmentStore.setState({ attachments: [] });
  });

  it("starts empty", () => {
    expect(useAttachmentStore.getState().attachments).toEqual([]);
  });

  it("adds attachment", () => {
    useAttachmentStore.getState().addAttachment(IMG);
    expect(useAttachmentStore.getState().attachments).toHaveLength(1);
    expect(useAttachmentStore.getState().attachments[0].fileName).toBe("screenshot.png");
  });

  it("adds multiple attachments", () => {
    useAttachmentStore.getState().addAttachment(IMG);
    useAttachmentStore.getState().addAttachment(FILE);
    expect(useAttachmentStore.getState().attachments).toHaveLength(2);
  });

  it("removes attachment by id", () => {
    useAttachmentStore.getState().addAttachment(IMG);
    useAttachmentStore.getState().addAttachment(FILE);
    useAttachmentStore.getState().removeAttachment("att-1");
    const remaining = useAttachmentStore.getState().attachments;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("att-2");
  });

  it("clears all attachments", () => {
    useAttachmentStore.getState().addAttachment(IMG);
    useAttachmentStore.getState().addAttachment(FILE);
    useAttachmentStore.getState().clearAttachments();
    expect(useAttachmentStore.getState().attachments).toEqual([]);
  });
});
