import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFileBytes = vi.fn<(filePath: string) => Promise<number[]>>();
const mockGetFileInfo = vi.fn<(filePath: string) => Promise<{
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  is_image: boolean;
}>>();

vi.mock("./tauri-commands", () => ({
  readFileBytes: (...args: unknown[]) => mockReadFileBytes(...(args as [string])),
  getFileInfo: (...args: unknown[]) => mockGetFileInfo(...(args as [string])),
}));

import { fileToBase64 } from "./file-utils";

describe("fileToBase64", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns base64 encoded data and mime type", async () => {
    // "Hello" in ASCII bytes
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
    // PNG header bytes (first 8 bytes of a PNG)
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

    // Verify it produces valid base64
    const decoded = atob(result.data);
    expect(decoded.length).toBe(8);
    expect(decoded.charCodeAt(0)).toBe(137);
    expect(decoded.charCodeAt(1)).toBe(80); // 'P'
    expect(result.mimeType).toBe("image/png");
  });

  it("combines readFileBytes and getFileInfo results via Promise.all", async () => {
    const bytes = [65, 66, 67]; // "ABC"
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

    // Both calls should have been made (in parallel via Promise.all)
    expect(mockReadFileBytes).toHaveBeenCalledTimes(1);
    expect(mockGetFileInfo).toHaveBeenCalledTimes(1);
  });
});
