import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import DuoTab from "./DuoTab";
import { useSettingsStore } from "../../../stores/settingsStore";
import { DEFAULT_DUO_SETTINGS } from "../../../types/settings";
import { resetAllStores } from "../../../test/helpers/store-reset";

const mockInvoke = vi.mocked(invoke);

describe("DuoTab", () => {
  beforeEach(() => {
    resetAllStores();
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return useSettingsStore.getState().settings;
      if (cmd === "update_settings") return undefined;
      return undefined;
    });
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, duo: { ...DEFAULT_DUO_SETTINGS } },
    }));
  });

  it("renders the policy controls with current values", () => {
    render(<DuoTab />);
    expect(screen.getByText("Duo-Coding")).toBeInTheDocument();
    expect(screen.getByText("When the pair can't converge")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3")).toBeInTheDocument(); // max dialogue rounds default
  });

  it("changing the tie-break policy persists into the settings store", async () => {
    render(<DuoTab />);
    const select = screen.getByDisplayValue("Pause for me to decide");
    fireEvent.change(select, { target: { value: "mentorWins" } });
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.duo?.tieBreakPolicy).toBe("mentorWins"),
    );
  });

  it("setting a budget cap persists a numeric value", async () => {
    render(<DuoTab />);
    // The USD cap is the spinbutton with step 0.5.
    const usd = screen.getAllByRole("spinbutton").find((el) =>
      (el as HTMLInputElement).step === "0.5",
    ) as HTMLInputElement;
    fireEvent.change(usd, { target: { value: "2.5" } });
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.duo?.budgetUsdCap).toBe(2.5),
    );
  });

  it("disables the analyst provider when the analyst is off", () => {
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, duo: { ...DEFAULT_DUO_SETTINGS, analystEnabled: false } },
    }));
    render(<DuoTab />);
    const provider = screen.getByDisplayValue("Google Gemini") as HTMLSelectElement;
    expect(provider.disabled).toBe(true);
  });

  it("toggling Enable Duo-Coding persists into the settings store", async () => {
    // Default is ON; the first toggle turns it off.
    expect(useSettingsStore.getState().settings.duo?.enabled).toBe(true);
    render(<DuoTab />);
    // The enable toggle is the first switch button in the tab.
    const toggles = screen.getAllByRole("button");
    fireEvent.click(toggles[0]);
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.duo?.enabled).toBe(false),
    );
  });

  it("changing the live-review cadence persists into the settings store", async () => {
    render(<DuoTab />);
    const select = screen.getByDisplayValue("Balanced") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "thorough" } });
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.duo?.liveReviewCadence).toBe("thorough"),
    );
  });

  it("disables the live-review cadence when live co-review is off", () => {
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, duo: { ...DEFAULT_DUO_SETTINGS, liveReviewEnabled: false } },
    }));
    render(<DuoTab />);
    const cadence = screen.getByDisplayValue("Balanced") as HTMLSelectElement;
    expect(cadence.disabled).toBe(true);
  });

  it("offers analyst models as a dropdown for the selected provider", async () => {
    render(<DuoTab />);
    // Provider defaults to gemini → its model list is offered as <option>s.
    const modelSelect = screen.getByDisplayValue("Gemini 2.5 Flash Lite") as HTMLSelectElement;
    expect(modelSelect.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Gemini 2.5 Flash" })).toBeInTheDocument();
    fireEvent.change(modelSelect, { target: { value: "gemini-2.5-flash" } });
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.duo?.analystModel).toBe("gemini-2.5-flash"),
    );
  });

  it("resets the analyst model to the new provider's first model on provider change", async () => {
    render(<DuoTab />);
    const provider = screen.getByDisplayValue("Google Gemini");
    fireEvent.change(provider, { target: { value: "openai" } });
    await waitFor(() => {
      const model = useSettingsStore.getState().settings.duo?.analystModel;
      expect(model).toBe("gpt-5.4-mini"); // first OpenAI model in AI_MODELS
    });
  });
});
