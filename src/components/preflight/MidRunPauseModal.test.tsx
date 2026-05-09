import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MidRunPauseModal from "./MidRunPauseModal";

describe("MidRunPauseModal", () => {
  function renderModal(overrides: Partial<Parameters<typeof MidRunPauseModal>[0]> = {}) {
    const props = {
      open: true,
      sessionName: "Subscriptions",
      sessionIndex: 14,
      serviceName: "Stripe",
      reason: undefined as string | undefined,
      onClose: vi.fn(),
      onFixNow: vi.fn(),
      ...overrides,
    };
    render(<MidRunPauseModal {...props} />);
    return props;
  }

  it("does not render when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("mid-run-pause-modal")).not.toBeInTheDocument();
  });

  it("shows the paused-session context (session + service)", () => {
    renderModal();
    expect(screen.getByText(/Self-Drive paused/i)).toBeInTheDocument();
    expect(screen.getByText(/session 14/i)).toBeInTheDocument();
    expect(screen.getByText("Subscriptions")).toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
  });

  it("renders the optional reason when provided", () => {
    renderModal({ reason: "API rejected the key (HTTP 401)" });
    expect(screen.getByText(/HTTP 401/)).toBeInTheDocument();
  });

  it("hides the reason line when reason is empty", () => {
    renderModal();
    expect(screen.queryByText(/HTTP/)).not.toBeInTheDocument();
  });

  it("calls onClose when 'Stay paused' is clicked", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Stay paused/ }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onFixNow).not.toHaveBeenCalled();
  });

  it("calls onFixNow when 'Fix now' is clicked", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Fix now/ }));
    expect(props.onFixNow).toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("close (X) button calls onClose", () => {
    const props = renderModal();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("reassures the user that no work is lost", () => {
    renderModal();
    expect(screen.getByText(/no work is lost/i)).toBeInTheDocument();
  });
});
