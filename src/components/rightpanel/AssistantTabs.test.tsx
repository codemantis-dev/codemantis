import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssistantTabs from "./AssistantTabs";
import type { AssistantInstance } from "../../stores/assistantStore";

// Mock settingsStore
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector) => {
    const state = {
      settings: {
        modelPricing: {
          "gpt-4.1": { input: 2.0, output: 8.0 },
          "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
        },
      },
    };
    return selector(state);
  }),
}));

const makeAssistant = (overrides?: Partial<AssistantInstance>): AssistantInstance => ({
  id: "s1",
  projectPath: "/tmp",
  parentSessionId: "main-s1",
  name: "Claude 1",
  provider: "claude-code",
  model: null,
  sortOrder: 1,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("AssistantTabs", () => {
  const defaultProps = {
    assistants: [makeAssistant()],
    activeAssistantId: "s1",
    busyMap: new Map<string, boolean>(),
    costMap: new Map(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onCreate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders tab with assistant name", () => {
    render(<AssistantTabs {...defaultProps} />);
    expect(screen.getByText("Claude 1")).toBeInTheDocument();
  });

  it("shows provider badge", () => {
    render(<AssistantTabs {...defaultProps} />);
    // Claude Code badge: "CC"
    expect(screen.getByText("CC")).toBeInTheDocument();
  });

  it("shows OpenAI badge for openai provider", () => {
    render(
      <AssistantTabs
        {...defaultProps}
        assistants={[makeAssistant({ id: "s2", provider: "openai", model: "gpt-4.1", name: "GPT 1" })]}
        activeAssistantId="s2"
      />
    );
    expect(screen.getByText("OA")).toBeInTheDocument();
    expect(screen.getByText("GPT 1")).toBeInTheDocument();
  });

  it("calls onSelect when tab clicked", () => {
    const onSelect = vi.fn();
    render(<AssistantTabs {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Claude 1"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("calls onCreate when + button clicked", () => {
    const onCreate = vi.fn();
    render(<AssistantTabs {...defaultProps} onCreate={onCreate} />);
    fireEvent.click(screen.getByTitle("New assistant"));
    expect(onCreate).toHaveBeenCalled();
  });

  it("renders multiple tabs", () => {
    render(
      <AssistantTabs
        {...defaultProps}
        assistants={[
          makeAssistant({ id: "s1", name: "Claude 1" }),
          makeAssistant({ id: "s2", name: "GPT 1", provider: "openai", model: "gpt-4.1", sortOrder: 2 }),
        ]}
      />
    );
    expect(screen.getByText("Claude 1")).toBeInTheDocument();
    expect(screen.getByText("GPT 1")).toBeInTheDocument();
    expect(screen.getByText("CC")).toBeInTheDocument();
    expect(screen.getByText("OA")).toBeInTheDocument();
  });

  it("shows cost for API providers with token usage", () => {
    const costMap = new Map([["s2", { inputTokens: 1_000_000, outputTokens: 100_000 }]]);
    render(
      <AssistantTabs
        {...defaultProps}
        assistants={[makeAssistant({ id: "s2", provider: "openai", model: "gpt-4.1", name: "GPT 1" })]}
        activeAssistantId="s2"
        costMap={costMap}
      />
    );
    // 1M input at $2 + 100K output at $8 = $2 + $0.8 = $2.80
    expect(screen.getByText("$2.80")).toBeInTheDocument();
  });
});
