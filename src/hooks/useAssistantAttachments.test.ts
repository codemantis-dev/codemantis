import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAssistantAttachments } from "./useAssistantAttachments";
import { useAssistantStore } from "../stores/assistantStore";

// ── Mocks ────────────────────────────────────────────────────────

const mockSaveClipboardImage = vi.fn();
const mockGetFileInfo = vi.fn();

vi.mock("../lib/tauri-commands", () => ({
  saveClipboardImage: (...args: unknown[]) => mockSaveClipboardImage(...args),
  getFileInfo: (...args: unknown[]) => mockGetFileInfo(...args),
}));

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));

vi.mock("../lib/file-utils", () => ({
  createPreviewUrl: vi.fn().mockResolvedValue("blob:preview-url"),
  processDroppedPaths: vi.fn().mockResolvedValue([]),
}));

vi.mock("./useFileDrop", () => ({
  useFileDrop: () => ({ isDragOver: false }),
}));

// ── Test helpers ─────────────────────────────────────────────────

const SESSION_ID = "assistant-1";
const PROJECT_PATH = "/tmp/test-project";

function makeFileInfo(overrides: Record<string, unknown> = {}) {
  return {
    file_path: "/tmp/test-project/attachments/test.png",
    file_name: "test.png",
    file_size: 1024,
    mime_type: "image/png",
    is_image: true,
    ...overrides,
  };
}

function resetStore(): void {
  useAssistantStore.setState({
    attachments: new Map(),
  });
}

