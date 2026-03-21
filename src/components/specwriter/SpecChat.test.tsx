import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSpecWriterStore } from "../../stores/specWriterStore";


const mockSendMessage = vi.fn();
vi.mock("../../hooks/useSpecConversation", () => ({
  useSpecConversation: () => ({
    sendMessage: mockSendMessage,
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    loadContext: vi.fn(),
  }),
}));

vi.mock("../../lib/tauri-commands", () => ({
  sendAssistantChat: vi.fn(),
  listenAssistantStream: vi.fn().mockResolvedValue(() => {}),
  listTemplates: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue(""),
}));

import SpecChat from "./SpecChat";

const PROJECT = "/tmp/test";

beforeEach(() => {
  useSpecWriterStore.setState({
    conversations: new Map(),
    uiState: new Map(),
    planningStreaming: new Map(),
    currentSpecContent: new Map(),
    currentAuditContent: new Map(),
    savedSpecs: new Map(),
  });
  vi.clearAllMocks();
});

describe("SpecChat", () => {
  it("renders empty state", () => {
    render(<SpecChat projectPath={PROJECT} />);
    expect(screen.getByText(/describe what you want to build/i)).toBeTruthy();
  });

  it("renders messages", () => {
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "new_application");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "user",
      content: "Build a dashboard",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
    });
    render(<SpecChat projectPath={PROJECT} />);
    expect(screen.getByText("Build a dashboard")).toBeTruthy();
  });

  it("calls onOptionAction before sendMessage when option is selected", () => {
    const onOptionAction = vi.fn().mockReturnValue(true);
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    // Add an assistant message with options
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "assistant",
      content: "Pick one",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
      parsedOptions: ["Option A", "Option B"],
    });
    render(<SpecChat projectPath={PROJECT} onOptionAction={onOptionAction} />);
    fireEvent.click(screen.getByText("Option A"));
    expect(onOptionAction).toHaveBeenCalledWith("Option A");
    // sendMessage should NOT have been called since onOptionAction returned true
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("falls through to sendMessage when onOptionAction returns false", () => {
    const onOptionAction = vi.fn().mockReturnValue(false);
    useSpecWriterStore.getState().initConversation(PROJECT, "gemini", "gemini-2.5-flash", "feature");
    useSpecWriterStore.getState().addMessage(PROJECT, {
      id: "msg-1",
      role: "assistant",
      content: "Pick one",
      message_type: "conversation",
      timestamp: new Date().toISOString(),
      parsedOptions: ["Regular option"],
    });
    render(<SpecChat projectPath={PROJECT} onOptionAction={onOptionAction} />);
    fireEvent.click(screen.getByText("Regular option"));
    expect(onOptionAction).toHaveBeenCalledWith("Regular option");
    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT, "Regular option");
  });
});
