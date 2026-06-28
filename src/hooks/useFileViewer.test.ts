import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockReadFileContent = vi.fn<(filePath: string) => Promise<string>>();

vi.mock("../lib/tauri-commands", () => ({
  readFileContent: (...args: unknown[]) => mockReadFileContent(...(args as [string])),
}));

const mockOpenFile = vi.fn();
const mockSetRightTab = vi.fn();

vi.mock("../stores/fileViewerStore", () => ({
  useFileViewerStore: {
    getState: () => ({
      openFile: mockOpenFile,
    }),
  },
  getLanguageFromPath: (filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      rs: "rust",
      md: "markdown",
      json: "json",
    };
    return map[ext] ?? "plaintext";
  },
}));

vi.mock("../stores/sessionStore", () => ({
  useSessionStore: {
    getState: vi.fn(),
  },
}));

vi.mock("../stores/uiStore", () => ({
  useUiStore: {
    getState: () => ({
      setRightTab: mockSetRightTab,
    }),
  },
}));

const mockShowToast = vi.fn();
vi.mock("../lib/error-handler", () => ({
  handleError: (_context: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    mockShowToast(message, "error");
  },
}));

import { useFileViewer } from "./useFileViewer";
import { useSessionStore } from "../stores/sessionStore";

describe("useFileViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSessionStore.getState).mockReturnValue({
      activeSessionId: "session-1",
      sessions: new Map([
        ["session-1", { project_path: "/test/project" }],
      ]),
    } as unknown as ReturnType<typeof useSessionStore.getState>);
  });

  it("openFile reads content and opens in fileViewerStore", async () => {
    mockReadFileContent.mockResolvedValueOnce("console.log('hello');");

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("/test/project/src/index.ts");
    });

    expect(mockReadFileContent).toHaveBeenCalledWith("/test/project/src/index.ts");
    expect(mockOpenFile).toHaveBeenCalledWith("session-1", {
      filePath: "/test/project/src/index.ts",
      fileName: "index.ts",
      language: "typescript",
      extension: "ts",
      fileSize: expect.any(Number),
      content: "console.log('hello');",
      isDiff: false,
    });
  });

  it("openFile resolves a relative path against the session project root", async () => {
    mockReadFileContent.mockResolvedValueOnce("# plan");

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("plans/foo.md");
    });

    expect(mockReadFileContent).toHaveBeenCalledWith("/test/project/plans/foo.md");
    expect(mockOpenFile).toHaveBeenCalledWith("session-1", {
      filePath: "/test/project/plans/foo.md",
      fileName: "foo.md",
      language: "markdown",
      extension: "md",
      fileSize: expect.any(Number),
      content: "# plan",
      isDiff: false,
    });
  });

  it("openFile leaves an absolute path unchanged", async () => {
    mockReadFileContent.mockResolvedValueOnce("content");

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("/elsewhere/file.ts");
    });

    expect(mockReadFileContent).toHaveBeenCalledWith("/elsewhere/file.ts");
  });

  it("openFile strips a trailing :line citation before reading (regression)", async () => {
    mockReadFileContent.mockResolvedValueOnce("{}");

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("/test/project/output/doc.json:1");
    });

    // The `:1` suffix must NOT reach the filesystem.
    expect(mockReadFileContent).toHaveBeenCalledWith("/test/project/output/doc.json");
    expect(mockOpenFile).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        filePath: "/test/project/output/doc.json",
        gotoLine: 1,
      }),
    );
  });

  it("openFile forwards the cited line from a relative path:line link", async () => {
    mockReadFileContent.mockResolvedValueOnce("code");

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("src/foo.ts:48");
    });

    expect(mockReadFileContent).toHaveBeenCalledWith("/test/project/src/foo.ts");
    expect(mockOpenFile).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ filePath: "/test/project/src/foo.ts", gotoLine: 48 }),
    );
  });

  it("openFile sets right tab to files", async () => {
    mockReadFileContent.mockResolvedValueOnce("content");

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("/test/project/src/app.ts");
    });

    expect(mockSetRightTab).toHaveBeenCalledWith("files");
  });

  it("openFile shows toast on error", async () => {
    mockReadFileContent.mockRejectedValueOnce(new Error("File not found"));

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("/test/project/missing.ts");
    });

    expect(mockShowToast).toHaveBeenCalledWith("File not found", "error");
    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("openFile does nothing if no activeSessionId", async () => {
    vi.mocked(useSessionStore.getState).mockReturnValue({
      activeSessionId: null,
    } as ReturnType<typeof useSessionStore.getState>);

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("/test/project/src/index.ts");
    });

    expect(mockReadFileContent).not.toHaveBeenCalled();
    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("openDiff opens diff in fileViewerStore", () => {
    const { result } = renderHook(() => useFileViewer());

    act(() => {
      result.current.openDiff("/test/project/src/app.ts", "old code", "new code");
    });

    expect(mockOpenFile).toHaveBeenCalledWith("session-1", {
      filePath: "/test/project/src/app.ts",
      fileName: "app.ts",
      language: "typescript",
      extension: "ts",
      fileSize: expect.any(Number),
      content: null,
      isDiff: true,
      oldContent: "old code",
      newContent: "new code",
    });
  });

  it("openDiff sets right tab to files", () => {
    const { result } = renderHook(() => useFileViewer());

    act(() => {
      result.current.openDiff("/test/project/src/app.ts", "old", "new");
    });

    expect(mockSetRightTab).toHaveBeenCalledWith("files");
  });
});
