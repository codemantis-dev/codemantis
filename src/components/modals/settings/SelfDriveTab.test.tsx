import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SelfDriveTab from "./SelfDriveTab";

const baseProps = {
  provider: "gemini",
  model: "gemini-2.5-flash-lite",
  maxFixAttempts: 3,
  runBuildCheck: true,
  runTests: true,
  autoCommit: false,
  enableRecheckLoop: true,
  apiKeys: { gemini: "gem-key" } as Record<string, string>,
  onProviderChange: vi.fn(),
  onModelChange: vi.fn(),
  onMaxFixAttemptsChange: vi.fn(),
  onRunBuildCheckChange: vi.fn(),
  onRunTestsChange: vi.fn(),
  onAutoCommitChange: vi.fn(),
  onEnableRecheckLoopChange: vi.fn(),
};

describe("SelfDriveTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("snaps stale provider to first available when its API key is missing", () => {
    render(
      <SelfDriveTab
        {...baseProps}
        provider="anthropic"
        model="claude-haiku-4-5"
        apiKeys={{ gemini: "gem-key" }}
      />,
    );
    expect(baseProps.onProviderChange).toHaveBeenCalledWith("gemini");
    expect(baseProps.onModelChange).toHaveBeenCalledWith("gemini-2.5-flash-lite");
  });

  it("snaps stale model to first model of current provider", () => {
    render(
      <SelfDriveTab
        {...baseProps}
        provider="gemini"
        model="claude-opus-4-7"
        apiKeys={{ gemini: "gem-key" }}
      />,
    );
    expect(baseProps.onProviderChange).not.toHaveBeenCalled();
    expect(baseProps.onModelChange).toHaveBeenCalledWith("gemini-2.5-flash-lite");
  });

  it("does not fire callbacks when provider and model are already valid", () => {
    render(
      <SelfDriveTab
        {...baseProps}
        provider="gemini"
        model="gemini-2.5-flash"
        apiKeys={{ gemini: "gem-key" }}
      />,
    );
    expect(baseProps.onProviderChange).not.toHaveBeenCalled();
    expect(baseProps.onModelChange).not.toHaveBeenCalled();
  });

  it("renders the no-keys empty state when no providers have keys", () => {
    render(<SelfDriveTab {...baseProps} apiKeys={{}} />);
    expect(
      screen.getByText(/No AI provider API keys configured/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(baseProps.onProviderChange).not.toHaveBeenCalled();
    expect(baseProps.onModelChange).not.toHaveBeenCalled();
  });

  it("Model dropdown lists Gemini models when provider is gemini", () => {
    render(
      <SelfDriveTab
        {...baseProps}
        provider="gemini"
        model="gemini-2.5-flash-lite"
        apiKeys={{ gemini: "gem-key" }}
      />,
    );
    const modelSelect = screen.getByDisplayValue("Gemini 2.5 Flash Lite");
    const optionTexts = Array.from(modelSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(optionTexts).toContain("Gemini 2.5 Flash Lite");
    expect(optionTexts).toContain("Gemini 2.5 Pro");
    expect(optionTexts).not.toContain("Claude Opus 4.7");
  });

  it("provider change handler resets model to first of new provider", () => {
    render(
      <SelfDriveTab
        {...baseProps}
        provider="anthropic"
        model="claude-haiku-4-5"
        apiKeys={{ anthropic: "k", gemini: "g" }}
      />,
    );
    const providerSelect = screen.getByDisplayValue("Anthropic");
    fireEvent.change(providerSelect, { target: { value: "gemini" } });
    expect(baseProps.onProviderChange).toHaveBeenCalledWith("gemini");
    expect(baseProps.onModelChange).toHaveBeenCalledWith("gemini-2.5-flash-lite");
  });
});
