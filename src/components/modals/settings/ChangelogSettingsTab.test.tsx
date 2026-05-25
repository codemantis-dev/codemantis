import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChangelogSettingsTab from "./ChangelogSettingsTab";

vi.mock("../../../types/assistant-provider", () => ({
  AI_MODELS: {
    gemini: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", defaultPricing: { input: 0.15, output: 0.60 } },
    ],
    openai: [
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", defaultPricing: { input: 2.0, output: 8.0 } },
    ],
  },
}));

describe("ChangelogSettingsTab", () => {
  const defaultProps = {
    enabled: false,
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    prompt: "Some prompt text",
    onEnabledChange: vi.fn(),
    onProviderChange: vi.fn(),
    onModelChange: vi.fn(),
    onPromptChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title", () => {
    render(<ChangelogSettingsTab {...defaultProps} />);
    expect(screen.getByText("Changelog")).toBeInTheDocument();
  });

  it("renders the enable toggle", () => {
    render(<ChangelogSettingsTab {...defaultProps} />);
    expect(screen.getByText("Enable auto-changelog")).toBeInTheDocument();
  });

  it("hides provider/model/prompt when disabled", () => {
    render(<ChangelogSettingsTab {...defaultProps} enabled={false} />);
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(screen.queryByText("System Prompt")).not.toBeInTheDocument();
  });

  it("shows provider/model/prompt when enabled", () => {
    render(<ChangelogSettingsTab {...defaultProps} enabled={true} />);
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
  });

  it("calls onEnabledChange when toggle is clicked", () => {
    render(<ChangelogSettingsTab {...defaultProps} />);
    // The toggle is a button element
    const toggleBtn = screen.getByText("Enable auto-changelog").closest("div")?.querySelector("button");
    expect(toggleBtn).toBeTruthy();
    fireEvent.click(toggleBtn!);
    expect(defaultProps.onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("renders Reset button when enabled", () => {
    render(<ChangelogSettingsTab {...defaultProps} enabled={true} />);
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("calls onPromptChange with default when Reset is clicked", () => {
    render(<ChangelogSettingsTab {...defaultProps} enabled={true} />);
    fireEvent.click(screen.getByText("Reset"));
    expect(defaultProps.onPromptChange).toHaveBeenCalledTimes(1);
  });

  it("renders prompt textarea when enabled", () => {
    render(<ChangelogSettingsTab {...defaultProps} enabled={true} />);
    const textarea = screen.getByPlaceholderText("System prompt for changelog generation...");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("Some prompt text");
  });
});
