import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatPanel from "./ChatPanel";
import { useSessionStore } from "../../stores/sessionStore";

describe("ChatPanel", () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: null,
      messages: [],
      isStreaming: false,
      streamingContent: "",
      currentMessageId: null,
    });
  });

  it("shows welcome text when no session", () => {
    render(<ChatPanel />);
    expect(screen.getByText("Welcome to ClaudeForge")).toBeInTheDocument();
    expect(
      screen.getByText("Open a project to start a session")
    ).toBeInTheDocument();
  });

  it("shows empty state prompt when session exists but no messages", () => {
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
    render(<ChatPanel />);
    expect(
      screen.getByText("Send a message to start the conversation")
    ).toBeInTheDocument();
  });

  it("renders user messages", () => {
    useSessionStore.setState({
      session: {
        id: "s1",
        name: "Test",
        project_path: "/tmp",
        status: "connected",
        created_at: "",
        model: null,
      },
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Hello Claude",
          timestamp: "2026-01-01T00:00:00Z",
          activityIds: [],
          isStreaming: false,
        },
      ],
    });
    render(<ChatPanel />);
    expect(screen.getByText("Hello Claude")).toBeInTheDocument();
  });

  it("renders assistant messages with markdown", () => {
    useSessionStore.setState({
      session: {
        id: "s1",
        name: "Test",
        project_path: "/tmp",
        status: "connected",
        created_at: "",
        model: null,
      },
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "This is **bold** text",
          timestamp: "",
          activityIds: [],
          isStreaming: false,
        },
      ],
    });
    render(<ChatPanel />);
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("renders multiple messages in order", () => {
    useSessionStore.setState({
      session: {
        id: "s1",
        name: "Test",
        project_path: "/tmp",
        status: "connected",
        created_at: "",
        model: null,
      },
      messages: [
        {
          id: "m1",
          role: "user",
          content: "First message",
          timestamp: "",
          activityIds: [],
          isStreaming: false,
        },
        {
          id: "m2",
          role: "assistant",
          content: "Second message",
          timestamp: "",
          activityIds: [],
          isStreaming: false,
        },
        {
          id: "m3",
          role: "user",
          content: "Third message",
          timestamp: "",
          activityIds: [],
          isStreaming: false,
        },
      ],
    });
    render(<ChatPanel />);
    expect(screen.getByText("First message")).toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
    expect(screen.getByText("Third message")).toBeInTheDocument();
  });
});
