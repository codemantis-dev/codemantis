import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StuckActivityBanner from "./StuckActivityBanner";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import { mockInvoke } from "../../test/helpers/tauri-mock-factory";

const SID = "s-banner";

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
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now(),
      reason: "pending-approval-not-shown",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/waiting for your approval/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reopen approval/i })).toBeInTheDocument();
  });

  it("renders only Stop session for no-progress (no Reopen button)", () => {
    useSessionStore.getState().setSessionStuck(SID, {
      since: Date.now() - 35_000,
      reason: "no-progress",
    });
    render(<StuckActivityBanner sessionId={SID} />);
    expect(screen.getByText(/hasn't responded for/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reopen approval/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop session/i })).toBeInTheDocument();
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
