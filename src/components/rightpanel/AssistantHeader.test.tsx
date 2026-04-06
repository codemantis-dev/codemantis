import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AssistantHeader from "./AssistantHeader";
import type { AssistantInstance } from "../../stores/assistantStore";
import type { AIProvider } from "../../types/assistant-provider";

// Mock child components to isolate AssistantHeader logic
vi.mock("./AssistantTabs", () => ({
  default: ({ assistants, onClose, onCreate }: {
    assistants: AssistantInstance[];
    activeAssistantId: string | null;
    onClose: (id: string) => void;
    onCreate: () => void;
  }) => (
    <div data-testid="assistant-tabs">
      {assistants.map((a) => (
        <div key={a.id} data-testid={`tab-${a.id}`}>
          <span>{a.name}</span>
          <span>{a.provider}</span>
          <span>{a.model}</span>
          <button onClick={() => onClose(a.id)} aria-label={`Close ${a.name}`}>Close</button>
        </div>
      ))}
      <button onClick={onCreate} data-testid="create-btn">New</button>
    </div>
  ),
}));

vi.mock("./AssistantProviderMenu", () => ({
  default: ({ creating }: { creating: boolean }) => (
    <div data-testid="provider-menu">
      {creating && <span>Creating...</span>}
    </div>
  ),
}));

function makeAssistant(overrides?: Partial<AssistantInstance>): AssistantInstance {
  return {
    id: "a1",
    projectPath: "/tmp/project",
    parentSessionId: "main-1",
    name: "My Assistant",
    provider: "openai" as AIProvider,
    model: "gpt-4.1",
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("AssistantHeader", () => {
  const defaultProps = {
    assistants: [makeAssistant()],
    activeAssistantId: "a1",
    allBusy: new Map<string, boolean>(),
    allCost: new Map(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onOpenProviderMenu: vi.fn(),
    showProviderMenu: false,
    providerMenuRef: { current: null },
    apiKeys: {},
    expandedProvider: null,
    creating: false,
    onExpandProvider: vi.fn(),
    onCreate: vi.fn(),
    isApiProvider: true,
    activeInstance: makeAssistant(),
    messages: [],
    streaming: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays assistant name", () => {
    render(<AssistantHeader {...defaultProps} />);
    expect(screen.getByText("My Assistant")).toBeInTheDocument();
  });

  it("shows provider name", () => {
    render(<AssistantHeader {...defaultProps} />);
    expect(screen.getByText("openai")).toBeInTheDocument();
  });

  it("shows model name", () => {
    render(<AssistantHeader {...defaultProps} />);
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
  });

  it("close button triggers onClose callback", () => {
    render(<AssistantHeader {...defaultProps} />);
    const closeBtn = screen.getByLabelText("Close My Assistant");
    closeBtn.click();
    expect(defaultProps.onClose).toHaveBeenCalledWith("a1");
  });

  it("shows provider menu when showProviderMenu is true", () => {
    render(<AssistantHeader {...defaultProps} showProviderMenu />);
    expect(screen.getByTestId("provider-menu")).toBeInTheDocument();
  });
});
