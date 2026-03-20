import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProviderMenu } from "./useProviderMenu";

describe("useProviderMenu", () => {
  const defaultParams = {
    activeProjectPath: "/project",
    activeSessionId: "session-1",
    creating: false,
    setCreating: vi.fn(),
    apiKeys: { openai: "sk-test", gemini: "", anthropic: "ak-test" } as Record<string, string>,
    defaultModels: {} as Record<string, string>,
    createAssistant: vi.fn(() => Promise.resolve("new-id")),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useProviderMenu(defaultParams));
    expect(result.current.showProviderMenu).toBe(false);
    expect(result.current.expandedProvider).toBeNull();
  });

  it("toggles showProviderMenu", () => {
    const { result } = renderHook(() => useProviderMenu(defaultParams));

    act(() => {
      result.current.setShowProviderMenu(true);
    });
    expect(result.current.showProviderMenu).toBe(true);

    act(() => {
      result.current.setShowProviderMenu(false);
    });
    expect(result.current.showProviderMenu).toBe(false);
  });

  it("sets expandedProvider", () => {
    const { result } = renderHook(() => useProviderMenu(defaultParams));

    act(() => {
      result.current.setExpandedProvider("openai");
    });
    expect(result.current.expandedProvider).toBe("openai");

    act(() => {
      result.current.setExpandedProvider(null);
    });
    expect(result.current.expandedProvider).toBeNull();
  });

  it("handleCreate calls createAssistant with correct args for claude-code", async () => {
    const { result } = renderHook(() => useProviderMenu(defaultParams));

    await act(async () => {
      await result.current.handleCreate("claude-code");
    });

    expect(defaultParams.createAssistant).toHaveBeenCalledWith(
      "/project",
      "session-1",
      "claude-code",
      undefined,
    );
    expect(defaultParams.setCreating).toHaveBeenCalledWith(true);
    expect(defaultParams.setCreating).toHaveBeenCalledWith(false);
  });

  it("handleCreate calls createAssistant with specified model", async () => {
    const { result } = renderHook(() => useProviderMenu(defaultParams));

    await act(async () => {
      await result.current.handleCreate("openai", "gpt-4.1");
    });

    expect(defaultParams.createAssistant).toHaveBeenCalledWith(
      "/project",
      "session-1",
      "openai",
      "gpt-4.1",
    );
  });

  it("handleCreate does nothing when API key is missing for non-claude-code provider", async () => {
    const params = {
      ...defaultParams,
      apiKeys: { openai: "", gemini: "", anthropic: "" },
    };
    const { result } = renderHook(() => useProviderMenu(params));

    await act(async () => {
      await result.current.handleCreate("openai");
    });

    expect(params.createAssistant).not.toHaveBeenCalled();
    expect(params.setCreating).not.toHaveBeenCalled();
  });

  it("handleCreate does nothing when activeProjectPath is null", async () => {
    const params = { ...defaultParams, activeProjectPath: null };
    const { result } = renderHook(() => useProviderMenu(params));

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(params.createAssistant).not.toHaveBeenCalled();
  });

  it("handleCreate does nothing when already creating", async () => {
    const params = { ...defaultParams, creating: true };
    const { result } = renderHook(() => useProviderMenu(params));

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(params.createAssistant).not.toHaveBeenCalled();
  });

  it("handleCreate closes provider menu on create", async () => {
    const { result } = renderHook(() => useProviderMenu(defaultParams));

    act(() => {
      result.current.setShowProviderMenu(true);
    });
    expect(result.current.showProviderMenu).toBe(true);

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(result.current.showProviderMenu).toBe(false);
  });

  it("handleCreate resets creating state even on error", async () => {
    const params = {
      ...defaultParams,
      createAssistant: vi.fn(() => Promise.reject(new Error("fail"))),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useProviderMenu(params));

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(params.setCreating).toHaveBeenCalledWith(true);
    expect(params.setCreating).toHaveBeenCalledWith(false);
  });
});
