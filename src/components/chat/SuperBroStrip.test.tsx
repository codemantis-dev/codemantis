import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Mock } from "vitest";
import SuperBroStrip from "./SuperBroStrip";

// ── Mocks ────────────────────────────────────────────────────────────
const { superBroGetState } = vi.hoisted(() => ({
  superBroGetState: vi.fn(),
}));
vi.mock("../../stores/superBroStore", () => ({
  useSuperBroStore: Object.assign(vi.fn(), { getState: superBroGetState }),
}));
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: vi.fn(),
}));
vi.mock("../../stores/sessionStore", () => ({
  useSessionStore: vi.fn(),
}));
vi.mock("../../stores/uiStore", () => ({
  useUiStore: { getState: vi.fn(() => ({ setDraftInput: vi.fn() })) },
}));
vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));
vi.mock("../../lib/tauri-commands", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue(undefined),
}));

import { useSuperBroStore } from "../../stores/superBroStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSessionStore } from "../../stores/sessionStore";

// ── Helpers ──────────────────────────────────────────────────────────
const mockSuperBroStore = useSuperBroStore as unknown as Mock;
const mockSettingsStore = useSettingsStore as unknown as Mock;
const mockSessionStore = useSessionStore as unknown as Mock;

const dismissMock = vi.fn();
const pauseMock = vi.fn();
const resumeMock = vi.fn();
const clearCheckResultMock = vi.fn();

const TEST_PROJECT = "/test/project";

function setupStores(overrides: {
  globalEnabled?: boolean;
  currentMessage?: {
    id: string;
    guidance: string;
    suggestedPrompt: string | null;
    dismissed: boolean;
    trigger: string;
    timestamp: string;
    fileCheckRequest: string | null;
  } | null;
  isThinking?: boolean;
  isPaused?: boolean;
  lastCheckResult?: "all_good" | null;
  activeSessionId?: string | null;
} = {}): void {
  const {
    globalEnabled = true,
    currentMessage = null,
    isThinking = false,
    isPaused = false,
    lastCheckResult = null,
    activeSessionId = "sess-1",
  } = overrides;

  mockSettingsStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ settings: { superBroEnabled: globalEnabled } }),
  );

  const projectMessages = new Map(currentMessage ? [[TEST_PROJECT, currentMessage]] : []);
  const projectThinking = new Map([[TEST_PROJECT, isThinking]]);
  const projectCheckResult = new Map([[TEST_PROJECT, lastCheckResult]]);

  mockSuperBroStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      projectMessages,
      projectThinking,
      projectCheckResult,
      isPaused,
    }),
  );
  superBroGetState.mockReturnValue({
    dismissMessage: dismissMock,
    pause: pauseMock,
    resume: resumeMock,
    clearCheckResult: clearCheckResultMock,
  });

  mockSessionStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeSessionId,
      sessions: new Map(
        activeSessionId ? [[activeSessionId, { project_path: TEST_PROJECT }]] : [],
      ),
    }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────
