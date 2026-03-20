import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAssistantShortcuts } from "./useAssistantShortcuts";
import type { AssistantShortcut } from "../types/settings";

// Mock crypto.randomUUID for deterministic IDs
const mockUUID = "test-uuid-1234";
vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => mockUUID,
});

describe("useAssistantShortcuts", () => {
  const defaultParams = {
    shortcuts: [] as AssistantShortcut[],
    updateSettings: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct initial state", () => {
    const { result } = renderHook(() => useAssistantShortcuts(defaultParams));
    expect(result.current.shortcutDraft).toBeNull();
    expect(result.current.shortcutName).toBe("");
  });

  it("handleAddShortcut sets draft with the provided prompt", () => {
    const { result } = renderHook(() => useAssistantShortcuts(defaultParams));

    act(() => {
      result.current.handleAddShortcut("Explain this code");
    });

    expect(result.current.shortcutDraft).toEqual({ prompt: "Explain this code" });
    expect(result.current.shortcutName).toBe("");
  });

  it("handleAddShortcut resets shortcutName", () => {
    const { result } = renderHook(() => useAssistantShortcuts(defaultParams));

    // Set a name first
    act(() => {
      result.current.setShortcutName("Old Name");
    });
    expect(result.current.shortcutName).toBe("Old Name");

    // Adding a shortcut should reset the name
    act(() => {
      result.current.handleAddShortcut("New prompt");
    });
    expect(result.current.shortcutName).toBe("");
  });

  it("handleSaveShortcut calls updateSettings and resets state", () => {
    const { result } = renderHook(() => useAssistantShortcuts(defaultParams));

    // Set up draft and name
    act(() => {
      result.current.handleAddShortcut("Test prompt");
    });
    act(() => {
      result.current.setShortcutName("My Shortcut");
    });

    // Save
    act(() => {
      result.current.handleSaveShortcut();
    });

    expect(defaultParams.updateSettings).toHaveBeenCalledWith({
      assistantShortcuts: [
        {
          id: mockUUID,
          name: "My Shortcut",
          prompt: "Test prompt",
        },
      ],
    });

    // State should be reset
    expect(result.current.shortcutDraft).toBeNull();
    expect(result.current.shortcutName).toBe("");
  });

  it("handleSaveShortcut does nothing with empty name", () => {
    const { result } = renderHook(() => useAssistantShortcuts(defaultParams));

    act(() => {
      result.current.handleAddShortcut("Test prompt");
    });
    // Leave name empty

    act(() => {
      result.current.handleSaveShortcut();
    });

    expect(defaultParams.updateSettings).not.toHaveBeenCalled();
  });

  it("handleSaveShortcut does nothing with whitespace-only name", () => {
    const { result } = renderHook(() => useAssistantShortcuts(defaultParams));

    act(() => {
      result.current.handleAddShortcut("Test prompt");
    });
    act(() => {
      result.current.setShortcutName("   ");
    });

    act(() => {
      result.current.handleSaveShortcut();
    });

    expect(defaultParams.updateSettings).not.toHaveBeenCalled();
  });

  it("handleSaveShortcut does nothing without a draft", () => {
    const { result } = renderHook(() => useAssistantShortcuts(defaultParams));

    act(() => {
      result.current.setShortcutName("My Shortcut");
    });

    act(() => {
      result.current.handleSaveShortcut();
    });

    expect(defaultParams.updateSettings).not.toHaveBeenCalled();
  });

  it("handleSaveShortcut appends to existing shortcuts", () => {
    const existing: AssistantShortcut[] = [
      { id: "existing-1", name: "Existing", prompt: "old prompt" },
    ];
    const params = { ...defaultParams, shortcuts: existing };
    const { result } = renderHook(() => useAssistantShortcuts(params));

    act(() => {
      result.current.handleAddShortcut("New prompt");
    });
    act(() => {
      result.current.setShortcutName("New Shortcut");
    });
    act(() => {
      result.current.handleSaveShortcut();
    });

    expect(params.updateSettings).toHaveBeenCalledWith({
      assistantShortcuts: [
        { id: "existing-1", name: "Existing", prompt: "old prompt" },
        { id: mockUUID, name: "New Shortcut", prompt: "New prompt" },
      ],
    });
  });

  it("handleSaveShortcut trims the shortcut name", () => {
    const { result } = renderHook(() => useAssistantShortcuts(defaultParams));

    act(() => {
      result.current.handleAddShortcut("prompt");
    });
    act(() => {
      result.current.setShortcutName("  Trimmed Name  ");
    });
    act(() => {
      result.current.handleSaveShortcut();
    });

    expect(defaultParams.updateSettings).toHaveBeenCalledWith({
      assistantShortcuts: [
        expect.objectContaining({ name: "Trimmed Name" }),
      ],
    });
  });
});
