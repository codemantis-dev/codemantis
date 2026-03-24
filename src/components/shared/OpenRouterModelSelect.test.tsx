import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OpenRouterModelSelect from "./OpenRouterModelSelect";
import { useOpenRouterStore } from "../../stores/openRouterStore";
import type { OpenRouterModel } from "../../types/assistant-provider";

// Mock Tauri commands (required by openRouterStore)
vi.mock("../../lib/tauri-commands", () => ({
  fetchOpenRouterModels: vi.fn(),
}));

function makeModel(overrides: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id: "test/model",
    name: "Test Model",
    isFree: false,
    inputModalities: ["text"],
    outputModalities: ["text"],
    contextLength: 4096,
    pricing: { input: 1.0, output: 2.0 },
    ...overrides,
  };
}

function setModels(models: OpenRouterModel[]): void {
  useOpenRouterStore.setState({
    models,
    loading: false,
    lastFetched: Date.now(),
    error: null,
  });
}

describe("OpenRouterModelSelect", () => {
  beforeEach(() => {
    useOpenRouterStore.setState({
      models: [],
      loading: false,
      lastFetched: null,
      error: null,
    });
  });

  // ── Collapsed state ──

  it("renders placeholder when no value selected", () => {
    setModels([makeModel()]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    expect(screen.getByText("Select model...")).toBeInTheDocument();
  });

  it("renders custom placeholder", () => {
    setModels([makeModel()]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} placeholder="Pick one..." />);
    expect(screen.getByText("Pick one...")).toBeInTheDocument();
  });

  it("shows selected model name when value matches", () => {
    setModels([makeModel({ id: "google/gemini:free", name: "Gemini Free", isFree: true })]);
    render(<OpenRouterModelSelect value="google/gemini:free" onChange={vi.fn()} />);
    expect(screen.getByText("[FREE] Gemini Free")).toBeInTheDocument();
  });

  it("shows selected paid model name without FREE prefix", () => {
    setModels([makeModel({ id: "openai/gpt-4", name: "GPT-4", isFree: false })]);
    render(<OpenRouterModelSelect value="openai/gpt-4" onChange={vi.fn()} />);
    expect(screen.getByText("GPT-4")).toBeInTheDocument();
  });

  it("shows raw value when model not found in store", () => {
    setModels([]);
    render(<OpenRouterModelSelect value="unknown/model" onChange={vi.fn()} />);
    expect(screen.getByText("unknown/model")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    useOpenRouterStore.setState({ loading: true });
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    expect(screen.getByText("Loading models...")).toBeInTheDocument();
  });

  // ── Disabled state ──

  it("renders disabled button when disabled", () => {
    setModels([makeModel()]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} disabled />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("does not open dropdown when disabled and clicked", () => {
    setModels([makeModel({ id: "m1", name: "Model 1" })]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByPlaceholderText("Search models...")).not.toBeInTheDocument();
  });

  // ── Expanded state ──

  it("opens dropdown on click", () => {
    setModels([makeModel({ id: "m1", name: "Model 1" })]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByPlaceholderText("Search models...")).toBeInTheDocument();
  });

  it("shows free and paid section headers", () => {
    setModels([
      makeModel({ id: "free-1", name: "Free One", isFree: true }),
      makeModel({ id: "paid-1", name: "Paid One", isFree: false }),
    ]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Free Models (1)")).toBeInTheDocument();
    expect(screen.getByText("Paid Models (1)")).toBeInTheDocument();
  });

  it("shows empty state when no models loaded", () => {
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("No models loaded. Test your API key first.")).toBeInTheDocument();
  });

  it("lists model names in the dropdown", () => {
    setModels([
      makeModel({ id: "a", name: "Alpha Model", isFree: false }),
      makeModel({ id: "b", name: "Beta Model", isFree: true }),
    ]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Alpha Model")).toBeInTheDocument();
    expect(screen.getByText("Beta Model")).toBeInTheDocument();
  });

  // ── Sorting ──

  it("sorts free models before paid models", () => {
    setModels([
      makeModel({ id: "paid", name: "Paid", isFree: false }),
      makeModel({ id: "free", name: "Free", isFree: true }),
    ]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    const buttons = screen.getAllByRole("button").filter((b) => b.getAttribute("data-model-id"));
    expect(buttons[0].getAttribute("data-model-id")).toBe("free");
    expect(buttons[1].getAttribute("data-model-id")).toBe("paid");
  });

  // ── Search filtering ──

  it("filters models by search text", () => {
    setModels([
      makeModel({ id: "a", name: "Alpha Model", isFree: false }),
      makeModel({ id: "b", name: "Beta Model", isFree: false }),
    ]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "alpha" } });
    expect(screen.getByText("Alpha Model")).toBeInTheDocument();
    expect(screen.queryByText("Beta Model")).not.toBeInTheDocument();
  });

  it("filters by model ID as well", () => {
    setModels([
      makeModel({ id: "google/gemini-flash", name: "Gemini Flash", isFree: false }),
      makeModel({ id: "openai/gpt-4", name: "GPT-4", isFree: false }),
    ]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "google" } });
    expect(screen.getByText("Gemini Flash")).toBeInTheDocument();
    expect(screen.queryByText("GPT-4")).not.toBeInTheDocument();
  });

  it("shows no match message when search yields nothing", () => {
    setModels([makeModel({ id: "a", name: "Alpha" })]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "zzz" } });
    expect(screen.getByText('No models match "zzz"')).toBeInTheDocument();
  });

  // ── Selection ──

  it("calls onChange when a model is clicked", () => {
    const onChange = vi.fn();
    setModels([makeModel({ id: "pick-me", name: "Pick Me" })]);
    render(<OpenRouterModelSelect value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Pick Me"));
    expect(onChange).toHaveBeenCalledWith("pick-me");
  });

  it("closes dropdown after selecting a model", () => {
    const onChange = vi.fn();
    setModels([makeModel({ id: "m1", name: "Model 1" })]);
    render(<OpenRouterModelSelect value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByPlaceholderText("Search models...")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Model 1"));
    expect(screen.queryByPlaceholderText("Search models...")).not.toBeInTheDocument();
  });

  it("highlights the currently selected model", () => {
    setModels([
      makeModel({ id: "m1", name: "Model 1" }),
      makeModel({ id: "m2", name: "Model 2" }),
    ]);
    render(<OpenRouterModelSelect value="m2" onChange={vi.fn()} />);
    // Click the trigger button (the one showing "Model 2" text)
    fireEvent.click(screen.getByText("Model 2"));
    // Now find the model item button by data attribute
    const selected = document.querySelector('[data-model-id="m2"]');
    expect(selected?.className).toContain("accent");
  });

  // ── Escape key ──

  it("closes dropdown on Escape key", () => {
    setModels([makeModel({ id: "m1", name: "Model 1" })]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    const searchInput = screen.getByPlaceholderText("Search models...");
    expect(searchInput).toBeInTheDocument();
    fireEvent.keyDown(searchInput, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search models...")).not.toBeInTheDocument();
  });

  // ── FREE badge in items ──

  it("shows FREE badge for free models in the list", () => {
    setModels([makeModel({ id: "f1", name: "Free Model", isFree: true })]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("FREE")).toBeInTheDocument();
  });

  it("does not show FREE badge for paid models in the list", () => {
    setModels([makeModel({ id: "p1", name: "Paid Model", isFree: false })]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("FREE")).not.toBeInTheDocument();
  });

  // ── Toggle open/close ──

  it("toggles dropdown on repeated clicks", () => {
    setModels([makeModel({ id: "m1", name: "Model 1" })]);
    render(<OpenRouterModelSelect value="" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button");

    // Open
    fireEvent.click(trigger);
    expect(screen.getByPlaceholderText("Search models...")).toBeInTheDocument();

    // Close
    fireEvent.click(trigger);
    expect(screen.queryByPlaceholderText("Search models...")).not.toBeInTheDocument();
  });
});
