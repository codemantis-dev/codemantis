import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Mock } from "vitest";
import SuperBroStrip from "./SuperBroStrip";

// ── Mocks ────────────────────────────────────────────────────────────
vi.mock("../../stores/superBroStore", () => ({
  useSuperBroStore: vi.fn(),
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
  activeSessionId?: string | null;
} = {}): void {
  const {
    globalEnabled = true,
    currentMessage = null,
    isThinking = false,
    isPaused = false,
    activeSessionId = "sess-1",
  } = overrides;

  mockSettingsStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ settings: { superBroEnabled: globalEnabled } }),
  );

  mockSuperBroStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      currentMessage,
      isThinking,
      isPaused,
      dismissCurrentMessage: dismissMock,
      pause: pauseMock,
      resume: resumeMock,
    }),
  );

  mockSessionStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeSessionId }),
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

  it("renders thinking state with 'Checking...' and spinner", () => {
    setupStores({ isThinking: true });
    render(<SuperBroStrip />);
    expect(screen.getByText("Checking...")).toBeInTheDocument();
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

  it("dismiss button calls dismissCurrentMessage", () => {
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
});
