import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssistantAttachmentBar from "./AssistantAttachmentBar";
import type { Attachment } from "../../types/attachment";

// Mock Radix Dialog portal to render inline
vi.mock("@radix-ui/react-dialog", () => {
  const React = require("react");
  return {
    Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open !== false ? children : null,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement("div", { "data-testid": "dialog-overlay", ...props }, children),
    Content: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement("div", { "data-testid": "dialog-content", ...props }, children),
    Title: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement("h2", props, children),
  };
});

function makeAttachment(overrides?: Partial<Attachment>): Attachment {
  return {
    id: "att-1",
    fileName: "test.png",
    filePath: "/tmp/test.png",
    fileSize: 2048,
    mimeType: "image/png",
    isImage: true,
    thumbnailUrl: "data:image/png;base64,abc",
    ...overrides,
  };
}

describe("AssistantAttachmentBar", () => {
  const onRemove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when attachments array is empty", () => {
    const { container } = render(
      <AssistantAttachmentBar attachments={[]} onRemove={onRemove} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders attachment file name and formatted size", () => {
    render(
      <AssistantAttachmentBar
        attachments={[makeAttachment({ fileSize: 1536 })]}
        onRemove={onRemove}
      />
    );
    expect(screen.getByText("test.png")).toBeInTheDocument();
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
  });

  it("renders thumbnail for image attachments", () => {
    render(
      <AssistantAttachmentBar
        attachments={[makeAttachment()]}
        onRemove={onRemove}
      />
    );
    const img = screen.getByAltText("test.png");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "data:image/png;base64,abc");
  });

  it("renders FileText icon for non-image attachments", () => {
    render(
      <AssistantAttachmentBar
        attachments={[makeAttachment({ isImage: false, thumbnailUrl: undefined })]}
        onRemove={onRemove}
      />
    );
    // No <img> tag
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("test.png")).toBeInTheDocument();
  });

  it("calls onRemove with correct id when X button clicked", () => {
    render(
      <AssistantAttachmentBar
        attachments={[makeAttachment({ id: "att-42" })]}
        onRemove={onRemove}
      />
    );
    fireEvent.click(screen.getByLabelText("Remove test.png"));
    expect(onRemove).toHaveBeenCalledWith("att-42");
  });

  it("formats bytes correctly for different sizes", () => {
    render(
      <AssistantAttachmentBar
        attachments={[
          makeAttachment({ id: "a1", fileName: "small.txt", fileSize: 500 }),
          makeAttachment({ id: "a2", fileName: "medium.txt", fileSize: 51200 }),
          makeAttachment({ id: "a3", fileName: "large.txt", fileSize: 2621440 }),
        ]}
        onRemove={onRemove}
      />
    );
    expect(screen.getByText("500 B")).toBeInTheDocument();
    expect(screen.getByText("50.0 KB")).toBeInTheDocument();
    expect(screen.getByText("2.5 MB")).toBeInTheDocument();
  });

  it("renders multiple attachments", () => {
    render(
      <AssistantAttachmentBar
        attachments={[
          makeAttachment({ id: "a1", fileName: "one.png" }),
          makeAttachment({ id: "a2", fileName: "two.png" }),
        ]}
        onRemove={onRemove}
      />
    );
    expect(screen.getByText("one.png")).toBeInTheDocument();
    expect(screen.getByText("two.png")).toBeInTheDocument();
  });
});
