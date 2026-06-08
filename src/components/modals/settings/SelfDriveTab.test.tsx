import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SelfDriveTab from "./SelfDriveTab";
import { useOpenRouterStore } from "../../../stores/openRouterStore";
import type { OpenRouterModel } from "../../../types/assistant-provider";

vi.mock("../../../lib/tauri-commands", () => ({
  fetchOpenRouterModels: vi.fn(),
}));

function makeOrModel(overrides: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id: "vendor/test",
    name: "Vendor Test",
    isFree: false,
    inputModalities: ["text"],
    outputModalities: ["text"],
    contextLength: 8192,
    pricing: { input: 1, output: 3 },
    ...overrides,
  };
}

function setOrStore(models: OpenRouterModel[]): void {
  useOpenRouterStore.setState({
    models,
    loading: false,
    lastFetched: models.length > 0 ? Date.now() : null,
    error: null,
  });
}

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
    setOrStore([]);
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
        model="claude-opus-4-8"
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
    expect(optionTexts).toContain("Gemini 3.5 Flash");
    expect(optionTexts).not.toContain("Claude Opus 4.8");
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

  it("sorts the Anthropic model dropdown cheap→expensive (Haiku first)", () => {
    render(
      <SelfDriveTab
        {...baseProps}
        provider="anthropic"
        model="claude-haiku-4-5"
        apiKeys={{ anthropic: "k" }}
      />,
    );
    const modelSelect = screen.getByDisplayValue("Claude Haiku 4.5");
    const optionTexts = Array.from(modelSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(optionTexts[0]).toBe("Claude Haiku 4.5");
    // Opus 4.8 is the most expensive Anthropic model — must land last.
    expect(optionTexts[optionTexts.length - 1]).toBe("Claude Opus 4.8");
  });

  // ── OpenRouter live cache wiring ─────────────────────────────────────

  it("lists OpenRouter models from the live cache when provider is openrouter", () => {
    setOrStore([
      makeOrModel({ id: "free/llama", name: "Llama", isFree: true, pricing: { input: 0, output: 0 } }),
      makeOrModel({ id: "anthropic/opus", name: "Opus", isFree: false, pricing: { input: 5, output: 25 } }),
      makeOrModel({ id: "openai/4o-mini", name: "4o Mini", isFree: false, pricing: { input: 0.15, output: 0.6 } }),
    ]);
    render(
      <SelfDriveTab
        {...baseProps}
        provider="openrouter"
        model="anthropic/opus"
        apiKeys={{ openrouter: "or-key" }}
      />,
    );
    const modelSelect = screen.getByDisplayValue("Opus");
    const optionTexts = Array.from(modelSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(optionTexts).toEqual(["Llama (free)", "4o Mini", "Opus"]);
  });

  it("shows a loading placeholder + primes the OpenRouter cache when empty", async () => {
    const tauriMod = await import("../../../lib/tauri-commands");
    const fetchSpy = tauriMod.fetchOpenRouterModels as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValue([]);
    setOrStore([]);

    render(
      <SelfDriveTab
        {...baseProps}
        provider="openrouter"
        model="" // saved model becomes meaningless until cache lands
        apiKeys={{ openrouter: "or-key" }}
      />,
    );
    expect(screen.getByText(/Loading OpenRouter models/)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith("or-key");
  });

  it("does not snap the saved model while OpenRouter is still loading", () => {
    setOrStore([]);
    render(
      <SelfDriveTab
        {...baseProps}
        provider="openrouter"
        model="anthropic/opus-saved"
        apiKeys={{ openrouter: "or-key" }}
      />,
    );
    // No reconciliation should fire — we don't know what to snap to yet.
    expect(baseProps.onModelChange).not.toHaveBeenCalled();
  });

  it("on provider switch to openrouter with cache populated, picks the top-sorted model", () => {
    setOrStore([
      makeOrModel({ id: "free/best", name: "Best Free", isFree: true, pricing: { input: 0, output: 0 } }),
      makeOrModel({ id: "anthropic/opus", name: "Opus", isFree: false, pricing: { input: 5, output: 25 } }),
    ]);
    render(
      <SelfDriveTab
        {...baseProps}
        provider="anthropic"
        model="claude-haiku-4-5"
        apiKeys={{ anthropic: "k", openrouter: "or-key" }}
      />,
    );
    const providerSelect = screen.getByDisplayValue("Anthropic");
    fireEvent.change(providerSelect, { target: { value: "openrouter" } });
    expect(baseProps.onProviderChange).toHaveBeenCalledWith("openrouter");
    expect(baseProps.onModelChange).toHaveBeenCalledWith("free/best");
  });
});
