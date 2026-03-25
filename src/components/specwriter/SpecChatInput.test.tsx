import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecChatInput from "./SpecChatInput";
import { useSpecWriterStore } from "../../stores/specWriterStore";

// Mock hooks
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockCancelStream = vi.fn();

vi.mock("../../hooks/useSpecConversation", () => ({
  useSpecConversation: () => ({
    sendMessage: mockSendMessage,
    cancelStream: mockCancelStream,
  }),
}));

vi.mock("../../hooks/useFileDrop", () => ({
  useFileDrop: () => ({ isDragOver: false }),
}));

vi.mock("../../lib/file-utils", () => ({
  processDroppedPathsForSpec: vi.fn().mockResolvedValue([]),
}));

const PROJECT_PATH = "/tmp/project";

describe("SpecChatInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSpecWriterStore.setState({
      planningStreaming: new Map(),
    });
  });

  it("renders textarea and send button", () => {
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    expect(
      screen.getByPlaceholderText("Describe what you want to build...")
    ).toBeInTheDocument();
    expect(screen.getByTitle("Send (Cmd+Enter)")).toBeInTheDocument();
  });

  it("disables send button when input is empty", () => {
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    const sendBtn = screen.getByTitle("Send (Cmd+Enter)");
    expect(sendBtn).toBeDisabled();
  });

  it("enables send button when input has text", () => {
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    fireEvent.change(textarea, { target: { value: "Build a feature" } });
    const sendBtn = screen.getByTitle("Send (Cmd+Enter)");
    expect(sendBtn).not.toBeDisabled();
  });

  it("calls sendMessage on send button click", async () => {
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    fireEvent.change(textarea, { target: { value: "Build it" } });
    fireEvent.click(screen.getByTitle("Send (Cmd+Enter)"));

    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT_PATH, "Build it", undefined);
  });

  it("shows stop button when streaming", () => {
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT_PATH, true]]),
    });
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    expect(screen.getByTitle("Stop generation")).toBeInTheDocument();
  });

  it("calls cancelStream when stop button clicked", () => {
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT_PATH, true]]),
    });
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    fireEvent.click(screen.getByTitle("Stop generation"));
    expect(mockCancelStream).toHaveBeenCalledWith(PROJECT_PATH);
  });

  it("disables textarea when streaming", () => {
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT_PATH, true]]),
    });
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    expect(textarea).toBeDisabled();
  });

  it("shows attach file button", () => {
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    expect(screen.getByTitle("Attach file")).toBeInTheDocument();
  });

  it("renders send shortcut hint text", () => {
    render(<SpecChatInput projectPath={PROJECT_PATH} />);
    expect(screen.getByText("⌘+Enter to send")).toBeInTheDocument();
  });
});
