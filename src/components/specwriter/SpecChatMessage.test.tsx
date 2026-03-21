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

  it("renders option buttons on system messages with parsedOptions", () => {
    const sysMsg: SpecMessage = {
      ...baseMsg,
      role: "system",
      content: "Generate a Verification Audit?",
      parsedOptions: ["Yes, generate audit", "Not now"],
    };
    const onSelect = vi.fn();
    render(<SpecChatMessage message={sysMsg} onSelectOption={onSelect} />);
    expect(screen.getByText("Yes, generate audit")).toBeTruthy();
    expect(screen.getByText("Not now")).toBeTruthy();
  });

  it("calls onSelectOption when system message option is clicked", () => {
    const sysMsg: SpecMessage = {
      ...baseMsg,
      role: "system",
      content: "Add to CLAUDE.md?",
      parsedOptions: ["Yes, add to CLAUDE.md", "No, skip this"],
    };
    const onSelect = vi.fn();
    render(<SpecChatMessage message={sysMsg} onSelectOption={onSelect} />);
    fireEvent.click(screen.getByText("Yes, add to CLAUDE.md"));
    expect(onSelect).toHaveBeenCalledWith("Yes, add to CLAUDE.md");
  });

  it("does not render option buttons on system messages without parsedOptions", () => {
    const sysMsg: SpecMessage = {
      ...baseMsg,
      role: "system",
      content: "Just a regular system message",
    };
    render(<SpecChatMessage message={sysMsg} />);
    expect(screen.getByText("Just a regular system message")).toBeTruthy();
    // No buttons should be rendered
    const buttons = screen.queryAllByRole("button");
    expect(buttons).toHaveLength(0);
  });

  it("renders markdown in system messages", () => {
    const sysMsg: SpecMessage = {
      ...baseMsg,
      role: "system",
      content: "**Spec saved to** `docs/specs/test.md`",
    };
    render(<SpecChatMessage message={sysMsg} />);
    expect(screen.getByText("Spec saved to")).toBeTruthy();
    expect(screen.getByText("docs/specs/test.md")).toBeTruthy();
  });
});
