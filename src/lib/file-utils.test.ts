import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFileBytes = vi.fn<(filePath: string) => Promise<number[]>>();
const mockGetFileInfo = vi.fn<(filePath: string) => Promise<{
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  is_image: boolean;
}>>();
const mockReadFileContent = vi.fn<(filePath: string) => Promise<string>>();

vi.mock("./tauri-commands", () => ({
  readFileBytes: (...args: unknown[]) => mockReadFileBytes(...(args as [string])),
  getFileInfo: (...args: unknown[]) => mockGetFileInfo(...(args as [string])),
  readFileContent: (...args: unknown[]) => mockReadFileContent(...(args as [string])),
}));

import {
  fileToBase64,
  readFileContentSafe,
  createPreviewUrl,
  processDroppedPaths,
  processDroppedPathsForSpec,
} from "./file-utils";

describe("fileToBase64", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns base64 encoded data and mime type", async () => {
    const helloBytes = [72, 101, 108, 108, 111];
    mockReadFileBytes.mockResolvedValueOnce(helloBytes);
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/test/hello.txt",
      file_name: "hello.txt",
      file_size: 5,
      mime_type: "text/plain",
      is_image: false,
    });

    const result = await fileToBase64("/test/hello.txt");

    expect(result.data).toBe(btoa("Hello"));
    expect(result.mimeType).toBe("text/plain");
    expect(mockReadFileBytes).toHaveBeenCalledWith("/test/hello.txt");
    expect(mockGetFileInfo).toHaveBeenCalledWith("/test/hello.txt");
  });

  it("handles binary data correctly", async () => {
    const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10];
    mockReadFileBytes.mockResolvedValueOnce(pngHeader);
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/test/image.png",
      file_name: "image.png",
      file_size: 8,
      mime_type: "image/png",
      is_image: true,
    });

    const result = await fileToBase64("/test/image.png");

    const decoded = atob(result.data);
    expect(decoded.length).toBe(8);
    expect(decoded.charCodeAt(0)).toBe(137);
    expect(decoded.charCodeAt(1)).toBe(80);
    expect(result.mimeType).toBe("image/png");
  });

  it("combines readFileBytes and getFileInfo results via Promise.all", async () => {
    const bytes = [65, 66, 67];
    mockReadFileBytes.mockResolvedValueOnce(bytes);
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/test/data.bin",
      file_name: "data.bin",
      file_size: 3,
      mime_type: "application/octet-stream",
      is_image: false,
    });

    const result = await fileToBase64("/test/data.bin");

    expect(result.data).toBe(btoa("ABC"));
    expect(result.mimeType).toBe("application/octet-stream");
    expect(mockReadFileBytes).toHaveBeenCalledTimes(1);
    expect(mockGetFileInfo).toHaveBeenCalledTimes(1);
  });
});

describe("readFileContentSafe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns file content for text files", async () => {
    mockReadFileContent.mockResolvedValueOnce("hello world");
    const result = await readFileContentSafe("/test/file.txt");
    expect(result).toBe("hello world");
  });

  it("returns undefined for binary files that fail to read", async () => {
    mockReadFileContent.mockRejectedValueOnce(new Error("invalid utf-8"));
    const result = await readFileContentSafe("/test/file.pdf");
    expect(result).toBeUndefined();
  });

  it("returns undefined for oversized files", async () => {
    mockReadFileContent.mockRejectedValueOnce(new Error("File too large"));
    const result = await readFileContentSafe("/test/huge.txt");
    expect(result).toBeUndefined();
  });
});

describe("createPreviewUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a blob: URL for valid files", async () => {
    mockReadFileBytes.mockResolvedValueOnce([137, 80, 78, 71]);
    const result = await createPreviewUrl("/test/img.png", "image/png");
    expect(result).toMatch(/^blob:/);
  });

  it("returns undefined when readFileBytes fails", async () => {
    mockReadFileBytes.mockRejectedValueOnce(new Error("not found"));
    const result = await createPreviewUrl("/test/missing.png", "image/png");
    expect(result).toBeUndefined();
  });
});

