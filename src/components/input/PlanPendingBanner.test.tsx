import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";

// Mock the plan-actions helper so we can assert the Implement button
// invokes it without actually hitting the sendMessage IPC.
vi.mock("../../lib/plan-actions", () => ({
  implementPendingPlan: vi.fn().mockResolvedValue(undefined),
}));

import PlanPendingBanner from "./PlanPendingBanner";
import { implementPendingPlan } from "../../lib/plan-actions";

const SESSION_ID = "session-abc";

function seedBannerReady(): void {
  useSessionStore.setState({ activeSessionId: SESSION_ID });
  useUiStore.setState({
    showPlanCompleteModal: false,
    pendingPlanSessionId: SESSION_ID,
    planCompleteSessionId: SESSION_ID,
    planCompleteFilePath: "/Users/hr/.claude/plans/demo.md",
    planCompleteContent: "## body",
  });
}

describe("PlanPendingBanner", () => {
  // Preserve the real store actions across tests (same pattern as PlanCompleteModal.test).
  const realSetShowPlanCompleteModal = useUiStore.getState().setShowPlanCompleteModal;
  const realClearPendingPlan = useUiStore.getState().clearPendingPlan;

  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      showPlanCompleteModal: false,
      planCompleteSessionId: null,
      planCompleteFilePath: null,
      planCompleteContent: null,
      pendingPlanSessionId: null,
      setShowPlanCompleteModal: realSetShowPlanCompleteModal,
      clearPendingPlan: realClearPendingPlan,
    });
    useSessionStore.setState({ activeSessionId: null });
  });

  it("renders nothing when pendingPlanSessionId is null", () => {
    useSessionStore.setState({ activeSessionId: SESSION_ID });
    const { container } = render(<PlanPendingBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when pendingPlanSessionId does not match activeSessionId", () => {
    useSessionStore.setState({ activeSessionId: "other-session" });
    useUiStore.setState({ pendingPlanSessionId: SESSION_ID });
    const { container } = render(<PlanPendingBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the approval modal is already open", () => {
    seedBannerReady();
    useUiStore.setState({ showPlanCompleteModal: true });
    const { container } = render(<PlanPendingBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the banner and plan filename when pending matches active", () => {
    seedBannerReady();
    render(<PlanPendingBanner />);

    expect(screen.getByText("Plan ready to implement")).toBeInTheDocument();
    expect(screen.getByText("demo.md")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
  });

  it("renders without filename when planCompleteFilePath is null", () => {
    seedBannerReady();
    useUiStore.setState({ planCompleteFilePath: null });
    render(<PlanPendingBanner />);

    expect(screen.getByText("Plan ready to implement")).toBeInTheDocument();
    expect(screen.queryByText("demo.md")).not.toBeInTheDocument();
  });

  it("Review reopens the approval modal", () => {
    seedBannerReady();
    render(<PlanPendingBanner />);

    fireEvent.click(screen.getByText("Review"));

    expect(useUiStore.getState().showPlanCompleteModal).toBe(true);
    // Pending state remains so the modal renders its content.
    expect(useUiStore.getState().pendingPlanSessionId).toBe(SESSION_ID);
  });

  it("Implement dispatches implementPendingPlan with autoAccept=false", () => {
    seedBannerReady();
    render(<PlanPendingBanner />);

    fireEvent.click(screen.getByText("Implement"));

    expect(implementPendingPlan).toHaveBeenCalledWith(SESSION_ID, false);
  });

  it("× dismiss clears the pending plan state", () => {
    seedBannerReady();
    render(<PlanPendingBanner />);

    fireEvent.click(screen.getByLabelText("Dismiss pending plan"));

    const s = useUiStore.getState();
    expect(s.pendingPlanSessionId).toBeNull();
    expect(s.planCompleteSessionId).toBeNull();
    expect(s.planCompleteFilePath).toBeNull();
    expect(s.planCompleteContent).toBeNull();
    expect(s.showPlanCompleteModal).toBe(false);
  });
});
