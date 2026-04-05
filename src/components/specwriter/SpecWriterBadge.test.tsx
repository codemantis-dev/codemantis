import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecWriterBadge from "./SpecWriterBadge";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import type { SpecConversation } from "../../types/spec-writer";

const PROJECT_PATH = "/tmp/project";

function makeConversation(overrides?: Partial<SpecConversation>): SpecConversation {
  return {
    id: "conv1",
    project_path: PROJECT_PATH,
    messages: [],
    ai_provider: "gemini",
    ai_model: "gemini-2.5-flash",
    status: "gathering",
    mode: "feature",
    context_loaded: false,
    ...overrides,
  };
}

describe("SpecWriterBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSpecWriterStore.setState({
      conversations: new Map(),
    });
  });

  it("returns null when no conversation exists", () => {
    const { container } = render(
      <SpecWriterBadge projectPath={PROJECT_PATH} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when gathering with no messages", () => {
    useSpecWriterStore.setState({
      conversations: new Map([
        [PROJECT_PATH, makeConversation({ status: "gathering", messages: [] })],
      ]),
    });
    const { container } = render(
      <SpecWriterBadge projectPath={PROJECT_PATH} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows 'In progress' when gathering with messages", () => {
    useSpecWriterStore.setState({
      conversations: new Map([
        [
          PROJECT_PATH,
          makeConversation({
            status: "gathering",
            messages: [
              {
                id: "m1",
                role: "user",
                content: "test",
                message_type: "conversation",
                timestamp: "2026-01-01",
              },
            ],
          }),
        ],
      ]),
    });
    render(<SpecWriterBadge projectPath={PROJECT_PATH} />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("shows 'Spec ready' for ready_to_write status", () => {
    useSpecWriterStore.setState({
      conversations: new Map([
        [PROJECT_PATH, makeConversation({ status: "ready_to_write" })],
      ]),
    });
    render(<SpecWriterBadge projectPath={PROJECT_PATH} />);
    expect(screen.getByText("Spec ready")).toBeInTheDocument();
  });

  it("shows 'Writing...' with pulse animation for writing status", () => {
    useSpecWriterStore.setState({
      conversations: new Map([
        [PROJECT_PATH, makeConversation({ status: "writing" })],
      ]),
    });
    render(<SpecWriterBadge projectPath={PROJECT_PATH} />);
    const badge = screen.getByText("Writing...");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("animate-pulse");
  });

  it("shows 'Done' for done status", () => {
    useSpecWriterStore.setState({
      conversations: new Map([
        [PROJECT_PATH, makeConversation({ status: "done" })],
      ]),
    });
    render(<SpecWriterBadge projectPath={PROJECT_PATH} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows 'Working...' with pulse when done but still streaming (audit generation)", () => {
    useSpecWriterStore.setState({
      conversations: new Map([
        [PROJECT_PATH, makeConversation({ status: "done" })],
      ]),
      planningStreaming: new Map([[PROJECT_PATH, true]]),
    });
    render(<SpecWriterBadge projectPath={PROJECT_PATH} />);
    const badge = screen.getByText("Working...");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("animate-pulse");
  });

  it("shows 'Done' without pulse when done and not streaming", () => {
    useSpecWriterStore.setState({
      conversations: new Map([
        [PROJECT_PATH, makeConversation({ status: "done" })],
      ]),
      planningStreaming: new Map([[PROJECT_PATH, false]]),
    });
    render(<SpecWriterBadge projectPath={PROJECT_PATH} />);
    const badge = screen.getByText("Done");
    expect(badge).toBeInTheDocument();
    expect(badge.className).not.toContain("animate-pulse");
  });
});