describe("processDroppedPaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates Attachment for an image file with thumbnail", async () => {
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/photos/cat.png",
      file_name: "cat.png",
      file_size: 2048,
      mime_type: "image/png",
      is_image: true,
    });
    mockReadFileBytes.mockResolvedValueOnce([137, 80, 78, 71]);

    const result = await processDroppedPaths(["/photos/cat.png"]);

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe("cat.png");
    expect(result[0].filePath).toBe("/photos/cat.png");
    expect(result[0].isImage).toBe(true);
    expect(result[0].thumbnailUrl).toMatch(/^blob:/);
  });

  it("creates Attachment for a non-image file without thumbnail", async () => {
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/docs/readme.md",
      file_name: "readme.md",
      file_size: 500,
      mime_type: "text/plain",
      is_image: false,
    });

    const result = await processDroppedPaths(["/docs/readme.md"]);

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe("readme.md");
    expect(result[0].isImage).toBe(false);
    expect(result[0].thumbnailUrl).toBeUndefined();
  });

  it("handles multiple files", async () => {
    mockGetFileInfo
      .mockResolvedValueOnce({
        file_path: "/a.png", file_name: "a.png", file_size: 100,
        mime_type: "image/png", is_image: true,
      })
      .mockResolvedValueOnce({
        file_path: "/b.txt", file_name: "b.txt", file_size: 50,
        mime_type: "text/plain", is_image: false,
      });
    mockReadFileBytes.mockResolvedValueOnce([0]);

    const result = await processDroppedPaths(["/a.png", "/b.txt"]);
    expect(result).toHaveLength(2);
    expect(result[0].isImage).toBe(true);
    expect(result[1].isImage).toBe(false);
  });

  it("skips files that fail getFileInfo and continues", async () => {
    mockGetFileInfo
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({
        file_path: "/ok.txt", file_name: "ok.txt", file_size: 10,
        mime_type: "text/plain", is_image: false,
      });

    const result = await processDroppedPaths(["/missing.txt", "/ok.txt"]);
    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe("ok.txt");
  });
});

describe("processDroppedPathsForSpec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates SpecAttachment with data: URI for images", async () => {
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/img/photo.png",
      file_name: "photo.png",
      file_size: 1024,
      mime_type: "image/png",
      is_image: true,
    });
    mockReadFileBytes.mockResolvedValueOnce([65, 66, 67]); // "ABC"

    const result = await processDroppedPathsForSpec(["/img/photo.png"]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("image");
    expect(result[0].name).toBe("photo.png");
    // Must be a data: URI, not blob: — the API message builder splits on comma
    expect(result[0].preview_url).toMatch(/^data:image\/png;base64,/);
    const base64Part = result[0].preview_url!.split(",")[1];
    expect(atob(base64Part)).toBe("ABC");
  });

  it("creates SpecAttachment with text_content for text files", async () => {
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/docs/spec.md",
      file_name: "spec.md",
      file_size: 200,
      mime_type: "text/plain",
      is_image: false,
    });
    mockReadFileContent.mockResolvedValueOnce("# My Spec\nSome content here");

    const result = await processDroppedPathsForSpec(["/docs/spec.md"]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("document");
    expect(result[0].name).toBe("spec.md");
    expect(result[0].text_content).toBe("# My Spec\nSome content here");
  });

  it("truncates text_content at 10000 chars with ellipsis", async () => {
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/docs/long.txt",
      file_name: "long.txt",
      file_size: 20000,
      mime_type: "text/plain",
      is_image: false,
    });
    const longContent = "x".repeat(15000);
    mockReadFileContent.mockResolvedValueOnce(longContent);

    const result = await processDroppedPathsForSpec(["/docs/long.txt"]);

    expect(result).toHaveLength(1);
    expect(result[0].text_content).toHaveLength(10003); // 10000 + "..."
    expect(result[0].text_content!.endsWith("...")).toBe(true);
  });

  it("creates SpecAttachment with reference note for binary files", async () => {
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/docs/report.pdf",
      file_name: "report.pdf",
      file_size: 51200,
      mime_type: "application/pdf",
      is_image: false,
    });
    mockReadFileContent.mockRejectedValueOnce(new Error("invalid utf-8"));

    const result = await processDroppedPathsForSpec(["/docs/report.pdf"]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("document");
    expect(result[0].name).toBe("report.pdf");
    // Should contain a binary file reference, not be undefined
    expect(result[0].text_content).toContain("report.pdf");
    expect(result[0].text_content).toContain("application/pdf");
    expect(result[0].text_content).toContain("50KB");
  });

  it("never silently drops files — binary docs still appear as attachments", async () => {
    mockGetFileInfo.mockResolvedValueOnce({
      file_path: "/docs/spreadsheet.xlsx",
      file_name: "spreadsheet.xlsx",
      file_size: 10240,
      mime_type: "application/octet-stream",
      is_image: false,
    });
    mockReadFileContent.mockRejectedValueOnce(new Error("invalid utf-8"));

    const result = await processDroppedPathsForSpec(["/docs/spreadsheet.xlsx"]);

    // The attachment must still be created even though content reading failed
    expect(result).toHaveLength(1);
    expect(result[0].text_content).toBeDefined();
    expect(result[0].text_content!.length).toBeGreaterThan(0);
  });

  it("skips files that fail getFileInfo entirely", async () => {
    mockGetFileInfo
      .mockRejectedValueOnce(new Error("file not found"))
      .mockResolvedValueOnce({
        file_path: "/ok.txt", file_name: "ok.txt", file_size: 5,
        mime_type: "text/plain", is_image: false,
      });
    mockReadFileContent.mockResolvedValueOnce("hello");

    const result = await processDroppedPathsForSpec(["/missing.txt", "/ok.txt"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ok.txt");
  });
});
