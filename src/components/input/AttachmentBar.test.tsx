import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AttachmentBar from "./AttachmentBar";
import { useAttachmentStore } from "../../stores/attachmentStore";
import type { Attachment } from "../../types/attachment";

const SESSION_ID = "s1";

const IMG: Attachment = {
  id: "att-1",
  fileName: "screenshot.png",
  filePath: "/tmp/screenshot.png",
  fileSize: 2048,
  mimeType: "image/png",
  isImage: true,
};

const LARGE_FILE: Attachment = {
  id: "att-2",
  fileName: "video.mp4",
  filePath: "/tmp/video.mp4",
  fileSize: 5 * 1024 * 1024,
  mimeType: "video/mp4",
  isImage: false,
};

const SMALL_FILE: Attachment = {
  id: "att-3",
  fileName: "readme.txt",
  filePath: "/tmp/readme.txt",
  fileSize: 128,
  mimeType: "text/plain",
  isImage: false,
};

const KB_FILE: Attachment = {
  id: "att-4",
  fileName: "data.json",
  filePath: "/tmp/data.json",
  fileSize: 4096,
  mimeType: "application/json",
  isImage: false,
};

function setAttachments(sessionId: string, attachments: Attachment[]) {
  useAttachmentStore.setState({
    attachments: new Map([[sessionId, attachments]]),
  });
}

describe("AttachmentBar", () => {
  beforeEach(() => {
    useAttachmentStore.setState({ attachments: new Map() });
  });

  it("renders nothing when no attachments", () => {
    const { container } = render(<AttachmentBar sessionId={SESSION_ID} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders attachment chip with file name", () => {
    setAttachments(SESSION_ID, [IMG]);
    render(<AttachmentBar sessionId={SESSION_ID} />);
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
  });

  it("renders multiple attachments", () => {
    setAttachments(SESSION_ID, [IMG, SMALL_FILE]);
    render(<AttachmentBar sessionId={SESSION_ID} />);
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
  });

  it("displays file size in bytes for small files", () => {
    setAttachments(SESSION_ID, [SMALL_FILE]);
    render(<AttachmentBar sessionId={SESSION_ID} />);
    expect(screen.getByText("128 B")).toBeInTheDocument();
  });

  it("displays file size in KB", () => {
    setAttachments(SESSION_ID, [KB_FILE]);
    render(<AttachmentBar sessionId={SESSION_ID} />);
    expect(screen.getByText("4.0 KB")).toBeInTheDocument();
  });

  it("displays file size in MB", () => {
    setAttachments(SESSION_ID, [LARGE_FILE]);
    render(<AttachmentBar sessionId={SESSION_ID} />);
    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
  });

  it("displays image size correctly", () => {
    setAttachments(SESSION_ID, [IMG]);
    render(<AttachmentBar sessionId={SESSION_ID} />);
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("removes attachment when X is clicked", () => {
    setAttachments(SESSION_ID, [IMG, SMALL_FILE]);
    render(<AttachmentBar sessionId={SESSION_ID} />);

    // Find the first remove button (there should be one per attachment)
    const removeButtons = screen.getAllByRole("button");
    fireEvent.click(removeButtons[0]);

    const remaining = useAttachmentStore.getState().attachments.get(SESSION_ID) ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("att-3");
  });

  it("renders thumbnail when thumbnailUrl is present", () => {
    const withThumb: Attachment = {
      ...IMG,
      thumbnailUrl: "data:image/png;base64,abc123",
    };
    setAttachments(SESSION_ID, [withThumb]);
    render(<AttachmentBar sessionId={SESSION_ID} />);

    const img = screen.getByAltText("screenshot.png");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("data:image/png;base64,abc123");
  });

  it("does not show attachments from a different session", () => {
    useAttachmentStore.setState({
      attachments: new Map([["other-session", [IMG]]]),
    });
    const { container } = render(<AttachmentBar sessionId={SESSION_ID} />);
    expect(container.innerHTML).toBe("");
  });
});
