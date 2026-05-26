import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StuckActivityBanner from "./StuckActivityBanner";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import { mockInvoke } from "../../test/helpers/tauri-mock-factory";
import type { Session } from "../../types/session";
import type { AgentId } from "../../types/agent-events";

const SID = "s-banner";

function seedSession(agentId: AgentId | undefined): void {
  const session: Session = {
    id: SID,
    name: "T",
    project_path: "/p",
    status: "connected",
    created_at: "2026-01-01T00:00:00Z",
    model: null,
    icon_index: 0,
    cli_session_id: null,
    agent_id: agentId,
  };
  useSessionStore.getState().addSession(session);
}

describe("StuckActivityBanner", () => {
  beforeEach(() => {
    resetAllStores();
    mockInvoke({ interrupt_session: () => undefined });
  });

  it("renders nothing when the session is not stuck", () => {
    const { container } = render(<StuckActivityBanner sessionId={SID} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a Reopen approval button when reason is pending-approval-not-shown", () => {
    seedSession("claude_code");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/waiting for your approval/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reopen approval/i })).toBeInTheDocument();
  });

  it("renders only Stop session for no-progress (no Reopen button)", () => {
    seedSession("claude_code");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 35_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/hasn't responded for/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reopen approval/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop session/i })).toBeInTheDocument();
  });

  // Regression: stuck banner used to hardcode "Codex" for every agent, so a
  // crash-recovered Claude Code session showed "Codex hasn't responded…".
  // The banner must read `session.agent_id` and label accordingly.
  it("labels a Claude Code session as 'Claude Code' in the no-progress message", () => {
    seedSession("claude_code");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 30_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/Claude Code hasn't responded for/)).toBeInTheDocument();
    expect(screen.queryByText(/Codex hasn't responded/)).not.toBeInTheDocument();
  });

  it("labels a Codex session as 'Codex' in the no-progress message", () => {
    seedSession("codex");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 30_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/Codex hasn't responded for/)).toBeInTheDocument();
    expect(screen.queryByText(/Claude Code hasn't responded/)).not.toBeInTheDocument();
  });

  it("labels Claude Code in the pending-approval message", () => {
    seedSession("claude_code");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(
      screen.getByText(/Claude Code is waiting for your approval/),
    ).toBeInTheDocument();
  });

  it("labels Codex in the pending-approval message", () => {
    seedSession("codex");
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(
      screen.getByText(/Codex is waiting for your approval/),
    ).toBeInTheDocument();
  });

  // Legacy fixtures and pre-Phase-2 sessions can have agent_id undefined;
  // the type contract is "default to claude_code". Render must follow.
  it("defaults to 'Claude Code' when the session has no agent_id field", () => {
    seedSession(undefined);
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 30_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/Claude Code hasn't responded for/)).toBeInTheDocument();
  });

  it("Reopen approval button toggles showApprovalModal", () => {
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    useUiStore.getState().setShowApprovalModal(false);
    render(<StuckActivityBanner sessionId={SID} />);
    fireEvent.click(screen.getByRole("button", { name: /Reopen approval/i }));
    expect(useUiStore.getState().showApprovalModal).toBe(true);
  });

  it("Stop session button calls interrupt_session", async () => {
    let called = false;
    mockInvoke({
      interrupt_session: (args: unknown) => {
        const { sessionId } = args as { sessionId: string };
        if (sessionId === SID) called = true;
        return undefined;
      },
    });
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 35_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Stop session/i }));
    });

    expect(called).toBe(true);
  });
});
