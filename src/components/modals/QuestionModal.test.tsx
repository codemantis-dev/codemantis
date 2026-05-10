import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuestionModal from "./QuestionModal";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";

vi.mock("../../lib/tauri-commands", () => ({
  resolveToolApproval: vi.fn().mockResolvedValue(undefined),
  submitQuestionAnswer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/error-handler", () => ({ handleError: vi.fn() }));
// Radix Dialog mock: forwards onEscapeKeyDown so settling-window tests can
// exercise the actual handler logic without booting Radix's portal stack.
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({
    children,
    onEscapeKeyDown,
  }: {
    children: React.ReactNode;
    onEscapeKeyDown?: (e: { preventDefault: () => void }) => void;
  }) => (
    <div
      data-testid="dialog-content"
      onKeyDown={(e) => {
        if (e.key === "Escape" && onEscapeKeyDown) {
          onEscapeKeyDown({ preventDefault: () => e.preventDefault() });
        }
      }}
    >
      {children}
    </div>
  ),
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  Description: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <p className={className}>{children}</p>
  ),
}));

describe("QuestionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActivityStore.setState({
      sessionQuestions: new Map(),
    });
    useUiStore.setState({
      showQuestionModal: false,
    });
  });

  it("returns null when there is no pending question", () => {
    const { container } = render(<QuestionModal />);
    expect(container.innerHTML).toBe("");
  });

  it("renders text question when a simple question is pending", () => {
    useActivityStore.setState({
      sessionQuestions: new Map([
        ["s1", {
          toolUseId: "tu1",
          requestId: "r1",
          sessionId: "s1",
          question: "What is the project name?",
        }],
      ]),
    });
    useUiStore.setState({ showQuestionModal: true });
    render(<QuestionModal />);
    expect(screen.getByText("Claude has a question")).toBeInTheDocument();
    expect(screen.getByText("What is the project name?")).toBeInTheDocument();
  });

  it("renders text input for answering a text question", () => {
    useActivityStore.setState({
      sessionQuestions: new Map([
        ["s1", {
          toolUseId: "tu1",
          requestId: "r1",
          sessionId: "s1",
          question: "What framework?",
        }],
      ]),
    });
    useUiStore.setState({ showQuestionModal: true });
    render(<QuestionModal />);
    expect(screen.getByPlaceholderText("Type your answer...")).toBeInTheDocument();
  });

  it("renders option buttons for a question with options", () => {
    useActivityStore.setState({
      sessionQuestions: new Map([
        ["s1", {
          toolUseId: "tu1",
          requestId: "r1",
          sessionId: "s1",
          questions: [{
            header: "Framework",
            question: "Which framework should we use for the new project?",
            multiSelect: false,
            options: [
              { label: "React", value: "react", description: "A JS library" },
              { label: "Vue", value: "vue", description: "Progressive framework" },
            ],
          }],
        }],
      ]),
    });
    useUiStore.setState({ showQuestionModal: true });
    render(<QuestionModal />);
    expect(screen.getByText("Framework")).toBeInTheDocument();
    expect(
      screen.getByText("Which framework should we use for the new project?"),
    ).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Vue")).toBeInTheDocument();
  });

  it("shows Cancel button that can be clicked", () => {
    useActivityStore.setState({
      sessionQuestions: new Map([
        ["s1", {
          toolUseId: "tu1",
          requestId: "r1",
          sessionId: "s1",
          question: "Test question",
        }],
      ]),
      setPendingQuestion: vi.fn(),
    });
    useUiStore.setState({ showQuestionModal: true, setShowQuestionModal: vi.fn() });
    render(<QuestionModal />);
    const cancelBtn = screen.getByText("Cancel");
    expect(cancelBtn).toBeInTheDocument();
  });

  it("shows 'Write your own response' for option questions", () => {
    useActivityStore.setState({
      sessionQuestions: new Map([
        ["s1", {
          toolUseId: "tu1",
          requestId: "r1",
          sessionId: "s1",
          questions: [{
            header: "Pick one",
            question: "Which one do you prefer?",
            multiSelect: false,
            options: [
              { label: "Option A", value: "a", description: "" },
            ],
          }],
        }],
      ]),
    });
    useUiStore.setState({ showQuestionModal: true });
    render(<QuestionModal />);
    expect(screen.getByText("Write your own response...")).toBeInTheDocument();
  });

  it("ignores Escape inside the settling window", async () => {
    const { resolveToolApproval } = await import("../../lib/tauri-commands");
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    useActivityStore.setState({
      sessionQuestions: new Map([
        ["s1", {
          toolUseId: "tu1",
          requestId: "req-1",
          sessionId: "s1",
          question: "Settle?",
        }],
      ]),
    });
    useUiStore.setState({ showQuestionModal: true });
    render(<QuestionModal />);
    nowSpy.mockReturnValue(100); // still settling
    fireEvent.keyDown(screen.getByTestId("dialog-content"), { key: "Escape" });
    expect(resolveToolApproval).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("cancels on Escape after the settling window", async () => {
    const { resolveToolApproval } = await import("../../lib/tauri-commands");
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);
    useActivityStore.setState({
      sessionQuestions: new Map([
        ["s1", {
          toolUseId: "tu1",
          requestId: "req-1",
          sessionId: "s1",
          question: "Settle?",
        }],
      ]),
    });
    useUiStore.setState({ showQuestionModal: true });
    render(<QuestionModal />);
    nowSpy.mockReturnValue(500); // past settling
    fireEvent.keyDown(screen.getByTestId("dialog-content"), { key: "Escape" });
    expect(resolveToolApproval).toHaveBeenCalledWith(
      "req-1",
      false,
      "User declined to answer",
    );
    nowSpy.mockRestore();
  });

  it("delivers the answer via submitQuestionAnswer (not resolveToolApproval)", async () => {
    // Regression: CLI 2.1.126 ignores PreToolUse hook reasons for
    // AskUserQuestion (always synthesises a denial), so we must inject the
    // answer as a user message — submitQuestionAnswer does both. Asserting
    // resolveToolApproval here would be a false-green: the answer would
    // never reach Claude. See docs/internal/cli-2.1.126-protocol-report.md
    // §S09 and src-tauri/tests/captures/S09-AskUserQuestion.jsonl.
    const { resolveToolApproval, submitQuestionAnswer } = await import(
      "../../lib/tauri-commands"
    );
    const submitMock = vi.mocked(submitQuestionAnswer);
    const resolveMock = vi.mocked(resolveToolApproval);

    useActivityStore.setState({
      sessionQuestions: new Map([
        ["s1", {
          toolUseId: "tu1",
          requestId: "req-xyz",
          sessionId: "s1",
          questions: [{
            header: "Validation",
            question: "How should we handle invalid roadmaps?",
            multiSelect: false,
            options: [
              { label: "Report only", value: "report", description: "Just log" },
              { label: "Block", value: "block", description: "Block and ask" },
            ],
          }],
        }],
      ]),
    });
    useUiStore.setState({ showQuestionModal: true });
    render(<QuestionModal />);

    // Single-select submits immediately on click
    screen.getByText("Report only").click();

    await vi.waitFor(() => expect(submitMock).toHaveBeenCalled());
    const [sessionId, requestId, payload] = submitMock.mock.calls[0];
    expect(sessionId).toBe("s1");
    expect(requestId).toBe("req-xyz");
    expect(payload).toContain("How should we handle invalid roadmaps?");
    expect(payload).toContain("report");
    // The hook resolution path must NOT be the carrier for the answer.
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("text-question submit also routes through submitQuestionAnswer", async () => {
    const { submitQuestionAnswer, resolveToolApproval } = await import(
      "../../lib/tauri-commands"
    );
    const submitMock = vi.mocked(submitQuestionAnswer);
    const resolveMock = vi.mocked(resolveToolApproval);

    useActivityStore.setState({
      sessionQuestions: new Map([
        ["sess-A", {
          toolUseId: "tu-A",
          requestId: "req-A",
          sessionId: "sess-A",
          question: "What is the project name?",
        }],
      ]),
    });
    useUiStore.setState({ showQuestionModal: true });
    render(<QuestionModal />);

    const textarea = screen.getByPlaceholderText("Type your answer...") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "MyProject" } });
    screen.getByText("Submit").click();

    await vi.waitFor(() => expect(submitMock).toHaveBeenCalled());
    const [sessionId, requestId, payload] = submitMock.mock.calls[0];
    expect(sessionId).toBe("sess-A");
    expect(requestId).toBe("req-A");
    expect(payload).toContain("MyProject");
    expect(resolveMock).not.toHaveBeenCalled();
  });
});
