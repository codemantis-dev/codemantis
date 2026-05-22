import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AgentsTab from "./AgentsTab";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useUiStore } from "../../../stores/uiStore";
import { resetAllStores } from "../../../test/helpers/store-reset";

// Both CLIs report installed so the per-task dropdowns aren't disabled.
vi.mock("../../../lib/tauri-commands", async (orig) => {
  const actual = await orig<typeof import("../../../lib/tauri-commands")>();
  return {
    ...actual,
    checkClaudeStatus: vi.fn(() =>
      Promise.resolve({
        installed: true,
        version: "2.1.0",
        parsed_version: "2.1.0",
        latest_version: null,
        min_supported_version: null,
        support: "ok",
        authenticated: true,
        binary_path: "/usr/bin/claude",
      }),
    ),
    checkCodexStatus: vi.fn(() =>
      Promise.resolve({
        installed: true,
        version: "0.130.0",
        parsed_version: "0.130.0",
        authenticated: true,
      }),
    ),
    agentUsageBreakdown: vi.fn(() =>
      Promise.resolve([
        { agentId: "claude_code", sessionCount: 6 },
        { agentId: "codex", sessionCount: 4 },
      ]),
    ),
    updateSettings: vi.fn(() => Promise.resolve()),
  };
});

describe("AgentsTab — per-task defaults (v1.5.0 Phase 1)", () => {
  beforeEach(() => {
    resetAllStores();
    vi.clearAllMocks();
  });

  it("renders a dropdown for every task category", async () => {
    render(<AgentsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("per-task-defaults")).toBeInTheDocument();
    });
    for (const task of ["main_chat", "assistant", "spec_writer", "help"]) {
      expect(screen.getByTestId(`per-task-select-${task}`)).toBeInTheDocument();
    }
  });

  it("each dropdown defaults to 'Use primary' when no override is set", async () => {
    render(<AgentsTab />);
    await waitFor(() => screen.getByTestId("per-task-select-spec_writer"));
    const select = screen.getByTestId("per-task-select-spec_writer") as HTMLSelectElement;
    expect(select.value).toBe("primary");
  });

  it("choosing an agent persists it into defaultAgentByTask", async () => {
    render(<AgentsTab />);
    await waitFor(() => screen.getByTestId("per-task-select-spec_writer"));
    fireEvent.change(screen.getByTestId("per-task-select-spec_writer"), {
      target: { value: "codex" },
    });
    await waitFor(() => {
      expect(
        useSettingsStore.getState().settings.defaultAgentByTask.spec_writer,
      ).toBe("codex");
    });
  });

  it("'Reset to defaults' clears every per-task override", async () => {
    useSettingsStore.setState((s) => ({
      settings: {
        ...s.settings,
        defaultAgentByTask: { spec_writer: "codex", help: "codex" },
      },
    }));
    render(<AgentsTab />);
    await waitFor(() => screen.getByTestId("per-task-reset"));
    fireEvent.click(screen.getByTestId("per-task-reset"));
    await waitFor(() => {
      expect(
        Object.keys(useSettingsStore.getState().settings.defaultAgentByTask),
      ).toHaveLength(0);
    });
  });

  it("selecting 'Use primary' removes the category from the override map", async () => {
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, defaultAgentByTask: { help: "codex" } },
    }));
    render(<AgentsTab />);
    await waitFor(() => screen.getByTestId("per-task-select-help"));
    fireEvent.change(screen.getByTestId("per-task-select-help"), {
      target: { value: "primary" },
    });
    await waitFor(() => {
      expect(
        useSettingsStore.getState().settings.defaultAgentByTask.help,
      ).toBeUndefined();
    });
  });

  it("shows the agent usage split once the breakdown loads", async () => {
    render(<AgentsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("agent-cost-breakdown")).toBeInTheDocument();
    });
    // 6 claude / 4 codex → 60% / 40%.
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("reflects the current primary agent in the footer note", async () => {
    useUiStore.setState({ selectedAgentId: "codex" });
    render(<AgentsTab />);
    await waitFor(() => screen.getByTestId("per-task-defaults"));
    expect(screen.getByText(/Primary is currently/)).toBeInTheDocument();
  });
});
