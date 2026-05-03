import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EffortSelector from "./EffortSelector";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import type { Session } from "../../types/session";
import type { CapabilitiesDiscoveredEvent } from "../../types/claude-events";
import { invoke } from "@tauri-apps/api/core";

const SESSION: Session = {
  id: "s1",
  name: "Test",
  project_path: "/tmp",
  status: "connected",
  created_at: "",
  model: "default",
  icon_index: 0,
};

const DEFAULT_CAPS: CapabilitiesDiscoveredEvent = {
  type: "capabilities_discovered",
  session_id: "s1",
  models: [
    {
      value: "default",
      displayName: "Default",
      description: "Opus 4.7 with 1M context",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      value: "sonnet",
      displayName: "Sonnet",
      description: "Sonnet 4.6",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "max"],
    },
    {
      value: "haiku",
      displayName: "Haiku",
      description: "Haiku 4.5",
    },
  ],
  commands: [],
  agents: [],
  account: null,
  output_styles: [],
};

function seed(opts: {
  model?: string | null;
  effort?: string | null;
  caps?: CapabilitiesDiscoveredEvent;
  busy?: boolean;
  streaming?: boolean;
} = {}): void {
  const session = { ...SESSION, model: opts.model === undefined ? "default" : opts.model };
  useSessionStore.setState({
    sessions: new Map([[session.id, session]]),
    activeSessionId: session.id,
    sessionEffort: opts.effort ? new Map([[session.id, opts.effort]]) : new Map(),
    sessionBusy: new Map([[session.id, opts.busy ?? false]]),
    sessionStreaming: new Map([
      [
        session.id,
        {
          isStreaming: opts.streaming ?? false,
          streamingContent: "",
          currentMessageId: null,
        },
      ],
    ]),
    tabOrder: [session.id],
  });
  if (opts.caps !== undefined) {
    useSessionStore.getState().setSessionCapabilities(session.id, opts.caps);
  } else {
    useSessionStore.getState().setSessionCapabilities(session.id, DEFAULT_CAPS);
  }
}

