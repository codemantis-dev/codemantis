import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import CodexPlanToggle from "./CodexPlanToggle";
import { useSessionStore } from "../../stores/sessionStore";
import { resetAllStores } from "../../test/helpers/store-reset";

describe("CodexPlanToggle", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("renders inactive by default (no plan mode)", () => {
    render(<CodexPlanToggle sessionId="s1" commit={vi.fn(() => Promise.resolve())} />);
    const btn = screen.getByTestId("codex-plan-toggle");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("reflects active state when the session is in plan mode", () => {
    useSessionStore.getState().setSessionMode("s1", "plan");
    render(<CodexPlanToggle sessionId="s1" commit={vi.fn(() => Promise.resolve())} />);
    expect(screen.getByTestId("codex-plan-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("enables plan mode optimistically and commits via IPC", async () => {
    const commit = vi.fn(() => Promise.resolve());
    render(<CodexPlanToggle sessionId="s1" commit={commit} />);
    fireEvent.click(screen.getByTestId("codex-plan-toggle"));
    // Optimistic local flip.
    expect(useSessionStore.getState().sessionModes.get("s1")).toBe("plan");
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith("s1", true);
    });
  });

  it("toggles plan mode off when already active", async () => {
    const commit = vi.fn(() => Promise.resolve());
    useSessionStore.getState().setSessionMode("s1", "plan");
    render(<CodexPlanToggle sessionId="s1" commit={commit} />);
    fireEvent.click(screen.getByTestId("codex-plan-toggle"));
    expect(useSessionStore.getState().sessionModes.get("s1")).toBe("normal");
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith("s1", false);
    });
  });

  it("reverts the optimistic flip when the IPC commit fails", async () => {
    const commit = vi.fn(() => Promise.reject(new Error("boom")));
    render(<CodexPlanToggle sessionId="s1" commit={commit} />);
    fireEvent.click(screen.getByTestId("codex-plan-toggle"));
    // Optimistic on, then reverted to off after rejection.
    await waitFor(() => {
      expect(useSessionStore.getState().sessionModes.get("s1")).toBe("normal");
    });
  });
});
