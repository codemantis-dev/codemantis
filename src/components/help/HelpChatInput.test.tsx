import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import HelpChatInput from "./HelpChatInput";

describe("HelpChatInput", () => {
  const defaultProps = {
    onSend: vi.fn(),
    onStop: vi.fn(),
    disabled: false,
    isBusy: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a textarea with placeholder text", () => {
    render(<HelpChatInput {...defaultProps} />);
    expect(screen.getByPlaceholderText(/Ask a question about CodeMantis/)).toBeInTheDocument();
  });

  it("shows Send button when not busy", () => {
    render(<HelpChatInput {...defaultProps} />);
    expect(screen.getByText("Send")).toBeInTheDocument();
    expect(screen.queryByText("Stop")).not.toBeInTheDocument();
  });

  it("shows Stop button when busy", () => {
    render(<HelpChatInput {...defaultProps} isBusy={true} />);
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  it("calls onStop when Stop button is clicked", () => {
    render(<HelpChatInput {...defaultProps} isBusy={true} />);
    fireEvent.click(screen.getByText("Stop"));
    expect(defaultProps.onStop).toHaveBeenCalledOnce();
  });

  it("calls onSend with trimmed text when Send is clicked", () => {
    render(<HelpChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask a question/);
    fireEvent.change(textarea, { target: { value: "  Hello world  " } });
    fireEvent.click(screen.getByText("Send"));
    expect(defaultProps.onSend).toHaveBeenCalledWith("Hello world");
  });

  it("clears textarea after sending", () => {
    render(<HelpChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask a question/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.click(screen.getByText("Send"));
    expect(textarea.value).toBe("");
  });

  it("does not send empty messages", () => {
    render(<HelpChatInput {...defaultProps} />);
    fireEvent.click(screen.getByText("Send"));
    expect(defaultProps.onSend).not.toHaveBeenCalled();
  });

  it("does not send when disabled", () => {
    render(<HelpChatInput {...defaultProps} disabled={true} />);
    const textarea = screen.getByPlaceholderText(/Ask a question/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.click(screen.getByText("Send"));
    expect(defaultProps.onSend).not.toHaveBeenCalled();
  });

  it("disables textarea when disabled prop is true", () => {
    render(<HelpChatInput {...defaultProps} disabled={true} />);
    const textarea = screen.getByPlaceholderText(/Ask a question/) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("sends on Cmd+Enter", () => {
    render(<HelpChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask a question/);
    fireEvent.change(textarea, { target: { value: "test" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(defaultProps.onSend).toHaveBeenCalledWith("test");
  });
});
