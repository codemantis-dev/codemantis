import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

function aStatus(
  state: CapabilityStatus["state"],
  overrides: Partial<CapabilityStatus> = {},
): CapabilityStatus {
  return {
    projectId: "p",
    capabilityId: "C-1",
    state,
    lastChecked: 0,
    userAcknowledgedOptionalSkip: false,
    ...overrides,
  };
}

describe("CapabilityCard", () => {
  it("renders the display name (catalog wins over capability)", () => {
    render(
      <CapabilityCard capability={aCap()} serviceName="Stripe" onRecheck={() => {}} />,
    );
    expect(screen.getByText("Stripe")).toBeInTheDocument();
  });

  it("shows the purpose underneath the name", () => {
    render(
      <CapabilityCard
        capability={aCap({ purpose: "Charges your customers" })}
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByText(/Charges your customers/)).toBeInTheDocument();
  });

  it("shows manual guidance when supplied and not satisfied", () => {
    render(
      <CapabilityCard
        capability={aCap()}
        guidance="Set the STRIPE_KEY environment variable."
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByTestId("capability-guidance")).toHaveTextContent(
      /STRIPE_KEY environment variable/,
    );
  });

  it("hides guidance once satisfied", () => {
    render(
      <CapabilityCard
        capability={aCap()}
        status={aStatus("satisfied")}
        guidance="do the thing"
        onRecheck={() => {}}
      />,
    );
    expect(screen.queryByTestId("capability-guidance")).not.toBeInTheDocument();
  });

  it("shows estimated minutes when not yet satisfied", () => {
    render(
      <CapabilityCard capability={aCap()} estimatedMinutes={3} onRecheck={() => {}} />,
    );
    expect(screen.getByText(/About 3 minutes/)).toBeInTheDocument();
  });

  it("hides estimated minutes when already satisfied", () => {
    render(
      <CapabilityCard
        capability={aCap()}
        status={aStatus("satisfied")}
        estimatedMinutes={3}
        onRecheck={() => {}}
      />,
    );
    expect(screen.queryByText(/About 3 minutes/)).not.toBeInTheDocument();
  });

  it("shows an Optional pill for non-required capabilities", () => {
    render(
      <CapabilityCard capability={aCap({ required: false })} onRecheck={() => {}} />,
    );
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("shows a Skipped pill when the capability is acknowledged-skipped", () => {
    render(
      <CapabilityCard
        capability={aCap()}
        status={aStatus("missing", { userAcknowledgedOptionalSkip: true })}
        onRecheck={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText("Skipped")).toBeInTheDocument();
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
        <CapabilityCard capability={aCap()} status={aStatus(state)} onRecheck={() => {}} />,
      );
      // Query inside the pill so the "Re-check" button doesn't collide with the
      // "stale" state's "Re-check" pill label.
      expect(within(screen.getByTestId("status-pill")).getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("calls onRecheck when the Re-check button is clicked", () => {
    const onRecheck = vi.fn();
    render(<CapabilityCard capability={aCap()} onRecheck={onRecheck} />);
    fireEvent.click(screen.getByRole("button", { name: /Re-check/ }));
    expect(onRecheck).toHaveBeenCalledOnce();
  });

  it("offers Skip for skippable capabilities and calls onSkip", () => {
    const onSkip = vi.fn();
    render(
      <CapabilityCard
        capability={aCap({ required: false })}
        status={aStatus("missing")}
        onRecheck={() => {}}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("does not show Skip when onSkip is omitted (hard required+blocking gate)", () => {
    render(
      <CapabilityCard capability={aCap()} status={aStatus("missing")} onRecheck={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /Skip for now/ })).not.toBeInTheDocument();
  });

  it("disables the buttons when busy", () => {
    render(<CapabilityCard capability={aCap()} onRecheck={() => {}} busy />);
    // While busy the label is replaced by a spinner (no accessible name), so
    // assert on the sole button rather than its text.
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
