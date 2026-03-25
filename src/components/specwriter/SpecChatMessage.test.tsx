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

  // ── displayContent tests ──────────────────────────────────────

  it("renders displayContent when present instead of raw content", () => {
    const msg: SpecMessage = {
      ...baseMsg,
      content: "Full content\n?> Option A\n?> Option B",
      displayContent: "Full content",
      parsedOptions: ["Option A", "Option B"],
    };
    render(<SpecChatMessage message={msg} isLastAssistant />);
    expect(screen.getByText("Full content")).toBeTruthy();
    // The raw option markers should NOT appear in rendered output
    expect(screen.queryByText("?> Option A")).toBeNull();
  });

  it("falls back to content when displayContent is absent", () => {
    const msg: SpecMessage = {
      ...baseMsg,
      content: "Regular content without displayContent",
    };
    render(<SpecChatMessage message={msg} />);
    expect(screen.getByText("Regular content without displayContent")).toBeTruthy();
  });

  // ── Multi-select answer format tests ─────────────────────────

  it("sends multi-select answers as bulleted lines (4+ options = checkbox mode)", () => {
    const msg: SpecMessage = {
      ...baseMsg,
      parsedOptions: ["Option A", "Option B", "Option C", "Option D"],
    };
    const onSelect = vi.fn();
    render(<SpecChatMessage message={msg} isLastAssistant onSelectOption={onSelect} />);
    // 4+ options = multi-select mode with checkboxes, click toggles
    fireEvent.click(screen.getByText(/Option A/));
    fireEvent.click(screen.getByText(/Option C/));
    // Click the send button
    fireEvent.click(screen.getByText(/Send 2 selected/));
    expect(onSelect).toHaveBeenCalledWith("- Option A\n- Option C");
  });

  it("sends single selection as bullet when using multi-select mode", () => {
    const msg: SpecMessage = {
      ...baseMsg,
      parsedOptions: ["Alpha", "Beta", "Gamma", "Delta"],
    };
    const onSelect = vi.fn();
    render(<SpecChatMessage message={msg} isLastAssistant onSelectOption={onSelect} />);
    // Select only one in multi-select mode
    fireEvent.click(screen.getByText(/Beta/));
    fireEvent.click(screen.getByText(/Send 1 selected/));
    expect(onSelect).toHaveBeenCalledWith("- Beta");
  });

  it("single-click on <4 options still sends raw option text (instant send)", () => {
    const msg: SpecMessage = {
      ...baseMsg,
      parsedOptions: ["Yes", "No"],
    };
    const onSelect = vi.fn();
    render(<SpecChatMessage message={msg} isLastAssistant onSelectOption={onSelect} />);
    fireEvent.click(screen.getByText("Yes"));
    // <4 options with no multi-select = instant send with raw text
    expect(onSelect).toHaveBeenCalledWith("Yes");
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

  // ── Select All / Deselect All tests ──────────────────────────

  it("shows Select All button for 4+ options (multi-select mode)", () => {
    const msg: SpecMessage = {
      ...baseMsg,
      parsedOptions: ["A", "B", "C", "D", "E"],
    };
    render(<SpecChatMessage message={msg} isLastAssistant />);
    expect(screen.getByText("Select all (5)")).toBeTruthy();
  });

  it("does NOT show Select All for <4 options", () => {
    const msg: SpecMessage = {
      ...baseMsg,
      parsedOptions: ["Yes", "No"],
    };
    render(<SpecChatMessage message={msg} isLastAssistant />);
    expect(screen.queryByText(/Select all/)).toBeNull();
  });

  it("Select All toggles all options on and off", () => {
    const msg: SpecMessage = {
      ...baseMsg,
      parsedOptions: ["A", "B", "C", "D"],
    };
    const onSelect = vi.fn();
    render(<SpecChatMessage message={msg} isLastAssistant onSelectOption={onSelect} />);

    // Click Select All
    fireEvent.click(screen.getByText("Select all (4)"));
    expect(screen.getByText(/Send 4 selected/)).toBeTruthy();

    // Now it should show Deselect all
    expect(screen.getByText("Deselect all")).toBeTruthy();

    // Click Deselect all
    fireEvent.click(screen.getByText("Deselect all"));
    expect(screen.queryByText(/Send \d+ selected/)).toBeNull();
  });
});
