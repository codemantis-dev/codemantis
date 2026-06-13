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

describe("RecallTab — advanced fields", () => {
  // Helper: read the most recent recall config written via update_settings.
  const lastRecall = () => {
    const calls = mockInvoke.mock.calls.filter(([cmd]) => cmd === "update_settings");
    const last = calls[calls.length - 1];
    return (last?.[1] as { settings: { recall: Record<string, unknown> } }).settings
      .recall;
  };

  const mountEnabled = (overrides: Record<string, unknown> = {}) => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") {
        return {
          ...useSettingsStore.getState().settings,
          recall: { ...defaultRecallConfig(), enabled: true, ...overrides },
        };
      }
      if (cmd === "update_settings") return undefined;
      return undefined;
    });
  };

  beforeEach(() => {
    resetAllStores();
    vi.clearAllMocks();
  });

  it("hides the Advanced section when Recall is disabled", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") {
        return {
          ...useSettingsStore.getState().settings,
          recall: defaultRecallConfig(), // enabled: false
        };
      }
      return undefined;
    });
    render(<RecallTab />);
    await screen.findByRole("checkbox");
    expect(screen.queryByLabelText("Enricher provider")).toBeNull();
  });

  it("shows the Advanced section when Recall is enabled", async () => {
    mountEnabled();
    render(<RecallTab />);
    expect(await screen.findByLabelText("Enricher provider")).toBeTruthy();
    expect(screen.getByLabelText("Harvester model")).toBeTruthy();
    expect(screen.getByLabelText("Token budget per brief")).toBeTruthy();
    expect(screen.getByLabelText("Stale threshold (days)")).toBeTruthy();
  });

  it("changing enricher provider persists it and resets the model", async () => {
    mountEnabled();
    render(<RecallTab />);
    const select = await screen.findByLabelText("Enricher provider");
    fireEvent.change(select, { target: { value: "openai" } });

    await waitFor(() => {
      const recall = lastRecall();
      expect(recall.enricherProvider).toBe("openai");
      // Model reset to a valid OpenAI model, not left as a Gemini id.
      expect(recall.enricherModel).toBe("gpt-5.4-mini");
    });
  });

  it("changing enricher model persists it without touching the harvester", async () => {
    mountEnabled();
    render(<RecallTab />);
    const model = await screen.findByLabelText("Enricher model");
    fireEvent.change(model, { target: { value: "gemini-3.5-flash" } });

    await waitFor(() => {
      const recall = lastRecall();
      expect(recall.enricherModel).toBe("gemini-3.5-flash");
      expect(recall.harvesterModel).toBe("gemini-3.1-flash-lite");
    });
  });

  it("harvester provider/model persist independently of the enricher", async () => {
    mountEnabled();
    render(<RecallTab />);
    const select = await screen.findByLabelText("Harvester provider");
    fireEvent.change(select, { target: { value: "anthropic" } });

    await waitFor(() => {
      const recall = lastRecall();
      expect(recall.harvesterProvider).toBe("anthropic");
      expect(recall.harvesterModel).toBe("claude-opus-4-8");
      // Enricher untouched.
      expect(recall.enricherProvider).toBe("google");
    });
  });

  it("token budget input persists clamped and ignores NaN", async () => {
    mountEnabled();
    render(<RecallTab />);
    const input = await screen.findByLabelText("Token budget per brief");

    fireEvent.change(input, { target: { value: "99999" } });
    await waitFor(() => expect(lastRecall().tokenBudgetPerBrief).toBe(8000));

    const before = mockInvoke.mock.calls.filter(([c]) => c === "update_settings").length;
    fireEvent.change(input, { target: { value: "" } }); // NaN → ignored
    const after = mockInvoke.mock.calls.filter(([c]) => c === "update_settings").length;
    expect(after).toBe(before);
  });

  it("stale threshold input persists clamped", async () => {
    mountEnabled();
    render(<RecallTab />);
    const input = await screen.findByLabelText("Stale threshold (days)");
    fireEvent.change(input, { target: { value: "0" } });
    await waitFor(() => expect(lastRecall().staleThresholdDays).toBe(1));
  });

  it("legacy 'google' provider displays as Gemini and writes 'gemini' on change", async () => {
    mountEnabled({ enricherProvider: "google", enricherModel: "gemini-3.1-flash-lite" });
    render(<RecallTab />);
    const select = (await screen.findByLabelText(
      "Enricher provider",
    )) as HTMLSelectElement;
    // Self-heals on display: the legacy "google" shows as the gemini option.
    expect(select.value).toBe("gemini");

    // Changing the model writes the canonical provider id back.
    const model = screen.getByLabelText("Enricher model");
    fireEvent.change(model, { target: { value: "gemini-3.5-flash" } });
    await waitFor(() => expect(lastRecall().enricherModel).toBe("gemini-3.5-flash"));
  });

  it("every update_settings carries the full recall object", async () => {
    mountEnabled();
    render(<RecallTab />);
    const input = await screen.findByLabelText("Token budget per brief");
    fireEvent.change(input, { target: { value: "3000" } });
    await waitFor(() => {
      const recall = lastRecall();
      // Sibling fields preserved, not dropped by a partial write.
      expect(recall.tokenBudgetPerBrief).toBe(3000);
      expect(recall.mode).toBe("suggested");
      expect(recall.harvesterProvider).toBe("google");
      expect(recall.staleThresholdDays).toBe(30);
    });
  });
});
