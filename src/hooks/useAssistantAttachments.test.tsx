import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAssistantStore } from "../stores/assistantStore";
import type { Attachment } from "../types/attachment";

// ---------------------------------------------------------------------------
// Hoisted mocks — available inside vi.mock() factories
// ---------------------------------------------------------------------------
const {
  mockSaveClipboardImage,
  mockGetFileInfo,
  mockCreatePreviewUrl,
  mockProcessDroppedPaths,
  mockOpen,
  mockUseFileDrop,
} = vi.hoisted(() => {
  // Capture the onDrop callback passed to useFileDrop so tests can invoke it
  let capturedOnDrop: ((paths: string[]) => void) | null = null;

  return {
    mockSaveClipboardImage: vi.fn(),
    mockGetFileInfo: vi.fn(),
    mockCreatePreviewUrl: vi.fn(),
    mockProcessDroppedPaths: vi.fn(),
    mockOpen: vi.fn(),
    mockUseFileDrop: vi.fn((opts: { onDrop?: (paths: string[]) => void }) => {
      capturedOnDrop = opts.onDrop ?? null;
      return { isDragOver: false };
    }),
    // Helper accessor exported via the hoisted block so tests can reach it
    get _capturedOnDrop() {
      return capturedOnDrop;
    },
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("../lib/tauri-commands", () => ({
  saveClipboardImage: mockSaveClipboardImage,
  getFileInfo: mockGetFileInfo,
}));

vi.mock("../lib/file-utils", () => ({
  createPreviewUrl: mockCreatePreviewUrl,
  processDroppedPaths: mockProcessDroppedPaths,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mockOpen,
}));

vi.mock("./useFileDrop", () => ({
  useFileDrop: mockUseFileDrop,
}));

// ---------------------------------------------------------------------------
// Import the hook after mocks are in place
// ---------------------------------------------------------------------------
import { useAssistantAttachments } from "./useAssistantAttachments";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const SESSION_ID = "assistant-1";
const PROJECT_PATH = "/tmp/project";

function makeAttachmentInfo(overrides: Record<string, unknown> = {}): {
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  is_image: boolean;
} {
  return {
    file_path: "/tmp/project/.cm-attachments/test.png",
    file_name: "test.png",
    file_size: 1024,
    mime_type: "image/png",
    is_image: true,
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att-1",
    fileName: "test.png",
    filePath: "/tmp/project/.cm-attachments/test.png",
    fileSize: 1024,
    mimeType: "image/png",
    isImage: true,
    thumbnailUrl: "blob:mock-url",
    ...overrides,
  };
}

/**
 * Build a minimal ClipboardEvent-like object for handlePaste tests.
 */
function makePasteEvent(
  items: DataTransferItem[] = []
): React.ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  return {
    clipboardData: {
      items: items as unknown as DataTransferItemList,
    },
    preventDefault,
  } as unknown as React.ClipboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

function makeImageItem(): DataTransferItem {
  const blob = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    "clipboard.png",
    { type: "image/png" }
  );
  return {
    type: "image/png",
    getAsFile: () => blob,
  } as unknown as DataTransferItem;
}

function makeTextItem(): DataTransferItem {
  return {
    type: "text/plain",
    getAsFile: () => null,
  } as unknown as DataTransferItem;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useAssistantAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the assistant store to a clean state
    useAssistantStore.setState({
      projectAssistants: new Map(),
      activeAssistantId: new Map(),
      messages: new Map(),
      streaming: new Map(),
      busy: new Map(),
      sessionCost: new Map(),
      attachments: new Map(),
      cliSessionIds: new Map(),
    });
  });

  // -----------------------------------------------------------------------
  // currentAttachments
  // -----------------------------------------------------------------------

  it("returns empty attachments when no active assistant", () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: null,
        activeProjectPath: PROJECT_PATH,
      })
    );

    expect(result.current.currentAttachments).toEqual([]);
  });

  it("returns attachments from assistantStore for active assistant", () => {
    const att = makeAttachment();
    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, [att]]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    expect(result.current.currentAttachments).toEqual([att]);
  });

  // -----------------------------------------------------------------------
  // handlePaste
  // -----------------------------------------------------------------------

  it("handlePaste processes clipboard image and calls saveClipboardImage", async () => {
    const info = makeAttachmentInfo();
    mockSaveClipboardImage.mockResolvedValue(info);
    mockCreatePreviewUrl.mockResolvedValue("blob:mock-preview");

    // Initialize the attachments map for this session
    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, []]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const event = makePasteEvent([makeImageItem()]);

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockSaveClipboardImage).toHaveBeenCalledWith(
      PROJECT_PATH,
      expect.any(Array),
      expect.stringMatching(/^clipboard_\d{6}\.png$/)
    );
    expect(mockCreatePreviewUrl).toHaveBeenCalledWith(
      info.file_path,
      info.mime_type
    );

    // The store should now have one attachment
    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toHaveLength(1);
    expect(stored![0]).toMatchObject({
      fileName: "test.png",
      filePath: info.file_path,
      fileSize: 1024,
      mimeType: "image/png",
      isImage: true,
      thumbnailUrl: "blob:mock-preview",
    });
  });

  it("handlePaste ignores non-image clipboard items", async () => {
    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, []]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const event = makePasteEvent([makeTextItem()]);

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockSaveClipboardImage).not.toHaveBeenCalled();

    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toEqual([]);
  });

  it("handlePaste does nothing when no active assistant", async () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: null,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const event = makePasteEvent([makeImageItem()]);

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(mockSaveClipboardImage).not.toHaveBeenCalled();
  });

  it("handlePaste does nothing when no active project", async () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: null,
      })
    );

    const event = makePasteEvent([makeImageItem()]);

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(mockSaveClipboardImage).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // handleFileDialog
  // -----------------------------------------------------------------------

  it("handleFileDialog opens native dialog with correct filters", async () => {
    mockOpen.mockResolvedValue(null);

    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, []]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(mockOpen).toHaveBeenCalledWith({
      multiple: true,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp"],
        },
        { name: "Documents", extensions: ["pdf", "txt", "md"] },
        {
          name: "Code",
          extensions: [
            "ts",
            "tsx",
            "js",
            "jsx",
            "py",
            "rs",
            "go",
            "java",
            "rb",
          ],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });
  });

  it("handleFileDialog adds each selected file via getFileInfo", async () => {
    const info = makeAttachmentInfo();
    mockOpen.mockResolvedValue("/tmp/file.png");
    mockGetFileInfo.mockResolvedValue(info);
    mockCreatePreviewUrl.mockResolvedValue("blob:preview-url");

    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, []]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(mockGetFileInfo).toHaveBeenCalledWith("/tmp/file.png");
    expect(mockCreatePreviewUrl).toHaveBeenCalledWith(
      info.file_path,
      info.mime_type
    );

    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toHaveLength(1);
    expect(stored![0]).toMatchObject({
      fileName: "test.png",
      filePath: info.file_path,
      isImage: true,
      thumbnailUrl: "blob:preview-url",
    });
  });

  it("handleFileDialog handles multi-file selection", async () => {
    const imgInfo = makeAttachmentInfo();
    const docInfo = makeAttachmentInfo({
      file_path: "/tmp/project/.cm-attachments/readme.md",
      file_name: "readme.md",
      file_size: 256,
      mime_type: "text/markdown",
      is_image: false,
    });

    mockOpen.mockResolvedValue(["/tmp/photo.png", "/tmp/readme.md"]);
    mockGetFileInfo
      .mockResolvedValueOnce(imgInfo)
      .mockResolvedValueOnce(docInfo);
    mockCreatePreviewUrl.mockResolvedValue("blob:preview-url");

    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, []]]),
    });

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
    expect(mockGetFileInfo).toHaveBeenCalledWith("/tmp/photo.png");
    expect(mockGetFileInfo).toHaveBeenCalledWith("/tmp/readme.md");

    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toHaveLength(2);
    expect(stored![0].fileName).toBe("test.png");
    expect(stored![1].fileName).toBe("readme.md");
    // Non-image files should not get a preview URL
    expect(stored![1].thumbnailUrl).toBeUndefined();
  });

  it("handleFileDialog does nothing when dialog is cancelled", async () => {
    mockOpen.mockResolvedValue(null);

    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, []]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(mockGetFileInfo).not.toHaveBeenCalled();
    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toEqual([]);
  });

  it("handleFileDialog does nothing when no active assistant", async () => {
    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: null,
        activeProjectPath: PROJECT_PATH,
      })
    );

    await act(async () => {
      await result.current.handleFileDialog();
    });

    expect(mockOpen).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // handleFileDrop (via useFileDrop onDrop callback)
  // -----------------------------------------------------------------------

  it("handleFileDrop processes dropped paths via processDroppedPaths", async () => {
    const att = makeAttachment({ id: "att-drop-1", fileName: "dropped.png" });
    mockProcessDroppedPaths.mockResolvedValue([att]);

    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, []]]),
    });

    renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    // Extract the onDrop callback that was passed to useFileDrop
    const onDropCall = mockUseFileDrop.mock.calls[
      mockUseFileDrop.mock.calls.length - 1
    ][0];
    expect(onDropCall.onDrop).toBeDefined();

    await act(async () => {
      await onDropCall.onDrop?.(["/tmp/dropped.png"]);
    });

    expect(mockProcessDroppedPaths).toHaveBeenCalledWith(["/tmp/dropped.png"]);

    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toHaveLength(1);
    expect(stored![0].fileName).toBe("dropped.png");
  });

  // -----------------------------------------------------------------------
  // addAssistantAttachment
  // -----------------------------------------------------------------------

  it("addAssistantAttachment delegates to assistantStore.addAssistantAttachment", () => {
    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, []]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    const att = makeAttachment({ id: "att-manual" });

    act(() => {
      result.current.addAssistantAttachment(SESSION_ID, att);
    });

    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toEqual([att]);
  });

  // -----------------------------------------------------------------------
  // removeAssistantAttachment
  // -----------------------------------------------------------------------

  it("removeAssistantAttachment delegates to assistantStore", () => {
    const att1 = makeAttachment({ id: "att-a" });
    const att2 = makeAttachment({ id: "att-b", fileName: "other.png" });

    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, [att1, att2]]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    act(() => {
      result.current.removeAssistantAttachment(SESSION_ID, "att-a");
    });

    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toHaveLength(1);
    expect(stored![0].id).toBe("att-b");
  });

  // -----------------------------------------------------------------------
  // clearAssistantAttachments
  // -----------------------------------------------------------------------

  it("clearAssistantAttachments delegates to assistantStore", () => {
    const att1 = makeAttachment({ id: "att-x" });
    const att2 = makeAttachment({ id: "att-y" });

    useAssistantStore.setState({
      attachments: new Map([[SESSION_ID, [att1, att2]]]),
    });

    const { result } = renderHook(() =>
      useAssistantAttachments({
        activeAssistantId: SESSION_ID,
        activeProjectPath: PROJECT_PATH,
      })
    );

    act(() => {
      result.current.clearAssistantAttachments(SESSION_ID);
    });

    const stored = useAssistantStore.getState().attachments.get(SESSION_ID);
    expect(stored).toEqual([]);
  });
});
