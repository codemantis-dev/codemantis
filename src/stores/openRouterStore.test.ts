import { describe, it, expect, beforeEach, vi } from "vitest";
import { useOpenRouterStore } from "./openRouterStore";
import type { OpenRouterModel } from "../types/assistant-provider";

// Mock Tauri commands
vi.mock("../lib/tauri-commands", () => ({
  fetchOpenRouterModels: vi.fn(),
}));

function makeModel(overrides: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id: "test/model",
    name: "Test Model",
    isFree: false,
    inputModalities: ["text"],
    outputModalities: ["text"],
    contextLength: 4096,
    pricing: { input: 1.0, output: 2.0 },
    ...overrides,
  };
}

function resetStore(models: OpenRouterModel[] = []): void {
  useOpenRouterStore.setState({
    models,
    loading: false,
    lastFetched: null,
    error: null,
  });
}

describe("openRouterStore", () => {
  beforeEach(() => {
    resetStore();
  });

  // ── getModel ──

  it("getModel returns model by ID", () => {
    const model = makeModel({ id: "google/gemini:free", name: "Gemini Free" });
    resetStore([model]);
    expect(useOpenRouterStore.getState().getModel("google/gemini:free")).toEqual(model);
  });

  it("getModel returns undefined for unknown ID", () => {
    resetStore([makeModel({ id: "known/model" })]);
    expect(useOpenRouterStore.getState().getModel("unknown/model")).toBeUndefined();
  });

  it("getModel returns undefined when store is empty", () => {
    expect(useOpenRouterStore.getState().getModel("any")).toBeUndefined();
  });

  // ── hasModel ──

  it("hasModel returns true for existing model", () => {
    resetStore([makeModel({ id: "exists/model" })]);
    expect(useOpenRouterStore.getState().hasModel("exists/model")).toBe(true);
  });

  it("hasModel returns false for missing model", () => {
    resetStore([makeModel({ id: "other/model" })]);
    expect(useOpenRouterStore.getState().hasModel("missing")).toBe(false);
  });

  // ── getFreeModels ──

  it("getFreeModels returns only free models", () => {
    resetStore([
      makeModel({ id: "free-1", isFree: true }),
      makeModel({ id: "paid-1", isFree: false }),
      makeModel({ id: "free-2", isFree: true }),
    ]);
    const free = useOpenRouterStore.getState().getFreeModels();
    expect(free).toHaveLength(2);
    expect(free.map((m) => m.id)).toEqual(["free-1", "free-2"]);
  });

  it("getFreeModels returns empty array when no free models", () => {
    resetStore([makeModel({ isFree: false })]);
    expect(useOpenRouterStore.getState().getFreeModels()).toHaveLength(0);
  });

  // ── modelSupportsImages ──

  it("modelSupportsImages returns true for vision model", () => {
    resetStore([makeModel({ id: "vision", inputModalities: ["text", "image"] })]);
    expect(useOpenRouterStore.getState().modelSupportsImages("vision")).toBe(true);
  });

  it("modelSupportsImages returns false for text-only model", () => {
    resetStore([makeModel({ id: "text-only", inputModalities: ["text"] })]);
    expect(useOpenRouterStore.getState().modelSupportsImages("text-only")).toBe(false);
  });

  it("modelSupportsImages returns true for unknown model (permissive)", () => {
    expect(useOpenRouterStore.getState().modelSupportsImages("unknown")).toBe(true);
  });

  // ── modelSupportsFiles ──

  it("modelSupportsFiles returns true when file in modalities", () => {
    resetStore([makeModel({ id: "file-model", inputModalities: ["text", "file"] })]);
    expect(useOpenRouterStore.getState().modelSupportsFiles("file-model")).toBe(true);
  });

  it("modelSupportsFiles returns false when no file modality", () => {
    resetStore([makeModel({ id: "no-file", inputModalities: ["text", "image"] })]);
    expect(useOpenRouterStore.getState().modelSupportsFiles("no-file")).toBe(false);
  });

  // ── modelSupportsAttachments ──

  it("modelSupportsAttachments returns true for image support", () => {
    resetStore([makeModel({ id: "img", inputModalities: ["text", "image"] })]);
    expect(useOpenRouterStore.getState().modelSupportsAttachments("img")).toBe(true);
  });

  it("modelSupportsAttachments returns true for file support", () => {
    resetStore([makeModel({ id: "file", inputModalities: ["text", "file"] })]);
    expect(useOpenRouterStore.getState().modelSupportsAttachments("file")).toBe(true);
  });

  it("modelSupportsAttachments returns false for text-only", () => {
    resetStore([makeModel({ id: "text", inputModalities: ["text"] })]);
    expect(useOpenRouterStore.getState().modelSupportsAttachments("text")).toBe(false);
  });

  // ── clearModels ──

  it("clearModels resets state", () => {
    resetStore([makeModel()]);
    useOpenRouterStore.setState({ lastFetched: Date.now(), error: "some error" });
    useOpenRouterStore.getState().clearModels();
    const state = useOpenRouterStore.getState();
    expect(state.models).toEqual([]);
    expect(state.lastFetched).toBeNull();
    expect(state.error).toBeNull();
  });

  // ── fetchModels (caching behavior) ──

  it("fetchModels skips when recently fetched", async () => {
    const { fetchOpenRouterModels } = await import("../lib/tauri-commands");
    const mockFetch = vi.mocked(fetchOpenRouterModels);
    mockFetch.mockClear();

    // Set state as if just fetched
    resetStore([makeModel()]);
    useOpenRouterStore.setState({ lastFetched: Date.now() });

    await useOpenRouterStore.getState().fetchModels("test-key");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetchModels calls API when cache is expired", async () => {
    const { fetchOpenRouterModels } = await import("../lib/tauri-commands");
    const mockFetch = vi.mocked(fetchOpenRouterModels);
    mockFetch.mockClear();
    mockFetch.mockResolvedValue([
      {
        id: "test/model",
        name: "Test",
        isFree: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
        contextLength: 4096,
        pricingInput: 0,
        pricingOutput: 0,
      },
    ]);

    // Set expired cache
    useOpenRouterStore.setState({ lastFetched: Date.now() - 20 * 60 * 1000 });

    await useOpenRouterStore.getState().fetchModels("test-key");
    expect(mockFetch).toHaveBeenCalledWith("test-key");
    expect(useOpenRouterStore.getState().models).toHaveLength(1);
    expect(useOpenRouterStore.getState().models[0].id).toBe("test/model");
  });

  it("fetchModels sets error on failure", async () => {
    const { fetchOpenRouterModels } = await import("../lib/tauri-commands");
    const mockFetch = vi.mocked(fetchOpenRouterModels);
    mockFetch.mockClear();
    mockFetch.mockRejectedValue(new Error("Network error"));

    await useOpenRouterStore.getState().fetchModels("bad-key");
    const state = useOpenRouterStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toContain("Network error");
  });

  it("fetchModels does not run concurrently", async () => {
    const { fetchOpenRouterModels } = await import("../lib/tauri-commands");
    const mockFetch = vi.mocked(fetchOpenRouterModels);
    mockFetch.mockClear();

    // Simulate a slow fetch
    let resolvePromise: (value: never[]) => void;
    mockFetch.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));

    // Set loading true to simulate in-flight request
    useOpenRouterStore.setState({ loading: true });
    await useOpenRouterStore.getState().fetchModels("key");

    // Should not have been called because loading was true
    expect(mockFetch).not.toHaveBeenCalled();

    // Clean up
    resolvePromise!([]);
  });
});
