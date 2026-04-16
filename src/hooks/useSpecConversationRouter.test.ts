import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpecWriterStore } from "../stores/specWriterStore";

// Mock both underlying hooks
const mockApiSendMessage = vi.fn();
const mockApiWriteSpec = vi.fn();
const mockApiGenerateAudit = vi.fn();
const mockApiLoadContext = vi.fn();
const mockApiCancelStream = vi.fn();

const mockCliSendMessage = vi.fn();
const mockCliWriteSpec = vi.fn();
const mockCliGenerateAudit = vi.fn();
const mockCliLoadContext = vi.fn();
const mockCliCancelStream = vi.fn();
const mockCliChangeModel = vi.fn();

vi.mock("./useSpecConversation", () => ({
  useSpecConversation: () => ({
    sendMessage: mockApiSendMessage,
    writeSpec: mockApiWriteSpec,
    generateAudit: mockApiGenerateAudit,
    loadContext: mockApiLoadContext,
    cancelStream: mockApiCancelStream,
  }),
}));

vi.mock("./useSpecConversationClaude", () => ({
  useSpecConversationClaude: () => ({
    sendMessage: mockCliSendMessage,
    writeSpec: mockCliWriteSpec,
    generateAudit: mockCliGenerateAudit,
    loadContext: mockCliLoadContext,
    cancelStream: mockCliCancelStream,
    changeModel: mockCliChangeModel,
  }),
}));

vi.mock("../lib/tauri-commands", () => ({
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
  closeSpecwriterSession: vi.fn().mockResolvedValue(undefined),
}));

import { useSpecConversationRouter } from "./useSpecConversationRouter";

const PROJECT = "/tmp/test";

beforeEach(() => {
  useSpecWriterStore.setState({
    conversations: new Map(),
    uiState: new Map(),
    planningStreaming: new Map(),
    currentSpecContent: new Map(),
    currentAuditContent: new Map(),
    savedSpecs: new Map(),
    cliSessionIds: new Map(),
  });
  vi.clearAllMocks();
});

