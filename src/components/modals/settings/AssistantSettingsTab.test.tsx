import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssistantSettingsTab from "./AssistantSettingsTab";

vi.mock("../../../types/assistant-provider", () => ({
  AI_PROVIDERS: [
    { id: "claude-code", label: "Claude Code (local)", requiresApiKey: false },
    { id: "openai", label: "OpenAI", requiresApiKey: true },
    { id: "gemini", label: "Google Gemini", requiresApiKey: true },
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

describe("AssistantSettingsTab", () => {
  const defaultProps = {
    defaultProvider: "claude-code" as const,
    defaultModel: {} as Record<string, string>,
    shortcuts: [
      { id: "s1", name: "Explain", prompt: "Explain this code" },
    ],
    apiKeys: {},
    onProviderChange: vi.fn(),
    onModelChange: vi.fn(),
    onShortcutsChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title", () => {
    render(<AssistantSettingsTab {...defaultProps} />);
    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });

  it("renders Default Provider section", () => {
    render(<AssistantSettingsTab {...defaultProps} />);
    expect(screen.getByText("Default Provider")).toBeInTheDocument();
  });

  it("renders Default Models section", () => {
    render(<AssistantSettingsTab {...defaultProps} />);
    expect(screen.getByText("Default Models")).toBeInTheDocument();
  });

  it("renders shortcuts section with existing shortcut", () => {
    render(<AssistantSettingsTab {...defaultProps} />);
    expect(screen.getByText("Shortcuts")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Explain")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Explain this code")).toBeInTheDocument();
  });

  it("renders '+ Add shortcut' button", () => {
    render(<AssistantSettingsTab {...defaultProps} />);
    expect(screen.getByText("+ Add shortcut")).toBeInTheDocument();
  });

  it("calls onShortcutsChange when shortcut name is updated", () => {
    render(<AssistantSettingsTab {...defaultProps} />);
    const nameInput = screen.getByDisplayValue("Explain");
    fireEvent.change(nameInput, { target: { value: "Review" } });
    expect(defaultProps.onShortcutsChange).toHaveBeenCalledWith([
      { id: "s1", name: "Review", prompt: "Explain this code" },
    ]);
  });

  it("calls onProviderChange when provider is changed", () => {
    render(<AssistantSettingsTab {...defaultProps} />);
    // Find the provider select (the one in the FieldRow labeled "Provider")
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "openai" } });
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("openai");
  });

  it("disables model selects when no API key is set", () => {
    render(<AssistantSettingsTab {...defaultProps} />);
    // Find model selects (for OpenAI, Gemini)
    const modelSelects = screen.getAllByRole("combobox");
    // The second and third selects should be the model selects (after provider)
    // They should be disabled since no API keys are set
    for (let i = 1; i < modelSelects.length; i++) {
      expect(modelSelects[i]).toBeDisabled();
    }
  });
});
