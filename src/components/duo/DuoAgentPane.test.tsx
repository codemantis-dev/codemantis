import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockSendMessage = vi.fn();
vi.mock("../../hooks/useClaudeSession", () => ({
  useClaudeSession: () => ({ sendMessage: mockSendMessage }),
}));

import DuoAgentPane from "./DuoAgentPane";
import { useSessionStore } from "../../stores/sessionStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import type { Message, Session } from "../../types/session";

const PRIMARY = "duo-primary";
const MENTOR = "duo-mentor";

function bg(id: string, duoRole: "primary" | "mentor"): Session {
  return {
    id, name: "x", project_path: "/p", status: "connected",
    created_at: "", model: null, icon_index: 0, agent_id: "codex", duoRole,
  };
}
function msg(id: string, role: "user" | "assistant", content: string): Message {
  return { id, role, content, timestamp: "", activityIds: [], isStreaming: false };
}

describe("DuoAgentPane", () => {
  beforeEach(() => {
    resetAllStores();
    mockSendMessage.mockClear();
    useSessionStore.getState().registerBackgroundSession(bg(PRIMARY, "primary"));
    useSessionStore.getState().registerBackgroundSession(bg(MENTOR, "mentor"));
  });

  it("renders the session's transcript", () => {
    useSessionStore.setState((s) => {
      const m = new Map(s.sessionMessages);
      m.set(PRIMARY, [msg("a1", "assistant", "I added the logout button")]);
      return { sessionMessages: m };
    });
    render(<DuoAgentPane sessionId={PRIMARY} role="primary" />);
    expect(screen.getByText("I added the logout button")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    // The coding agent name is shown next to the role (registered as codex above).
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("primary pane has an input that sends to its session id", () => {
    render(<DuoAgentPane sessionId={PRIMARY} role="primary" />);
    const input = screen.getByLabelText("Message the primary agent");
    fireEvent.change(input, { target: { value: "focus on error handling" } });
    fireEvent.click(screen.getByLabelText("Send to primary"));
    expect(mockSendMessage).toHaveBeenCalledWith(PRIMARY, "focus on error handling");
  });

  it("mentor pane is read-only (no input) and labeled", () => {
    render(<DuoAgentPane sessionId={MENTOR} role="mentor" />);
    expect(screen.getByText("Mentor")).toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Message the primary agent")).not.toBeInTheDocument();
  });
});