describe("useSpecConversationRouter", () => {
  describe("sendMessage routing", () => {
    it("routes to API hook when provider is gemini", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hello");
      });

      expect(mockApiSendMessage).toHaveBeenCalledWith(PROJECT, "Hello", undefined);
      expect(mockCliSendMessage).not.toHaveBeenCalled();
    });

    it("routes to API hook when provider is openai", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "openai", "gpt-5.4", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Test");
      });

      expect(mockApiSendMessage).toHaveBeenCalledWith(PROJECT, "Test", undefined);
      expect(mockCliSendMessage).not.toHaveBeenCalled();
    });

    it("routes to API hook when provider is anthropic", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "anthropic", "claude-sonnet-4-6", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hi");
      });

      expect(mockApiSendMessage).toHaveBeenCalledWith(PROJECT, "Hi", undefined);
      expect(mockCliSendMessage).not.toHaveBeenCalled();
    });

    it("routes to CLI hook when provider is claude-code", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hello");
      });

      expect(mockCliSendMessage).toHaveBeenCalledWith(PROJECT, "Hello", undefined);
      expect(mockApiSendMessage).not.toHaveBeenCalled();
    });

    it("passes attachments through to the correct hook", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());
      const attachments = [{ id: "a1", type: "image" as const, name: "img.png", size: 100, mime_type: "image/png", file_path: "/tmp/img.png" }];

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Look at this", attachments);
      });

      expect(mockCliSendMessage).toHaveBeenCalledWith(PROJECT, "Look at this", attachments);
    });

    it("routes to API when no conversation exists", async () => {
      // No conversation initialized — isClaudeCode returns false
      const { result } = renderHook(() => useSpecConversationRouter());

      await act(async () => {
        await result.current.sendMessage(PROJECT, "Hello");
      });

      expect(mockApiSendMessage).toHaveBeenCalled();
      expect(mockCliSendMessage).not.toHaveBeenCalled();
    });
  });

  describe("writeSpec routing", () => {
    it("routes to API hook for API provider", () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      act(() => {
        result.current.writeSpec(PROJECT);
      });

      expect(mockApiWriteSpec).toHaveBeenCalledWith(PROJECT);
      expect(mockCliWriteSpec).not.toHaveBeenCalled();
    });

    it("routes to CLI hook for claude-code provider", () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      act(() => {
        result.current.writeSpec(PROJECT);
      });

      expect(mockCliWriteSpec).toHaveBeenCalledWith(PROJECT);
      expect(mockApiWriteSpec).not.toHaveBeenCalled();
    });
  });

  describe("generateAudit routing", () => {
    it("routes to API hook for API provider", () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "openai", "gpt-5.4", "new_application");
      const { result } = renderHook(() => useSpecConversationRouter());

      act(() => {
        result.current.generateAudit(PROJECT);
      });

      expect(mockApiGenerateAudit).toHaveBeenCalledWith(PROJECT);
      expect(mockCliGenerateAudit).not.toHaveBeenCalled();
    });

    it("routes to CLI hook for claude-code provider", () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-opus-4-7", "new_application");
      const { result } = renderHook(() => useSpecConversationRouter());

      act(() => {
        result.current.generateAudit(PROJECT);
      });

      expect(mockCliGenerateAudit).toHaveBeenCalledWith(PROJECT);
      expect(mockApiGenerateAudit).not.toHaveBeenCalled();
    });
  });

  describe("loadContext routing", () => {
    it("routes to API hook for API provider", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      await act(async () => {
        await result.current.loadContext(PROJECT);
      });

      expect(mockApiLoadContext).toHaveBeenCalledWith(PROJECT);
      expect(mockCliLoadContext).not.toHaveBeenCalled();
    });

    it("routes to CLI hook for claude-code provider", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      await act(async () => {
        await result.current.loadContext(PROJECT);
      });

      expect(mockCliLoadContext).toHaveBeenCalledWith(PROJECT);
      expect(mockApiLoadContext).not.toHaveBeenCalled();
    });
  });

  describe("cancelStream routing", () => {
    it("routes to API hook for API provider", () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "anthropic", "claude-sonnet-4-6", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      act(() => {
        result.current.cancelStream(PROJECT);
      });

      expect(mockApiCancelStream).toHaveBeenCalledWith(PROJECT);
      expect(mockCliCancelStream).not.toHaveBeenCalled();
    });

    it("routes to CLI hook for claude-code provider", () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      act(() => {
        result.current.cancelStream(PROJECT);
      });

      expect(mockCliCancelStream).toHaveBeenCalledWith(PROJECT);
      expect(mockApiCancelStream).not.toHaveBeenCalled();
    });
  });

  describe("provider switching", () => {
    it("routes correctly after provider changes from API to claude-code", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      // First call goes to API
      await act(async () => {
        await result.current.sendMessage(PROJECT, "First");
      });
      expect(mockApiSendMessage).toHaveBeenCalledTimes(1);

      // Switch provider
      useSpecWriterStore.getState().updateConversationProvider(PROJECT, "claude-code", "claude-sonnet-4-6");

      // Second call goes to CLI
      await act(async () => {
        await result.current.sendMessage(PROJECT, "Second");
      });
      expect(mockCliSendMessage).toHaveBeenCalledTimes(1);
    });

    it("routes correctly after provider changes from claude-code to API", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT, "claude-code", "claude-sonnet-4-6", "feature");
      const { result } = renderHook(() => useSpecConversationRouter());

      // First call goes to CLI
      await act(async () => {
        await result.current.sendMessage(PROJECT, "First");
      });
      expect(mockCliSendMessage).toHaveBeenCalledTimes(1);

      // Switch provider
      useSpecWriterStore.getState().updateConversationProvider(PROJECT, "openai", "gpt-5.4");

      // Second call goes to API
      await act(async () => {
        await result.current.sendMessage(PROJECT, "Second");
      });
      expect(mockApiSendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("multi-project isolation", () => {
    const PROJECT_A = "/tmp/project-a";
    const PROJECT_B = "/tmp/project-b";

    it("routes to different hooks per project", async () => {
      useSpecWriterStore.getState().initConversation(PROJECT_A, "claude-code", "claude-sonnet-4-6", "feature");
      useSpecWriterStore.getState().initConversation(PROJECT_B, "gemini", "gemini-2.5-flash", "feature");

      const { result } = renderHook(() => useSpecConversationRouter());

      await act(async () => {
        await result.current.sendMessage(PROJECT_A, "From A");
      });
      expect(mockCliSendMessage).toHaveBeenCalledWith(PROJECT_A, "From A", undefined);

      await act(async () => {
        await result.current.sendMessage(PROJECT_B, "From B");
      });
      expect(mockApiSendMessage).toHaveBeenCalledWith(PROJECT_B, "From B", undefined);
    });
  });
});
