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
});
