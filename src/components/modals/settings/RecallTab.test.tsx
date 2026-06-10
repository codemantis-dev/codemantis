import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import RecallTab from "./RecallTab";
import { useSettingsStore } from "../../../stores/settingsStore";
import { defaultRecallConfig } from "../../../types/recall";
import { resetAllStores } from "../../../test/helpers/store-reset";

const mockInvoke = vi.mocked(invoke);

describe("RecallTab — toggle persistence", () => {
  beforeEach(() => {
    resetAllStores();
    vi.clearAllMocks();
    // Disk starts with Recall disabled (the spec default).
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") {
        return {
          ...useSettingsStore.getState().settings,
          recall: defaultRecallConfig(),
        };
      }
      if (cmd === "update_settings") return undefined;
      return undefined;
    });
  });

  it("flipping Enable Recall syncs the value into the settings store", async () => {
    render(<RecallTab />);
    const checkbox = await screen.findByRole("checkbox");
    expect((checkbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(checkbox);

    // Regression: persist() must route through the store so the in-memory
    // snapshot is updated, not just disk. If it wrote straight to disk, the
    // store would stay stale (enabled:false) and the modal's batch-save would
    // later clobber the toggle back to false.
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.recall?.enabled).toBe(true);
    });
  });

  it("flipping Enable Recall writes the full recall config to disk", async () => {
    render(<RecallTab />);
    const checkbox = await screen.findByRole("checkbox");
    fireEvent.click(checkbox);

    await waitFor(() => {
      const updateCall = mockInvoke.mock.calls.find(
        ([cmd]) => cmd === "update_settings",
      );
      expect(updateCall).toBeDefined();
      const settings = (updateCall?.[1] as { settings: { recall: { enabled: boolean } } })
        .settings;
      expect(settings.recall.enabled).toBe(true);
    });
  });
});
