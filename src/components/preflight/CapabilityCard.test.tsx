import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CapabilityCard from "./CapabilityCard";
import type { Capability, CapabilityStatus } from "../../types/preflight";

function aCap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "C-1",
    catalogRef: "x.y",
    name: "Stripe Secret Key",
    category: "guided_human",
    purpose: "Charges and refunds",
    sessionsRequiring: [],
    verification: { kind: "secret_present", key: "k" },
    required: true,
    blocksSelfDrive: true,
    detectionHints: { envVars: [] },
    ...overrides,
  };
}

function aStatus(state: CapabilityStatus["state"]): CapabilityStatus {
  return {
    projectId: "p",
    capabilityId: "C-1",
    state,
    lastChecked: 0,
    userAcknowledgedOptionalSkip: false,
  };
}

describe("CapabilityCard", () => {
  it("renders the display name (catalog wins over capability)", () => {
    render(
      <CapabilityCard
        capability={aCap()}
        serviceName="Stripe"
        actionLabel="Set up"
        onAction={() => {}}
      />,
    );
    expect(screen.getByText("Stripe")).toBeInTheDocument();
  });

  it("shows the purpose underneath the name", () => {
    render(
      <CapabilityCard
        capability={aCap({ purpose: "Charges your customers" })}
        actionLabel="Set up"
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Charges your customers/)).toBeInTheDocument();
  });

  it("shows estimated minutes when not yet satisfied", () => {
    render(
      <CapabilityCard
        capability={aCap()}
        estimatedMinutes={3}
        actionLabel="Set up"
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/About 3 minutes/)).toBeInTheDocument();
  });

  it("hides estimated minutes when already satisfied", () => {
    render(
      <CapabilityCard
        capability={aCap()}
        status={aStatus("satisfied")}
        estimatedMinutes={3}
        actionLabel="Update"
        onAction={() => {}}
      />,
    );
    expect(screen.queryByText(/About 3 minutes/)).not.toBeInTheDocument();
  });

  it("shows an Optional pill for non-required capabilities", () => {
    render(
      <CapabilityCard
        capability={aCap({ required: false })}
        actionLabel="Set up"
        onAction={() => {}}
      />,
    );
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("renders status pill with state-correct labels", () => {
    const labelByState: Record<CapabilityStatus["state"], string> = {
      satisfied: "Ready",
      detecting: "Checking…",
      auto_installing: "Installing…",
      awaiting_user_action: "Action needed",
      missing: "Needed",
      stale: "Re-check",
      unknown: "Not checked",
    };
    for (const [state, label] of Object.entries(labelByState) as [
      CapabilityStatus["state"],
      string,
    ][]) {
      const { unmount } = render(
        <CapabilityCard
          capability={aCap()}
          status={aStatus(state)}
          actionLabel="Set up"
          onAction={() => {}}
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("calls onAction when the button is clicked", () => {
    const onAction = vi.fn();
    render(
      <CapabilityCard
        capability={aCap()}
        actionLabel="Set up"
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Set up/ }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("disables the button when busy", () => {
    render(
      <CapabilityCard
        capability={aCap()}
        actionLabel="Set up"
        onAction={() => {}}
        busy
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
  });
});