describe("useAssistantAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // ── Initialization ──

  it("returns empty attachments array when no session", () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: null,
        activeProjectPath: null,
      })
    );
    expect(result.current.currentAttachments).toEqual([]);
  });

  it("returns empty attachments array for new session", () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );
    expect(result.current.currentAttachments).toEqual([]);
  });

  it("returns all handler functions", () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );
    expect(result.current.addAssistantAttachment).toBeInstanceOf(Function);
    expect(result.current.removeAssistantAttachment).toBeInstanceOf(Function);
    expect(result.current.clearAssistantAttachments).toBeInstanceOf(Function);
    expect(result.current.handlePaste).toBeInstanceOf(Function);
    expect(result.current.handleFileDialog).toBeInstanceOf(Function);
    expect(result.current.inputContainerRef).toBeDefined();
  });

  // ── Store integration ──

  it("reflects attachments from store", () => {
    const att = {
      id: "att-1",
      fileName: "test.png",
      filePath: "/path/test.png",
      fileSize: 1024,
      mimeType: "image/png",
      isImage: true,
    };
    useAssistantStore.getState().addAssistantAttachment(SESSION_ID, att);

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );
    expect(result.current.currentAttachments).toHaveLength(1);
    expect(result.current.currentAttachments[0].fileName).toBe("test.png");
  });

  it("addAssistantAttachment adds to store", () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    act(() => {
      result.current.addAssistantAttachment(SESSION_ID, {
        id: "att-new",
        fileName: "doc.pdf",
        filePath: "/path/doc.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
        isImage: false,
      });
    });

    expect(result.current.currentAttachments).toHaveLength(1);
    expect(result.current.currentAttachments[0].id).toBe("att-new");
  });

  it("removeAssistantAttachment removes from store", () => {
    useAssistantStore.getState().addAssistantAttachment(SESSION_ID, {
      id: "att-1",
      fileName: "test.png",
      filePath: "/path/test.png",
      fileSize: 1024,
      mimeType: "image/png",
      isImage: true,
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    expect(result.current.currentAttachments).toHaveLength(1);

    act(() => {
      result.current.removeAssistantAttachment(SESSION_ID, "att-1");
    });

    expect(result.current.currentAttachments).toHaveLength(0);
  });

  it("clearAssistantAttachments empties all for session", () => {
    const store = useAssistantStore.getState();
    store.addAssistantAttachment(SESSION_ID, {
      id: "att-1", fileName: "a.png", filePath: "/a", fileSize: 100, mimeType: "image/png", isImage: true,
    });
    store.addAssistantAttachment(SESSION_ID, {
      id: "att-2", fileName: "b.png", filePath: "/b", fileSize: 200, mimeType: "image/png", isImage: true,
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    expect(result.current.currentAttachments).toHaveLength(2);

    act(() => {
      result.current.clearAssistantAttachments(SESSION_ID);
    });

    expect(result.current.currentAttachments).toHaveLength(0);
  });

  // ── handlePaste ──

  it("handlePaste does nothing without active session", async () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: null,
        activeProjectPath: null,
      })
    );

    const event = {
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => new File([""], "test.png", { type: "image/png" }) }],
      },
      preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent;

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(mockSaveClipboardImage).not.toHaveBeenCalled();
  });

  it("handlePaste does nothing without clipboardData", async () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const event = {
      clipboardData: null,
      preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent;

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(mockSaveClipboardImage).not.toHaveBeenCalled();
  });

  it("handlePaste saves clipboard image and adds attachment", async () => {
    mockSaveClipboardImage.mockResolvedValue(makeFileInfo());

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const fakeFile = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const event = {
      clipboardData: {
        items: [{
          type: "image/png",
          getAsFile: () => fakeFile,
        }],
      },
      preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent;

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockSaveClipboardImage).toHaveBeenCalledWith(
      PROJECT_PATH,
      expect.any(Array),
      expect.stringMatching(/^clipboard_\d{6}\.png$/)
    );
    expect(result.current.currentAttachments).toHaveLength(1);
    expect(result.current.currentAttachments[0].fileName).toBe("test.png");
  });

  it("handlePaste handles save errors gracefully", async () => {
    mockSaveClipboardImage.mockRejectedValue(new Error("Disk full"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const fakeFile = new File([new Uint8Array([1])], "img.png", { type: "image/png" });
    const event = {
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => fakeFile }],
      },
      preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent;

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(consoleError).toHaveBeenCalledWith("Failed to save clipboard image:", expect.any(Error));
    expect(result.current.currentAttachments).toHaveLength(0);
    consoleError.mockRestore();
  });

  it("handlePaste ignores non-image clipboard items", async () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const event = {
      clipboardData: {
        items: [{ type: "text/plain", getAsFile: () => null }],
      },
      preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent;

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockSaveClipboardImage).not.toHaveBeenCalled();
  });

  it("handlePaste skips items with null file", async () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const event = {
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => null }],
      },
      preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent;

    await act(async () => {
      await result.current.handlePaste(event);
    });

    // preventDefault is called because the item type starts with "image/"
    // but getAsFile() returns null, so saveClipboardImage is never called
    expect(mockSaveClipboardImage).not.toHaveBeenCalled();
  });

  // ── handleFileDialog ──

  it("handleFileDialog does nothing without active session", async () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: null,
        activeProjectPath: null,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("handleFileDialog does nothing when user cancels", async () => {
    mockOpen.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(mockOpen).toHaveBeenCalled();
    expect(mockGetFileInfo).not.toHaveBeenCalled();
    expect(result.current.currentAttachments).toHaveLength(0);
  });

  it("handleFileDialog adds single file attachment", async () => {
    mockOpen.mockResolvedValue("/path/to/file.py");
    mockGetFileInfo.mockResolvedValue(makeFileInfo({
      file_path: "/path/to/file.py",
      file_name: "file.py",
      file_size: 512,
      mime_type: "text/x-python",
      is_image: false,
    }));

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(mockGetFileInfo).toHaveBeenCalledWith("/path/to/file.py");
    expect(result.current.currentAttachments).toHaveLength(1);
    expect(result.current.currentAttachments[0].fileName).toBe("file.py");
    expect(result.current.currentAttachments[0].isImage).toBe(false);
  });

  it("handleFileDialog handles multiple file selection", async () => {
    mockOpen.mockResolvedValue(["/path/a.png", "/path/b.ts"]);
    mockGetFileInfo
      .mockResolvedValueOnce(makeFileInfo({ file_name: "a.png", file_path: "/path/a.png" }))
      .mockResolvedValueOnce(makeFileInfo({
        file_name: "b.ts",
        file_path: "/path/b.ts",
        mime_type: "text/typescript",
        is_image: false,
      }));

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(mockGetFileInfo).toHaveBeenCalledTimes(2);
    expect(result.current.currentAttachments).toHaveLength(2);
  });

  it("handleFileDialog continues on individual file errors", async () => {
    mockOpen.mockResolvedValue(["/path/ok.png", "/path/bad.bin", "/path/ok2.ts"]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    mockGetFileInfo
      .mockResolvedValueOnce(makeFileInfo({ file_name: "ok.png" }))
      .mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValueOnce(makeFileInfo({
        file_name: "ok2.ts",
        is_image: false,
        mime_type: "text/typescript",
      }));

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    // First and third succeed, second fails
    expect(result.current.currentAttachments).toHaveLength(2);
    expect(consoleError).toHaveBeenCalledWith("Failed to get file info:", expect.any(Error));
    consoleError.mockRestore();
  });

  it("handleFileDialog handles dialog open error gracefully", async () => {
    mockOpen.mockRejectedValue(new Error("Dialog error"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(consoleError).toHaveBeenCalledWith("File dialog error:", expect.any(Error));
    expect(result.current.currentAttachments).toHaveLength(0);
    consoleError.mockRestore();
  });

  // ── dragOver state ──

  it("dragOver reflects useFileDrop state", () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );
    // useFileDrop is mocked to return isDragOver: false
    expect(result.current.dragOver).toBe(false);
  });

  // ── Preview URL generation ──

  it("handleFileDialog generates preview URL for images", async () => {
    mockOpen.mockResolvedValue("/path/photo.jpg");
    mockGetFileInfo.mockResolvedValue(makeFileInfo({
      file_name: "photo.jpg",
      mime_type: "image/jpeg",
      is_image: true,
    }));

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(result.current.currentAttachments[0].thumbnailUrl).toBe("blob:preview-url");
  });

  it("handleFileDialog skips preview URL for non-images", async () => {
    mockOpen.mockResolvedValue("/path/readme.md");
    mockGetFileInfo.mockResolvedValue(makeFileInfo({
      file_name: "readme.md",
      mime_type: "text/markdown",
      is_image: false,
    }));

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(result.current.currentAttachments[0].thumbnailUrl).toBeUndefined();
  });
});
