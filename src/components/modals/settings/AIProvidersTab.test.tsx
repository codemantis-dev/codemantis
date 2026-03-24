import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AIProvidersTab from "./AIProvidersTab";

vi.mock("../../../lib/tauri-commands", () => ({
  updateSettings: vi.fn(() => Promise.resolve()),
  getSettings: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../../../types/assistant-provider", () => ({
  AI_PROVIDERS: [
    { id: "openai", label: "OpenAI", requiresApiKey: true },
    { id: "gemini", label: "Google Gemini", requiresApiKey: true },
    { id: "claude-code", label: "Claude Code", requiresApiKey: false },
  ],
  AI_MODELS: {
    openai: [
      { id: "gpt-4.1", label: "GPT-4.1", defaultPricing: { input: 2.0, output: 8.0 } },
    ],
    gemini: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", defaultPricing: { input: 0.15, output: 0.60 } },
    ],
  },
}));

describe("AIProvidersTab", () => {
  const defaultProps = {
    apiKeys: {},
    modelPricing: {},
    testingKey: false as const,
    testResults: {} as Record<string, "success" | "error">,
    onApiKeyChange: vi.fn(),
    onModelPricingChange: vi.fn(),
    onTestKey: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title", () => {
    render(<AIProvidersTab {...defaultProps} />);
    expect(screen.getByText("AI Providers")).toBeInTheDocument();
  });

  it("renders API key inputs for providers that require keys", () => {
    render(<AIProvidersTab {...defaultProps} />);
    // "OpenAI" appears in both the API key label and the model pricing heading
    const openaiElements = screen.getAllByText("OpenAI");
    expect(openaiElements.length).toBeGreaterThanOrEqual(1);
    const geminiElements = screen.getAllByText("Google Gemini");
    expect(geminiElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Test buttons for each provider", () => {
    render(<AIProvidersTab {...defaultProps} />);
    const testButtons = screen.getAllByText("Test");
    expect(testButtons).toHaveLength(2); // OpenAI + Gemini
  });

  it("disables Test button when no API key is entered", () => {
    render(<AIProvidersTab {...defaultProps} />);
    const testButtons = screen.getAllByText("Test");
    testButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("enables Test button when API key is entered", () => {
    render(<AIProvidersTab {...defaultProps} apiKeys={{ openai: "sk-test" }} />);
    const testButtons = screen.getAllByText("Test");
    expect(testButtons[0]).not.toBeDisabled();
  });

  it("shows 'Testing...' when a key is being tested", () => {
    render(<AIProvidersTab {...defaultProps} testingKey="openai" apiKeys={{ openai: "sk-test" }} />);
    expect(screen.getByText("Testing...")).toBeInTheDocument();
  });

  it("shows success message for valid key", () => {
    render(<AIProvidersTab {...defaultProps} testResults={{ openai: "success" }} />);
    expect(screen.getByText("API key is valid")).toBeInTheDocument();
  });

  it("shows error message for invalid key", () => {
    render(<AIProvidersTab {...defaultProps} testResults={{ openai: "error" }} />);
    expect(screen.getByText(/Could not validate API key/)).toBeInTheDocument();
  });

  it("calls onApiKeyChange when API key input changes", () => {
    render(<AIProvidersTab {...defaultProps} />);
    const inputs = screen.getAllByPlaceholderText(/Enter .* API key/);
    fireEvent.change(inputs[0], { target: { value: "sk-new-key" } });
    expect(defaultProps.onApiKeyChange).toHaveBeenCalledWith("openai", "sk-new-key");
  });

  it("renders model pricing section", () => {
    render(<AIProvidersTab {...defaultProps} />);
    expect(screen.getByText("Model Pricing (per 1M tokens, USD)")).toBeInTheDocument();
  });
});
