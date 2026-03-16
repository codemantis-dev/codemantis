import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { FileNode } from "../types/file-tree";

const mockReadFileTree = vi.fn<(rootPath: string) => Promise<FileNode[]>>();

vi.mock("../lib/tauri-commands", () => ({
  readFileTree: (...args: unknown[]) => mockReadFileTree(...(args as [string])),
}));

import { useFileTree } from "./useFileTree";

describe("useFileTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct initial state: files=[], loading=false, error=null", () => {
    const { result } = renderHook(() => useFileTree());

    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("refresh sets loading then resolves with files", async () => {
    const fakeFiles: FileNode[] = [
      { name: "src", path: "/project/src", is_dir: true, children: [] },
      { name: "README.md", path: "/project/README.md", is_dir: false, children: [] },
    ];
    mockReadFileTree.mockResolvedValueOnce(fakeFiles);

    const { result } = renderHook(() => useFileTree());

    await act(async () => {
      await result.current.refresh("/project");
    });

    expect(result.current.files).toEqual(fakeFiles);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockReadFileTree).toHaveBeenCalledWith("/project");
  });

  it("refresh sets error string on failure", async () => {
    mockReadFileTree.mockRejectedValueOnce(new Error("Permission denied"));

    const { result } = renderHook(() => useFileTree());

    await act(async () => {
      await result.current.refresh("/restricted");
    });

    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Permission denied");
  });

  it("multiple refreshes work and state resets between calls", async () => {
    const firstFiles: FileNode[] = [
      { name: "a.ts", path: "/project/a.ts", is_dir: false, children: [] },
    ];
    const secondFiles: FileNode[] = [
      { name: "b.ts", path: "/project/b.ts", is_dir: false, children: [] },
      { name: "c.ts", path: "/project/c.ts", is_dir: false, children: [] },
    ];

    mockReadFileTree.mockResolvedValueOnce(firstFiles);

    const { result } = renderHook(() => useFileTree());

    await act(async () => {
      await result.current.refresh("/project");
    });

    expect(result.current.files).toEqual(firstFiles);
    expect(result.current.error).toBeNull();

    mockReadFileTree.mockResolvedValueOnce(secondFiles);

    await act(async () => {
      await result.current.refresh("/project");
    });

    expect(result.current.files).toEqual(secondFiles);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
