import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecChatInput from "./SpecChatInput";
import { useSpecWriterStore } from "../../stores/specWriterStore";

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockCancelStream = vi.fn();

vi.mock("../../hooks/useFileDrop", () => ({
  useFileDrop: () => ({ isDragOver: false }),
}));

vi.mock("../../lib/file-utils", () => ({
  processDroppedPathsForSpec: vi.fn().mockResolvedValue([]),
}));

const PROJECT_PATH = "/tmp/project";

function renderInput(overrides?: Partial<React.ComponentProps<typeof SpecChatInput>>) {
  return render(
    <SpecChatInput
      projectPath={PROJECT_PATH}
      sendMessage={mockSendMessage}
      cancelStream={mockCancelStream}
      {...overrides}
    />
  );
}

describe("SpecChatInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSpecWriterStore.setState({
      planningStreaming: new Map(),
      draftText: new Map(),
      draftAttachments: new Map(),
    });
  });

  it("renders textarea and send button", () => {
    renderInput();
    expect(
      screen.getByPlaceholderText("Describe what you want to build...")
    ).toBeInTheDocument();
    expect(screen.getByTitle("Send (Enter)")).toBeInTheDocument();
  });

  it("disables send button when input is empty", () => {
    renderInput();
    const sendBtn = screen.getByTitle("Send (Enter)");
    expect(sendBtn).toBeDisabled();
  });

  it("enables send button when input has text", () => {
    renderInput();
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    fireEvent.change(textarea, { target: { value: "Build a feature" } });
    const sendBtn = screen.getByTitle("Send (Enter)");
    expect(sendBtn).not.toBeDisabled();
  });

  it("calls sendMessage on send button click", async () => {
    renderInput();
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    fireEvent.change(textarea, { target: { value: "Build it" } });
    fireEvent.click(screen.getByTitle("Send (Enter)"));

    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT_PATH, "Build it", undefined);
  });

  it("shows stop button when streaming", () => {
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT_PATH, true]]),
    });
    renderInput();
    expect(screen.getByTitle("Stop generation (Esc)")).toBeInTheDocument();
  });

  it("calls cancelStream when stop button clicked", () => {
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT_PATH, true]]),
    });
    renderInput();
    fireEvent.click(screen.getByTitle("Stop generation (Esc)"));
    expect(mockCancelStream).toHaveBeenCalledWith(PROJECT_PATH);
  });

  it("disables textarea when streaming", () => {
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT_PATH, true]]),
    });
    renderInput();
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    expect(textarea).toBeDisabled();
  });

  it("shows attach file button", () => {
    renderInput();
    expect(screen.getByTitle("Attach file")).toBeInTheDocument();
  });

  it("renders send shortcut hint text", () => {
    renderInput();
    expect(screen.getByText("Enter to send")).toBeInTheDocument();
  });

  it("persists draft text in store across re-renders", () => {
    renderInput();
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    fireEvent.change(textarea, { target: { value: "My draft" } });
    expect(useSpecWriterStore.getState().draftText.get(PROJECT_PATH)).toBe("My draft");
  });

  it("restores draft text from store on mount", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT_PATH, "Restored draft");
    renderInput();
    const textarea = screen.getByPlaceholderText("Describe what you want to build...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Restored draft");
  });

  it("clears draft after sending", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT_PATH, "To send");
    renderInput();
    fireEvent.click(screen.getByTitle("Send (Enter)"));
    expect(useSpecWriterStore.getState().draftText.has(PROJECT_PATH)).toBe(false);
  });

  // ── Draft attachments ──────────────────────────────────────

  it("renders attachment chips from store", () => {
    useSpecWriterStore.getState().setDraftAttachments(PROJECT_PATH, [
      { id: "a1", type: "image", name: "screenshot.png", size: 1000, mime_type: "image/png", preview_url: "data:image/png;base64,abc", file_path: "" },
      { id: "a2", type: "document", name: "notes.md", size: 500, mime_type: "text/markdown", file_path: "" },
    ]);
    renderInput();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });

  it("clears both text and attachments after sending", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT_PATH, "With file");
    useSpecWriterStore.getState().setDraftAttachments(PROJECT_PATH, [
      { id: "a1", type: "document", name: "readme.md", size: 100, mime_type: "text/markdown", file_path: "" },
    ]);
    renderInput();
    fireEvent.click(screen.getByTitle("Send (Enter)"));
    expect(useSpecWriterStore.getState().draftText.has(PROJECT_PATH)).toBe(false);
    expect(useSpecWriterStore.getState().draftAttachments.has(PROJECT_PATH)).toBe(false);
  });

  it("sends with attachments passed to sendMessage", () => {
    const att = { id: "a1", type: "document" as const, name: "readme.md", size: 100, mime_type: "text/markdown", file_path: "" };
    useSpecWriterStore.getState().setDraftText(PROJECT_PATH, "Read this");
    useSpecWriterStore.getState().setDraftAttachments(PROJECT_PATH, [att]);
    renderInput();
    fireEvent.click(screen.getByTitle("Send (Enter)"));
    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT_PATH, "Read this", [att]);
  });

  it("enables send button when only attachments exist (no text)", () => {
    useSpecWriterStore.getState().setDraftAttachments(PROJECT_PATH, [
      { id: "a1", type: "image", name: "img.png", size: 100, mime_type: "image/png", preview_url: "data:...", file_path: "" },
    ]);
    renderInput();
    const sendBtn = screen.getByTitle("Send (Enter)");
    expect(sendBtn).not.toBeDisabled();
  });

  it("sends with only attachments (no text)", () => {
    const att = { id: "a1", type: "document" as const, name: "file.txt", size: 50, mime_type: "text/plain", file_path: "" };
    useSpecWriterStore.getState().setDraftAttachments(PROJECT_PATH, [att]);
    renderInput();
    fireEvent.click(screen.getByTitle("Send (Enter)"));
    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT_PATH, "", [att]);
  });

  it("does not send when streaming", () => {
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT_PATH, true]]),
      draftText: new Map([[PROJECT_PATH, "Some text"]]),
    });
    renderInput();
    // There's no send button when streaming — stop button is shown instead
    expect(screen.queryByTitle("Send (Enter)")).not.toBeInTheDocument();
    expect(screen.getByTitle("Stop generation (Esc)")).toBeInTheDocument();
  });

  it("removes attachment via × button and updates store", () => {
    useSpecWriterStore.getState().setDraftAttachments(PROJECT_PATH, [
      { id: "a1", type: "document", name: "keep.md", size: 100, mime_type: "text/markdown", file_path: "" },
      { id: "a2", type: "document", name: "remove.md", size: 200, mime_type: "text/markdown", file_path: "" },
    ]);
    renderInput();
    // Click the × button for the second attachment
    const removeButtons = screen.getAllByText("×");
    fireEvent.click(removeButtons[1]);
    const remaining = useSpecWriterStore.getState().draftAttachments.get(PROJECT_PATH);
    expect(remaining).toHaveLength(1);
    expect(remaining![0].name).toBe("keep.md");
  });

  it("cancels stream via Escape key during streaming", () => {
    useSpecWriterStore.setState({
      planningStreaming: new Map([[PROJECT_PATH, true]]),
    });
    renderInput();
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(mockCancelStream).toHaveBeenCalledWith(PROJECT_PATH);
  });

  it("sends via Enter key shortcut", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT_PATH, "keyboard send");
    renderInput();
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mockSendMessage).toHaveBeenCalledWith(PROJECT_PATH, "keyboard send", undefined);
  });

  it("does not send via Enter when text is whitespace only", () => {
    useSpecWriterStore.getState().setDraftText(PROJECT_PATH, "   ");
    renderInput();
    const textarea = screen.getByPlaceholderText("Describe what you want to build...");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
