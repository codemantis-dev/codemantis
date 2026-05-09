import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PreflightTray from "./PreflightTray";
import type { CapabilityStatus, PreflightStatus } from "../../types/preflight";

function aStatus(caps: CapabilityStatus[]): PreflightStatus {
  return {
    projectId: "p",
    allSatisfied: caps.every((c) => c.state === "satisfied"),
    blockingCount: caps.filter((c) => c.state !== "satisfied").length,
    optionalCount: 0,
    capabilities: caps,
  };
}

function aCapStatus(id: string, state: CapabilityStatus["state"]): CapabilityStatus {
  return {
    projectId: "p",
    capabilityId: id,
    state,
    lastChecked: 0,
    userAcknowledgedOptionalSkip: false,
  };
}

describe("PreflightTray", () => {
  it("does not render when there's no status and no pause", () => {
    const { container } = render(
      <PreflightTray status={null} onOpenMissionControl={() => {}} />,
    );
    expect(container.querySelector("[data-testid='preflight-tray']")).toBeNull();
  });

  it("shows the green ready state when everything is satisfied", () => {
    render(
      <PreflightTray
        status={aStatus([
          aCapStatus("A", "satisfied"),
          aCapStatus("B", "satisfied"),
        ])}
        onOpenMissionControl={() => {}}
      />,
    );
    const tray = screen.getByTestId("preflight-tray");
    expect(tray.getAttribute("data-mode")).toBe("ready");
    expect(tray.textContent).toContain("2/2 ready");
  });

  it("shows the yellow attention state with count of missing", () => {
    render(
      <PreflightTray
        status={aStatus([
          aCapStatus("A", "satisfied"),
          aCapStatus("B", "missing"),
          aCapStatus("C", "missing"),
        ])}
        onOpenMissionControl={() => {}}
      />,
    );
    const tray = screen.getByTestId("preflight-tray");
    expect(tray.getAttribute("data-mode")).toBe("attention");
    expect(tray.textContent).toContain("1/3 ready");
    expect(tray.textContent).toContain("2 need");
  });

  it("uses singular wording when exactly one item needs attention", () => {
    render(
      <PreflightTray
        status={aStatus([
          aCapStatus("A", "satisfied"),
          aCapStatus("B", "missing"),
        ])}
        onOpenMissionControl={() => {}}
      />,
    );
    const tray = screen.getByTestId("preflight-tray");
    expect(tray.textContent).toContain("1 needs");
  });

  it("shows the red paused state when pausedReason is supplied", () => {
    render(
      <PreflightTray
        status={aStatus([aCapStatus("A", "satisfied")])}
        pausedReason={{ capabilityName: "Stripe key" }}
        onOpenMissionControl={() => {}}
      />,
    );
    const tray = screen.getByTestId("preflight-tray");
    expect(tray.getAttribute("data-mode")).toBe("paused");
    expect(tray.textContent).toContain("Stripe key");
    expect(tray.textContent).toContain("Self-Drive paused");
  });

  it("button label is 'View Mission Control' in normal mode", () => {
    render(
      <PreflightTray
        status={aStatus([aCapStatus("A", "missing")])}
        onOpenMissionControl={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /View Mission Control/ }),
    ).toBeInTheDocument();
  });

  it("button label is 'Fix now' in paused mode", () => {
    render(
      <PreflightTray
        status={null}
        pausedReason={{ capabilityName: "X" }}
        onOpenMissionControl={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Fix now/ })).toBeInTheDocument();
  });

  it("calls onOpenMissionControl when the button is clicked", () => {
    const onOpen = vi.fn();
    render(
      <PreflightTray
        status={aStatus([aCapStatus("A", "missing")])}
        onOpenMissionControl={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
