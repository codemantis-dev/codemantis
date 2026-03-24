import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import QuestionModal from "./QuestionModal";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";

vi.mock("../../lib/tauri-commands", () => ({
  resolveToolApproval: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/error-handler", () => ({ handleError: vi.fn() }));
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
            header: "Select a framework",
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
    expect(screen.getByText("Select a framework")).toBeInTheDocument();
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
});
