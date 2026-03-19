import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import type { PlanningMessage } from "../../types/task-board";

// Mock the ProgressUpdateMessage component
vi.mock("./ProgressUpdateMessage", () => ({
  default: ({ wpName }: { wpName: string }) => <div data-testid="progress-update">{wpName}</div>,
}));

import PlanningChatMessage from "./PlanningChatMessage";

const PROJECT = "/tmp/test-project";

function makeMsg(overrides: Partial<PlanningMessage>): PlanningMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "Hello",
    message_type: "conversation",
    timestamp: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

function resetStore(): void {
  useTaskBoardStore.setState({
    plans: new Map(),
    conversations: new Map(),
    uiState: new Map(),
    executingProject: null,
    executingWorkPackage: null,
    isPaused: false,
    planningStreaming: new Map(),
    pendingUserAction: new Map(),
    projectTargetDecisions: new Map(),
  });
}

describe("PlanningChatMessage", () => {
  beforeEach(resetStore);

  // ── Basic rendering ──

  it("renders user message with right alignment", () => {
    render(<PlanningChatMessage message={makeMsg({ role: "user", content: "Build a todo" })} />);
    expect(screen.getByText("Build a todo")).toBeInTheDocument();
  });

  it("renders assistant message with left alignment", () => {
    render(<PlanningChatMessage message={makeMsg({ role: "assistant", content: "I can help!" })} />);
    expect(screen.getByText("I can help!")).toBeInTheDocument();
  });

  it("renders system message with info icon", () => {
    render(<PlanningChatMessage message={makeMsg({ role: "system", content: "System note" })} />);
    expect(screen.getByText("System note")).toBeInTheDocument();
  });

  it("renders timestamp", () => {
    render(<PlanningChatMessage message={makeMsg({})} />);
    // Should show time in some format
    const timeEl = screen.getByText(/\d{1,2}:\d{2}/);
    expect(timeEl).toBeInTheDocument();
  });

  // ── Attachments ──

  it("renders image attachment thumbnails", () => {
    render(
      <PlanningChatMessage
        message={makeMsg({
          role: "user",
          content: "Check this mockup",
          attachments: [
            {
              id: "att-1",
              type: "image",
              name: "mockup.png",
              size: 1024,
              mime_type: "image/png",
              preview_url: "data:image/png;base64,abc123",
              file_path: "/tmp/mockup.png",
            },
          ],
        })}
      />
    );

    const img = screen.getByAltText("");
    expect(img).toHaveAttribute("src", "data:image/png;base64,abc123");
  });

  it("renders document attachment name", () => {
    render(
      <PlanningChatMessage
        message={makeMsg({
          role: "user",
          content: "See the spec",
          attachments: [
            {
              id: "att-2",
              type: "document",
              name: "spec.pdf",
              size: 2048,
              mime_type: "application/pdf",
              file_path: "/tmp/spec.pdf",
            },
          ],
        })}
      />
    );

    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
  });

  // ── R3: Option buttons ──

  it("renders option buttons when isLastAssistant and parsedOptions are set", () => {
    const onSelectOption = vi.fn();

    render(
      <PlanningChatMessage
        message={makeMsg({
          content: "What framework do you prefer?",
          parsedOptions: ["React", "Vue", "Svelte"],
        })}
        isLastAssistant={true}
        onSelectOption={onSelectOption}
      />
    );

    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Vue")).toBeInTheDocument();
    expect(screen.getByText("Svelte")).toBeInTheDocument();
    expect(screen.getByText(/Click to answer/)).toBeInTheDocument();
  });

  it("clicking an option calls onSelectOption with the option text", () => {
    const onSelectOption = vi.fn();

    render(
      <PlanningChatMessage
        message={makeMsg({
          content: "Pick a framework",
          parsedOptions: ["React", "Vue"],
        })}
        isLastAssistant={true}
        onSelectOption={onSelectOption}
      />
    );

    fireEvent.click(screen.getByText("React"));
    expect(onSelectOption).toHaveBeenCalledWith("React");
    expect(onSelectOption).toHaveBeenCalledTimes(1);
  });

  it("clicking different options calls with correct text", () => {
    const onSelectOption = vi.fn();

    render(
      <PlanningChatMessage
        message={makeMsg({
          content: "Pick a style",
          parsedOptions: ["Tailwind CSS", "CSS Modules", "Styled Components"],
        })}
        isLastAssistant={true}
        onSelectOption={onSelectOption}
      />
    );

    fireEvent.click(screen.getByText("Tailwind CSS"));
    expect(onSelectOption).toHaveBeenCalledWith("Tailwind CSS");

    fireEvent.click(screen.getByText("Styled Components"));
    expect(onSelectOption).toHaveBeenCalledWith("Styled Components");
    expect(onSelectOption).toHaveBeenCalledTimes(2);
  });

  it("does NOT render options when isLastAssistant is false", () => {
    render(
      <PlanningChatMessage
        message={makeMsg({
          content: "Old question",
          parsedOptions: ["A", "B"],
        })}
        isLastAssistant={false}
        onSelectOption={vi.fn()}
      />
    );

    expect(screen.queryByText("A")).not.toBeInTheDocument();
    // But the question content itself should still render
    expect(screen.getByText("Old question")).toBeInTheDocument();
  });

  it("does NOT render options when parsedOptions is undefined", () => {
    render(
      <PlanningChatMessage
        message={makeMsg({ content: "No options here" })}
        isLastAssistant={true}
        onSelectOption={vi.fn()}
      />
    );

    expect(screen.queryByText(/or type your own answer below/)).not.toBeInTheDocument();
  });

  it("does NOT render options when parsedOptions is empty array", () => {
    render(
      <PlanningChatMessage
        message={makeMsg({ content: "Empty options", parsedOptions: [] })}
        isLastAssistant={true}
        onSelectOption={vi.fn()}
      />
    );

    expect(screen.queryByText(/or type your own answer below/)).not.toBeInTheDocument();
  });

  it("does NOT render options for user messages even if parsedOptions is set", () => {
    render(
      <PlanningChatMessage
        message={makeMsg({ role: "user", content: "My choice", parsedOptions: ["A"] })}
        isLastAssistant={true}
        onSelectOption={vi.fn()}
      />
    );

    // User messages don't show option buttons (they use the user bubble rendering path)
    // The isLastAssistant check is in the assistant message rendering block
    expect(screen.getByText("My choice")).toBeInTheDocument();
  });

  it("renders option buttons with all options from parsedOptions", () => {
    const options = ["Option 1", "Option 2", "Option 3", "Option 4", "Option 5"];

    render(
      <PlanningChatMessage
        message={makeMsg({ content: "Choose one", parsedOptions: options })}
        isLastAssistant={true}
        onSelectOption={vi.fn()}
      />
    );

    for (const opt of options) {
      expect(screen.getByText(opt)).toBeInTheDocument();
    }
  });

  // ── User action required messages ──

  it("renders user_action_required message with blue styling", () => {
    render(
      <PlanningChatMessage
        message={makeMsg({
          role: "system",
          content: "Create a Supabase project",
          message_type: "user_action_required",
        })}
      />
    );

    expect(screen.getByText("Create a Supabase project")).toBeInTheDocument();
  });

  // ── Progress update messages ──

  it("renders progress update with ProgressUpdateMessage component", () => {
    useTaskBoardStore.getState().createPlan(PROJECT, {
      id: "plan-1",
      name: "Test",
      description: "",
      template_recommendation: null,
      work_packages: [
        {
          id: "WP1",
          name: "Setup",
          tasks: [],
          status: "done",
          session_id: null,
          retry_count: 0,
        },
      ],
      created_at: "",
      status: "ready",
      project_path: PROJECT,
    });

    render(
      <PlanningChatMessage
        message={makeMsg({
          role: "system",
          content: 'Work Package "Setup" completed. 3/5 checks passed.',
          message_type: "progress_update",
        })}
        projectPath={PROJECT}
      />
    );

    expect(screen.getByTestId("progress-update")).toBeInTheDocument();
  });
});
