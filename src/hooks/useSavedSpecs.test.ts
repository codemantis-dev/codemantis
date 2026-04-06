import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SpecDocumentInfo } from "../types/spec-writer";

const mockListSpecDocuments = vi.fn<(projectPath: string) => Promise<SpecDocumentInfo[]>>();

vi.mock("../lib/tauri-commands", () => ({
  listSpecDocuments: (...args: unknown[]) =>
    mockListSpecDocuments(...(args as [string])),
}));

import { useSavedSpecs } from "./useSavedSpecs";
import { useSpecWriterStore } from "../stores/specWriterStore";

const sampleSpecs: SpecDocumentInfo[] = [
  {
    filename: "auth-flow.md",
    title: "Authentication Flow",
    modified_at: "2026-01-15T10:30:00Z",
    size_bytes: 4096,
    path: "/project/.specs/auth-flow.md",
  },
  {
    filename: "dashboard.md",
    title: "Dashboard Redesign",
    modified_at: "2026-02-20T14:00:00Z",
    size_bytes: 8192,
    path: "/project/.specs/dashboard.md",
  },
];

describe("useSavedSpecs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store to default state
    useSpecWriterStore.setState({
      savedSpecs: new Map(),
    });
  });

  it("refreshSavedSpecs calls listSpecDocuments with project path", async () => {
    mockListSpecDocuments.mockResolvedValueOnce(sampleSpecs);

    const { result } = renderHook(() => useSavedSpecs("/my/project"));

    await act(async () => {
      result.current.refreshSavedSpecs();
      // Wait for the promise chain to settle
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(mockListSpecDocuments).toHaveBeenCalledWith("/my/project");
    expect(mockListSpecDocuments).toHaveBeenCalledTimes(1);
  });

  it("refreshSavedSpecs updates specWriterStore.savedSpecs", async () => {
    mockListSpecDocuments.mockResolvedValueOnce(sampleSpecs);

    const { result } = renderHook(() => useSavedSpecs("/my/project"));

    await act(async () => {
      result.current.refreshSavedSpecs();
      await new Promise((r) => setTimeout(r, 10));
    });

    const stored = useSpecWriterStore.getState().savedSpecs.get("/my/project");
    expect(stored).toEqual(sampleSpecs);
  });

  it("refreshSavedSpecs does nothing when no active project", async () => {
    const { result } = renderHook(() => useSavedSpecs(null));

    await act(async () => {
      result.current.refreshSavedSpecs();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(mockListSpecDocuments).not.toHaveBeenCalled();
    expect(useSpecWriterStore.getState().savedSpecs.size).toBe(0);
  });

  it("refreshSavedSpecs handles API errors gracefully", async () => {
    mockListSpecDocuments.mockRejectedValueOnce(new Error("IPC error"));

    const { result } = renderHook(() => useSavedSpecs("/my/project"));

    // Should not throw
    await act(async () => {
      result.current.refreshSavedSpecs();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(mockListSpecDocuments).toHaveBeenCalledWith("/my/project");
    // Store should remain unchanged — error was swallowed
    expect(useSpecWriterStore.getState().savedSpecs.size).toBe(0);
  });
});
