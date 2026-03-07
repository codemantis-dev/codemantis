import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InputArea from "./InputArea";
import { useSessionStore } from "../../stores/sessionStore";

describe("InputArea", () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: null,
      messages: [],
      isStreaming: false,
      streamingContent: "",
      currentMessageId: null,
    });
  });

  it("renders disabled state when no session", () => {
    render(<InputArea />);
    const textarea = screen.getByPlaceholderText("Open a project to start...");
    expect(textarea).toBeDisabled();
  });

  it("renders enabled state when session active", () => {
    useSessionStore.setState({
      session: {
        id: "s1",
        name: "Test",
        project_path: "/tmp",
        status: "connected",
        created_at: "",
        model: null,
      },
    });
    render(<InputArea />);
    const textarea = screen.getByPlaceholderText(
      /Ask Claude anything/
    );
    expect(textarea).not.toBeDisabled();
  });

  it("renders action buttons", () => {
    render(<InputArea />);
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByText("Cmd")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("send button shows disabled style with empty input", () => {
    useSessionStore.setState({
      session: {
        id: "s1",
        name: "Test",
        project_path: "/tmp",
        status: "connected",
        created_at: "",
        model: null,
      },
    });
    render(<InputArea />);
    const sendButton = screen.getByText("Send").closest("button");
    expect(sendButton).toBeDisabled();
  });
});
