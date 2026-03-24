import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ImagePreviewModal from "./ImagePreviewModal";
import { useUiStore } from "../../stores/uiStore";

vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <div onClick={onClick} className={className}>{children}</div>
  ),
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
}));

describe("ImagePreviewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ imagePreview: null });
  });

  it("does not render when no image preview is set", () => {
    const { container } = render(<ImagePreviewModal />);
    expect(container.querySelector("[data-testid='dialog-root']")).not.toBeInTheDocument();
  });

  it("renders image when preview is set", () => {
    useUiStore.setState({
      imagePreview: {
        filePath: "/path/to/image.png",
        fileName: "image.png",
        blobUrl: "blob:http://localhost/abc123",
        fileSize: 1024,
      },
    });
    render(<ImagePreviewModal />);
    const img = screen.getByAltText("image.png");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "blob:http://localhost/abc123");
  });

  it("displays file name and size", () => {
    useUiStore.setState({
      imagePreview: {
        filePath: "/path/to/image.png",
        fileName: "image.png",
        blobUrl: "blob:http://localhost/abc123",
        fileSize: 1024,
      },
    });
    render(<ImagePreviewModal />);
    // The filename + size are in a single span: "image.png — 1.0 KB"
    expect(screen.getByText(/image\.png — 1\.0 KB/)).toBeInTheDocument();
  });

  it("formats large file sizes in MB", () => {
    useUiStore.setState({
      imagePreview: {
        filePath: "/path/to/large.png",
        fileName: "large.png",
        blobUrl: "blob:http://localhost/def456",
        fileSize: 2 * 1024 * 1024,
      },
    });
    render(<ImagePreviewModal />);
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
  });

  it("has a close button with proper aria label", () => {
    useUiStore.setState({
      imagePreview: {
        filePath: "/path/to/image.png",
        fileName: "image.png",
        blobUrl: "blob:http://localhost/abc123",
        fileSize: 512,
      },
    });
    render(<ImagePreviewModal />);
    expect(screen.getByLabelText("Close preview")).toBeInTheDocument();
  });

  it("calls setImagePreview(null) when close button is clicked", () => {
    const setImagePreview = vi.fn();
    useUiStore.setState({
      imagePreview: {
        filePath: "/path/to/image.png",
        fileName: "image.png",
        blobUrl: "blob:http://localhost/abc123",
        fileSize: 512,
      },
      setImagePreview,
    });
    render(<ImagePreviewModal />);
    fireEvent.click(screen.getByLabelText("Close preview"));
    expect(setImagePreview).toHaveBeenCalledWith(null);
  });
});
