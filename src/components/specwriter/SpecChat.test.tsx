import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSpecWriterStore } from "../../stores/specWriterStore";


vi.mock("../../hooks/useSpecConversation", () => ({
  useSpecConversation: () => ({
    sendMessage: vi.fn(),
    writeSpec: vi.fn(),
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
    savedSpecs: new Map(),
  });
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
});
