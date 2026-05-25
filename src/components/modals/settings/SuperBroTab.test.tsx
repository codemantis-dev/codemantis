import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SuperBroTab from "./SuperBroTab";

vi.mock("../../../stores/openRouterStore", () => ({
  useOpenRouterStore: vi.fn((selector) =>
    selector({
      models: [
        { id: "google/gemini:free", name: "Gemini Free", isFree: true },
        { id: "anthropic/claude-3", name: "Claude 3", isFree: false },
      ],
    }),
  ),
}));

const ALL_KEYS: Record<string, string> = {
  openrouter: "or-key-123",
  gemini: "gem-key-456",
  openai: "sk-key-789",
  anthropic: "ant-key-abc",
};

describe("SuperBroTab", () => {
  const defaultProps = {
    enabled: true,
    provider: "auto",
    model: "auto",
    apiKeys: ALL_KEYS,
    onEnabledChange: vi.fn(),
    onProviderChange: vi.fn(),
    onModelChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders enable toggle", () => {
    render(<SuperBroTab {...defaultProps} />);
    expect(screen.getByText("Enable Super-Bro")).toBeInTheDocument();
  });

  it("shows provider/model selectors when enabled and keys exist", () => {
    render(<SuperBroTab {...defaultProps} enabled={true} />);
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("hides provider/model selectors when disabled", () => {
    render(<SuperBroTab {...defaultProps} enabled={false} />);
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
  });

  it("shows info text about Super-Bro being read-only", () => {
    render(<SuperBroTab {...defaultProps} enabled={true} />);
    expect(
      screen.getByText(/never modifies files or runs commands/),
    ).toBeInTheDocument();
  });

  it("provider change callback fires and resets model", () => {
    render(<SuperBroTab {...defaultProps} enabled={true} provider="auto" />);
    const providerSelect = screen.getByDisplayValue("Auto (cheapest available)");
    fireEvent.change(providerSelect, { target: { value: "gemini" } });
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("gemini");
    expect(defaultProps.onModelChange).toHaveBeenCalledWith("auto");
  });

  it("only shows providers with saved API keys", () => {
    const keysOnlyGemini = { gemini: "gem-key-456" };
    render(
      <SuperBroTab {...defaultProps} enabled={true} apiKeys={keysOnlyGemini} />,
    );
    const providerSelect = screen.getByDisplayValue("Auto (cheapest available)");
    const options = providerSelect.querySelectorAll("option");
    // "Auto" + "Google Gemini" only
    expect(options.length).toBe(2);
    expect(options[0].textContent).toBe("Auto (cheapest available)");
    expect(options[1].textContent).toBe("Google Gemini");
  });

  it("hides providers without API keys", () => {
    const keysOnlyGemini = { gemini: "gem-key-456" };
    render(
      <SuperBroTab {...defaultProps} enabled={true} apiKeys={keysOnlyGemini} />,
    );
    const providerSelect = screen.getByDisplayValue("Auto (cheapest available)");
    const optionTexts = Array.from(providerSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(optionTexts).not.toContain("OpenAI");
    expect(optionTexts).not.toContain("Anthropic");
    expect(optionTexts).not.toContain("OpenRouter");
  });

  it("shows no-key message when no API keys are configured", () => {
    render(
      <SuperBroTab {...defaultProps} enabled={true} apiKeys={{}} />,
    );
    expect(screen.getByText(/No AI provider API keys configured/)).toBeInTheDocument();
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
  });

  it("ignores empty/whitespace-only API keys", () => {
    const emptyKeys = { gemini: "  ", openai: "", anthropic: "ant-key" };
    render(
      <SuperBroTab {...defaultProps} enabled={true} apiKeys={emptyKeys} />,
    );
    const providerSelect = screen.getByDisplayValue("Auto (cheapest available)");
    const options = providerSelect.querySelectorAll("option");
    // "Auto" + "Anthropic" only (gemini and openai keys are blank)
    expect(options.length).toBe(2);
    expect(options[1].textContent).toBe("Anthropic");
  });

  it("shows all AI_MODELS for a provider with key", () => {
    render(
      <SuperBroTab {...defaultProps} enabled={true} provider="gemini" model="auto" />,
    );
    const modelSelect = screen.getByDisplayValue("Auto — best available");
    const options = modelSelect.querySelectorAll("option");
    // auto + 5 Gemini models from AI_MODELS
    expect(options.length).toBe(6);
  });

  it("shows all OpenRouter models from store", () => {
    render(
      <SuperBroTab {...defaultProps} enabled={true} provider="openrouter" model="auto" />,
    );
    const modelSelect = screen.getByDisplayValue("Auto — best available");
    const options = modelSelect.querySelectorAll("option");
    // auto + 2 mocked OpenRouter models
    expect(options.length).toBe(3);
    expect(screen.getByText("Gemini Free (free)")).toBeInTheDocument();
    expect(screen.getByText("Claude 3")).toBeInTheDocument();
  });

  it("shows all Anthropic models", () => {
    render(
      <SuperBroTab {...defaultProps} enabled={true} provider="anthropic" model="auto" />,
    );
    const modelSelect = screen.getByDisplayValue("Auto — best available");
    const options = modelSelect.querySelectorAll("option");
    // auto + 3 Anthropic models
    expect(options.length).toBe(4);
  });

  it("shows all OpenAI models", () => {
    render(
      <SuperBroTab {...defaultProps} enabled={true} provider="openai" model="auto" />,
    );
    const modelSelect = screen.getByDisplayValue("Auto — best available");
    const options = modelSelect.querySelectorAll("option");
    // auto + 3 OpenAI models
    expect(options.length).toBe(4);
  });

  it("model change callback fires", () => {
    render(
      <SuperBroTab
        {...defaultProps}
        enabled={true}
        provider="gemini"
        model="gemini-2.5-flash-lite"
      />,
    );
    const modelSelect = screen.getByDisplayValue("Gemini 2.5 Flash Lite");
    fireEvent.change(modelSelect, {
      target: { value: "gemini-2.5-flash" },
    });
    expect(defaultProps.onModelChange).toHaveBeenCalledWith("gemini-2.5-flash");
  });

  it("snaps stale provider to first available when its API key is missing", () => {
    render(
      <SuperBroTab
        {...defaultProps}
        enabled={true}
        provider="anthropic"
        model="claude-haiku-4-5"
        apiKeys={{ gemini: "gem-key-456" }}
      />,
    );
    // First available provider when only gemini has a key is the synthetic "auto"
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("auto");
    expect(defaultProps.onModelChange).toHaveBeenCalledWith("auto");
  });

  it("does not snap when disabled (avoids unnecessary writes)", () => {
    render(
      <SuperBroTab
        {...defaultProps}
        enabled={false}
        provider="anthropic"
        model="claude-haiku-4-5"
        apiKeys={{ gemini: "gem-key-456" }}
      />,
    );
    expect(defaultProps.onProviderChange).not.toHaveBeenCalled();
    expect(defaultProps.onModelChange).not.toHaveBeenCalled();
  });

  it("toggle callback fires", () => {
    render(<SuperBroTab {...defaultProps} enabled={false} />);
    const toggleButton = screen.getByRole("button");
    fireEvent.click(toggleButton);
    expect(defaultProps.onEnabledChange).toHaveBeenCalledWith(true);
  });
});
