import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSettingsStore } from "../stores/settingsStore";

// Mock tauri commands
vi.mock("../lib/tauri-commands", () => ({
  sendAssistantChat: vi.fn().mockResolvedValue([0, 0]),
  listenAssistantStream: vi.fn().mockResolvedValue(() => {}),
  listTemplates: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue("Project: test"),
  readProjectFiles: vi.fn().mockResolvedValue([]),
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
  archiveTaskPlan: vi.fn().mockResolvedValue(undefined),
}));

import { useSpecConversation } from "./useSpecConversation";

const PROJECT = "/tmp/test-project";

beforeEach(() => {
  useSpecWriterStore.setState({
    conversations: new Map(),
    uiState: new Map(),
    planningStreaming: new Map(),
    currentSpecContent: new Map(),
    savedSpecs: new Map(),
    fileRequestsPending: new Map(),
  });
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      apiKeys: { gemini: "test-key" },
      taskBoardPlanningModel: "gemini-3-flash-preview",
    },
  });
});

describe("useSpecConversation", () => {
  it("initializes conversation on first message", async () => {
    const { result } = renderHook(() => useSpecConversation());

    await act(async () => {
      await result.current.sendMessage(PROJECT, "I want to build an app");
    });

    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv).toBeDefined();
    expect(conv!.mode).toBe("feature");
    expect(conv!.messages.length).toBeGreaterThan(0);
    expect(conv!.messages[0].role).toBe("user");
  });

  it("writeSpec sends a trigger message", async () => {
    const { result } = renderHook(() => useSpecConversation());

    // Init conversation first
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");

    await act(async () => {
      result.current.writeSpec(PROJECT);
    });

    const conv = useSpecWriterStore.getState().conversations.get(PROJECT);
    expect(conv!.status).toBe("writing");
  });
});
