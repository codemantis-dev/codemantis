import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssistantProviderMenu from "./AssistantProviderMenu";

vi.mock("../../lib/tauri-commands", () => ({
  updateSettings: vi.fn(() => Promise.resolve()),
  getSettings: vi.fn(() => Promise.resolve({})),
}));

describe("AssistantProviderMenu", () => {
  const defaultProps = {
    apiKeys: {} as Record<string, string>,
    expandedProvider: null as string | null,
    creating: false,
    onExpandProvider: vi.fn(),
    onCreate: vi.fn(),
    variant: "empty" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all provider options in empty variant", () => {
    render(<AssistantProviderMenu {...defaultProps} />);
    expect(screen.getByText("Claude Code (local)")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Google Gemini")).toBeInTheDocument();
    expect(screen.getByText("Anthropic API")).toBeInTheDocument();
  });

  it("shows 'No API key' for providers without keys", () => {
    render(<AssistantProviderMenu {...defaultProps} />);
    // Providers requiring API keys should show "No API key"
    const noKeyLabels = screen.getAllByText("No API key");
    expect(noKeyLabels.length).toBeGreaterThanOrEqual(3);
  });

  it("calls onCreate for claude-code (no API key needed)", () => {
    const onCreate = vi.fn();
    render(
      <AssistantProviderMenu {...defaultProps} onCreate={onCreate} />
    );
    fireEvent.click(screen.getByText("Claude Code (local)"));
    expect(onCreate).toHaveBeenCalledWith("claude-code");
  });

  it("disables API providers without keys", () => {
    render(<AssistantProviderMenu {...defaultProps} />);
    const openaiButton = screen.getByText("OpenAI").closest("button");
    expect(openaiButton).toBeDisabled();
  });

  it("expands model list when API provider with key is clicked", () => {
    const onExpandProvider = vi.fn();
    render(
      <AssistantProviderMenu
        {...defaultProps}
        apiKeys={{ openai: "sk-test" }}
        onExpandProvider={onExpandProvider}
      />
    );
    fireEvent.click(screen.getByText("OpenAI"));
    expect(onExpandProvider).toHaveBeenCalledWith("openai");
  });

  it("shows model list when provider is expanded", () => {
    render(
      <AssistantProviderMenu
        {...defaultProps}
        apiKeys={{ openai: "sk-test" }}
        expandedProvider="openai"
      />
    );
    expect(screen.getByText("GPT-5.4 Mini")).toBeInTheDocument();
  });

  it("calls onCreate with provider and model when model clicked", () => {
    const onCreate = vi.fn();
    render(
      <AssistantProviderMenu
        {...defaultProps}
        apiKeys={{ openai: "sk-test" }}
        expandedProvider="openai"
        onCreate={onCreate}
      />
    );
    fireEvent.click(screen.getByText("GPT-5.4 Mini"));
    expect(onCreate).toHaveBeenCalledWith("openai", "gpt-5.4-mini");
  });

  it("renders popover variant with correct styles", () => {
    const { container } = render(
      <AssistantProviderMenu
        {...defaultProps}
        variant="popover"
      />
    );
    const menu = container.firstChild as HTMLElement;
    expect(menu.className).toContain("absolute");
  });

  it("disables all buttons when creating is true", () => {
    render(
      <AssistantProviderMenu
        {...defaultProps}
        creating={true}
        apiKeys={{ openai: "sk-test" }}
      />
    );
    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });
});
