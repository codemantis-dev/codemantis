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

describe("SuperBroTab", () => {
  const defaultProps = {
    enabled: true,
    provider: "auto",
    model: "auto",
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

  it("shows provider/model selectors when enabled", () => {
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

  it("shows all AI_MODELS for a hardcoded provider", () => {
    render(
      <SuperBroTab {...defaultProps} enabled={true} provider="gemini" model="auto" />,
    );
    // Should have "Auto" + all 6 Gemini models from AI_MODELS
    const modelSelect = screen.getByDisplayValue("Auto — best available");
    const options = modelSelect.querySelectorAll("option");
    // auto + gemini-2.5-flash-lite + gemini-2.5-flash + gemini-2.5-pro
    // + gemini-3-flash-preview + gemini-3.1-pro-preview + gemini-3.1-flash-lite-preview
    expect(options.length).toBe(7); // 1 auto + 6 models
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
    // auto + 3 Anthropic models (Opus, Sonnet, Haiku)
    expect(options.length).toBe(4);
  });

  it("shows all OpenAI models", () => {
    render(
      <SuperBroTab {...defaultProps} enabled={true} provider="openai" model="auto" />,
    );
    const modelSelect = screen.getByDisplayValue("Auto — best available");
    const options = modelSelect.querySelectorAll("option");
    // auto + 4 OpenAI models (GPT-4.1, GPT-5.4 Nano, Mini, full)
    expect(options.length).toBe(5);
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

  it("toggle callback fires", () => {
    render(<SuperBroTab {...defaultProps} enabled={false} />);
    const toggleButton = screen.getByRole("button");
    fireEvent.click(toggleButton);
    expect(defaultProps.onEnabledChange).toHaveBeenCalledWith(true);
  });
});