describe("SuperBroStrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when globalEnabled is false", () => {
    setupStores({ globalEnabled: false });
    const { container } = render(<SuperBroStrip />);
    expect(container.firstChild).toBeNull();
  });

  it("renders idle state with 'watching' text and Pause button", () => {
    setupStores();
    render(<SuperBroStrip />);
    expect(screen.getByText(/watching/)).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
  });

  it("renders paused state with Resume button", () => {
    setupStores({ isPaused: true });
    render(<SuperBroStrip />);
    expect(screen.getByText(/paused/)).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("renders analysing state with spinner", () => {
    setupStores({ isThinking: true });
    render(<SuperBroStrip />);
    expect(screen.getByText("Super-Bro · analysing...")).toBeInTheDocument();
  });

  it("renders all good state", () => {
    setupStores({ lastCheckResult: "all_good" });
    render(<SuperBroStrip />);
    expect(screen.getByText("Super-Bro · all good")).toBeInTheDocument();
  });

  it("renders active message with guidance text", () => {
    setupStores({
      currentMessage: {
        id: "msg-1",
        guidance: "Consider adding error handling here.",
        suggestedPrompt: null,
        dismissed: false,
        trigger: "claude_response",
        timestamp: new Date().toISOString(),
        fileCheckRequest: null,
      },
    });
    render(<SuperBroStrip />);
    expect(
      screen.getByText("Consider adding error handling here."),
    ).toBeInTheDocument();
  });

  it("shows suggested prompt block when suggestedPrompt exists", () => {
    setupStores({
      currentMessage: {
        id: "msg-2",
        guidance: "You should refactor this.",
        suggestedPrompt: "Refactor the auth module to use dependency injection",
        dismissed: false,
        trigger: "claude_response",
        timestamp: new Date().toISOString(),
        fileCheckRequest: null,
      },
    });
    render(<SuperBroStrip />);
    expect(
      screen.getByText("Refactor the auth module to use dependency injection"),
    ).toBeInTheDocument();
  });

  it("shows Copy, Send, Send & Execute buttons ONLY when suggestedPrompt exists", () => {
    setupStores({
      currentMessage: {
        id: "msg-3",
        guidance: "Suggestion available.",
        suggestedPrompt: "Run the linter",
        dismissed: false,
        trigger: "build_error",
        timestamp: new Date().toISOString(),
        fileCheckRequest: null,
      },
    });
    render(<SuperBroStrip />);
    expect(screen.getByText("Copy Prompt")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
    expect(screen.getByText(/Send.*Execute/)).toBeInTheDocument();
  });

  it("hides prompt buttons when suggestedPrompt is null (only dismiss shown)", () => {
    setupStores({
      currentMessage: {
        id: "msg-4",
        guidance: "Just a note, no prompt.",
        suggestedPrompt: null,
        dismissed: false,
        trigger: "claude_response",
        timestamp: new Date().toISOString(),
        fileCheckRequest: null,
      },
    });
    render(<SuperBroStrip />);
    expect(screen.queryByText("Copy Prompt")).not.toBeInTheDocument();
    expect(screen.queryByText(/Send.*Execute/)).not.toBeInTheDocument();
    // Dismiss button (X icon) should still be present
    expect(screen.getByTitle("Dismiss")).toBeInTheDocument();
  });

  it("dismiss button calls dismissMessage", () => {
    setupStores({
      currentMessage: {
        id: "msg-5",
        guidance: "Dismissable guidance.",
        suggestedPrompt: null,
        dismissed: false,
        trigger: "claude_response",
        timestamp: new Date().toISOString(),
        fileCheckRequest: null,
      },
    });
    render(<SuperBroStrip />);
    fireEvent.click(screen.getByTitle("Dismiss"));
    expect(dismissMock).toHaveBeenCalledOnce();
  });

  it("pause button calls pause()", () => {
    setupStores();
    render(<SuperBroStrip />);
    fireEvent.click(screen.getByText("Pause"));
    expect(pauseMock).toHaveBeenCalledOnce();
  });

  it("shows thinking animation when isThinking", () => {
    setupStores({ isThinking: true });
    render(<SuperBroStrip />);
    expect(screen.getByText("Super-Bro · analysing...")).toBeInTheDocument();
    // Should not show idle "watching" text while thinking
    expect(screen.queryByText(/watching/)).not.toBeInTheDocument();
  });

  it("shows all-good message when checkResult is good", () => {
    setupStores({ lastCheckResult: "all_good" });
    render(<SuperBroStrip />);
    expect(screen.getByText("Super-Bro · all good")).toBeInTheDocument();
    // Should not show thinking or idle state
    expect(screen.queryByText(/watching/)).not.toBeInTheDocument();
    expect(screen.queryByText(/analysing/)).not.toBeInTheDocument();
  });

  it("handles missing message gracefully", () => {
    setupStores({ currentMessage: null });
    render(<SuperBroStrip />);
    // With no current message, the strip should render the idle "watching" state
    expect(screen.getByText(/watching/)).toBeInTheDocument();
    // Should not show any guidance text
    expect(screen.queryByText("Consider adding error handling here.")).not.toBeInTheDocument();
  });

  it("renders idle state when no active session", () => {
    setupStores({ activeSessionId: null });
    render(<SuperBroStrip />);
    // With no active session, the strip still renders the idle "watching" state
    expect(screen.getByText(/watching/)).toBeInTheDocument();
  });

  it("resume button calls resume() when paused", () => {
    setupStores({ isPaused: true });
    render(<SuperBroStrip />);
    fireEvent.click(screen.getByText("Resume"));
    expect(resumeMock).toHaveBeenCalledOnce();
  });
});