describe("EffortSelector", () => {
  beforeEach(() => {
    resetAllStores();
    // resetAllStores leaves settingsStore.settings intact, so explicitly
    // null out defaultThinkingEffort to keep tests isolated from each
    // other (a prior test may have persisted "low" and would otherwise
    // bleed into the next test's persistedDefault, which changes which
    // dropdown option is the "no-op" reselection).
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        defaultThinkingEffort: null,
      },
    });
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("renders nothing without an active session", () => {
    const { container } = render(<EffortSelector />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when capabilities are not yet known", () => {
    useSessionStore.setState({
      sessions: new Map([[SESSION.id, SESSION]]),
      activeSessionId: SESSION.id,
      sessionEffort: new Map(),
      sessionCapabilities: new Map(),
      tabOrder: [SESSION.id],
    });
    const { container } = render(<EffortSelector />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a model that does not support effort (e.g. Haiku)", () => {
    seed({ model: "haiku" });
    const { container } = render(<EffortSelector />);
    expect(container.innerHTML).toBe("");
  });

  it("uses the active model's supportedEffortLevels — Default exposes 5 levels including xhigh", () => {
    seed({ model: "default", effort: "high" });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("XHigh")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
  });

  it("matches the resolved Anthropic model ID (claude-opus-4-7[1m]) against the 'default' manifest entry", () => {
    // The CLI's `system/init` reports the resolved ID — `default` resolves
    // to claude-opus-4-7[1m]. The dropdown must still surface effort levels
    // from the `default` entry instead of hiding itself.
    seed({ model: "claude-opus-4-7[1m]", effort: "high" });
    render(<EffortSelector />);
    expect(screen.getByText("High")).toBeInTheDocument();
    fireEvent.click(screen.getByText("High"));
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("XHigh")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
  });

  it("matches the resolved Sonnet model ID against the 'sonnet' manifest entry (4 levels, no xhigh)", () => {
    seed({ model: "claude-sonnet-4-6-20250514", effort: "high" });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.queryByText("XHigh")).not.toBeInTheDocument();
  });

  it("hides the selector when the resolved model ID has no effort-supporting manifest entry (e.g. Haiku)", () => {
    seed({ model: "claude-haiku-4-5-20251001" });
    const { container } = render(<EffortSelector />);
    expect(container.innerHTML).toBe("");
  });

  it("uses the active model's supportedEffortLevels — Sonnet does not expose xhigh", () => {
    seed({ model: "sonnet", effort: "high" });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.queryByText("XHigh")).not.toBeInTheDocument();
  });

  it("badge label reflects the running session's effort, not the persisted default", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, defaultThinkingEffort: "low" },
    });
    seed({ model: "default", effort: "high" });
    render(<EffortSelector />);
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("falls back to the persisted default when the session has not reported its effort yet", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, defaultThinkingEffort: "medium" },
    });
    seed({ model: "default", effort: null });
    render(<EffortSelector />);
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("selecting a level persists defaultThinkingEffort but does not change the running session", async () => {
    seed({ model: "default", effort: "high" });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    fireEvent.click(screen.getByText("Low"));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.defaultThinkingEffort).toBe("low");
    });
    // Running session's effort must NOT change — only spawn-time default does.
    expect(useSessionStore.getState().sessionEffort.get(SESSION.id)).toBe("high");
  });

  it("does not write settings when the user reselects the persisted default", async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, defaultThinkingEffort: "high" },
    });
    seed({ model: "default", effort: "high" });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    const allHighs = screen.getAllByText("High");
    fireEvent.click(allHighs[allHighs.length - 1]);
    await waitFor(() => {
      expect(invoke).not.toHaveBeenCalledWith(
        "update_settings",
        expect.objectContaining({
          settings: expect.objectContaining({ defaultThinkingEffort: "high" }),
        }),
      );
    });
  });

  it("does not show a restart button when the persisted default matches the running level", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, defaultThinkingEffort: "high" },
    });
    seed({ model: "default", effort: "high" });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    expect(
      screen.queryByRole("button", { name: /Apply.*now/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a restart button after picking a different level than the running session", async () => {
    seed({ model: "default", effort: "high" });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    expect(screen.getByText("Low")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Low"));
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.defaultThinkingEffort).toBe("low");
    });
    expect(
      screen.getByRole("button", { name: /Apply Low now/i }),
    ).toBeInTheDocument();
  });

  it("restart button calls pause_session_process then resume_session_process and updates the running level", async () => {
    seed({ model: "default", effort: "high" });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    fireEvent.click(screen.getByText("Low"));
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.defaultThinkingEffort).toBe("low"),
    );
    const button = screen.getByRole("button", { name: /Apply Low now/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pause_session_process", { sessionId: SESSION.id });
    });
    expect(invoke).toHaveBeenCalledWith("resume_session_process", {
      sessionId: SESSION.id,
      cliSessionId: undefined,
    });
    await waitFor(() => {
      expect(useSessionStore.getState().sessionEffort.get(SESSION.id)).toBe("low");
    });
  });

  it("restart button is disabled while the session is streaming", async () => {
    seed({ model: "default", effort: "high", streaming: true });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    fireEvent.click(screen.getByText("Low"));
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.defaultThinkingEffort).toBe("low"),
    );
    const button = screen.getByRole("button", { name: /Apply Low now/i });
    const buttonEl = button.closest("button");
    expect(buttonEl).toBeDisabled();
  });

  it("restart button is disabled while the session is busy", async () => {
    seed({ model: "default", effort: "high", busy: true });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    fireEvent.click(screen.getByText("Low"));
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.defaultThinkingEffort).toBe("low"),
    );
    const button = screen.getByRole("button", { name: /Apply Low now/i });
    const buttonEl = button.closest("button");
    expect(buttonEl).toBeDisabled();
  });

  it("reverts the running level if the restart fails", async () => {
    seed({ model: "default", effort: "high" });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "resume_session_process") {
        return Promise.reject(new Error("spawn failed"));
      }
      return Promise.resolve(undefined);
    });
    render(<EffortSelector />);
    fireEvent.click(screen.getByText("High"));
    fireEvent.click(screen.getByText("Low"));
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.defaultThinkingEffort).toBe("low"),
    );
    const button = screen.getByRole("button", { name: /Apply Low now/i });
    fireEvent.click(button);
    await waitFor(() => {
      expect(useSessionStore.getState().sessionEffort.get(SESSION.id)).toBe("high");
    });
  });
});
