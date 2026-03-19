import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SpecMessage } from "../../types/spec-writer";
import SpecChatMessage from "./SpecChatMessage";

const baseMsg: SpecMessage = {
  id: "msg-1",
  role: "assistant",
  content: "Hello, tell me about your project.",
  message_type: "conversation",
  timestamp: new Date().toISOString(),
};

describe("SpecChatMessage", () => {
  it("renders assistant message with markdown", () => {
    render(<SpecChatMessage message={baseMsg} />);
    expect(screen.getByText(/Hello, tell me about your project/)).toBeTruthy();
  });

  it("renders user message", () => {
    const userMsg: SpecMessage = { ...baseMsg, role: "user", content: "Build a todo app" };
    render(<SpecChatMessage message={userMsg} />);
    expect(screen.getByText("Build a todo app")).toBeTruthy();
  });

  it("renders selectable options", () => {
    const msgWithOptions: SpecMessage = {
      ...baseMsg,
      parsedOptions: ["Option A", "Option B"],
    };
    const onSelect = vi.fn();
    render(<SpecChatMessage message={msgWithOptions} isLastAssistant onSelectOption={onSelect} />);
    expect(screen.getByText("Option A")).toBeTruthy();
    fireEvent.click(screen.getByText("Option A"));
    expect(onSelect).toHaveBeenCalledWith("Option A");
  });

  it("renders system message", () => {
    const sysMsg: SpecMessage = { ...baseMsg, role: "system", content: "No API key configured" };
    render(<SpecChatMessage message={sysMsg} />);
    expect(screen.getByText("No API key configured")).toBeTruthy();
  });
});
