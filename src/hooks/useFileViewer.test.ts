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

vi.mock("../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

import { useFileViewer } from "./useFileViewer";
import { useSessionStore } from "../stores/sessionStore";
import { showToast } from "../stores/toastStore";

describe("useFileViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSessionStore.getState).mockReturnValue({
      activeProjectPath: "/test/project",
    } as ReturnType<typeof useSessionStore.getState>);
  });

  it("openFile reads content and opens in fileViewerStore", async () => {
    mockReadFileContent.mockResolvedValueOnce("console.log('hello');");

    const { result } = renderHook(() => useFileViewer());

    await act(async () => {
      await result.current.openFile("/test/project/src/index.ts");
    });

    expect(mockReadFileContent).toHaveBeenCalledWith("/test/project/src/index.ts");
    expect(mockOpenFile).toHaveBeenCalledWith("/test/project", {
      filePath: "/test/project/src/index.ts",
      fileName: "index.ts",
      language: "typescript",
      extension: "ts",
      fileSize: expect.any(Number),
      content: "console.log('hello');",
      isDiff: false,
    });
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

    expect(showToast).toHaveBeenCalledWith("Failed to open file", "error");
    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("openFile does nothing if no activeProjectPath", async () => {
    vi.mocked(useSessionStore.getState).mockReturnValue({
      activeProjectPath: null,
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

    expect(mockOpenFile).toHaveBeenCalledWith("/test/project", {
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
