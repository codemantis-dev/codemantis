import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MissionControl, { type CatalogResolution } from "./MissionControl";
import type {
  Capability,
  CapabilityStatus,
  Manifest,
  PreflightStatus,
} from "../../types/preflight";

function aCap(
  id: string,
  category: Capability["category"],
  overrides: Partial<Capability> = {},
): Capability {
  return {
    id,
    catalogRef: `${id}.ref`,
    name: id,
    category,
    sessionsRequiring: [],
    verification: { kind: "secret_present", key: id },
    required: true,
    blocksSelfDrive: true,
    detectionHints: { envVars: [] },
    ...overrides,
  };
}

function aManifest(caps: Capability[]): Manifest {
  return {
    schemaVersion: "1.0",
    project: "Atikon",
    capabilities: caps,
  };
}

function aStatus(caps: CapabilityStatus[]): PreflightStatus {
  return {
    projectId: "p",
    allSatisfied: caps.every((c) => c.state === "satisfied"),
    blockingCount: 0,
    optionalCount: 0,
    capabilities: caps,
  };
}

const noopResolver = (_: string): CatalogResolution | null => null;

describe("MissionControl", () => {
  it("renders the project name in the header", () => {
    render(
      <MissionControl
        manifest={aManifest([aCap("C", "guided_human")])}
        status={null}
        onSetUp={() => {}}
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    expect(screen.getByText(/Atikon/)).toBeInTheDocument();
  });

  it("disables Start Building when not all satisfied", () => {
    render(
      <MissionControl
        manifest={aManifest([aCap("C", "guided_human")])}
        status={aStatus([
          {
            projectId: "p",
            capabilityId: "C",
            state: "missing",
            lastChecked: 0,
            userAcknowledgedOptionalSkip: false,
          },
        ])}
        onSetUp={() => {}}
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    const btn = screen.getByRole("button", { name: /Start Building/ });
    expect(btn).toBeDisabled();
  });

  it("enables Start Building when allSatisfied is true", () => {
    const onStart = vi.fn();
    render(
      <MissionControl
        manifest={aManifest([aCap("C", "guided_human")])}
        status={{
          projectId: "p",
          allSatisfied: true,
          blockingCount: 0,
          optionalCount: 0,
          capabilities: [
            {
              projectId: "p",
              capabilityId: "C",
              state: "satisfied",
              lastChecked: 0,
              userAcknowledgedOptionalSkip: false,
            },
          ],
        }}
        onSetUp={() => {}}
        onStartBuilding={onStart}
        resolveCatalog={noopResolver}
      />,
    );
    const btn = screen.getByRole("button", { name: /Start Building/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("groups capabilities into the right sections", () => {
    render(
      <MissionControl
        manifest={aManifest([
          aCap("Q", "auto_resolvable"),
          aCap("A", "guided_human"),
          aCap("D", "pre_existing_detection"),
          aCap("Opt", "guided_human", { required: false }),
        ])}
        status={null}
        onSetUp={() => {}}
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    const sectionTitles = screen
      .getAllByTestId("cap-section")
      .map((el) => el.getAttribute("data-section-title"));
    expect(sectionTitles).toContain("Quick installs");
    expect(sectionTitles).toContain("Accounts & keys");
    expect(sectionTitles).toContain("Already on your system");
    expect(sectionTitles).toContain("Optional");
  });

  it("shows the X of Y ready summary correctly", () => {
    render(
      <MissionControl
        manifest={aManifest([
          aCap("A", "guided_human"),
          aCap("B", "guided_human"),
          aCap("C", "guided_human"),
        ])}
        status={aStatus([
          {
            projectId: "p",
            capabilityId: "A",
            state: "satisfied",
            lastChecked: 0,
            userAcknowledgedOptionalSkip: false,
          },
          {
            projectId: "p",
            capabilityId: "B",
            state: "missing",
            lastChecked: 0,
            userAcknowledgedOptionalSkip: false,
          },
          {
            projectId: "p",
            capabilityId: "C",
            state: "missing",
            lastChecked: 0,
            userAcknowledgedOptionalSkip: false,
          },
        ])}
        onSetUp={() => {}}
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    const band = screen.getByTestId("status-band");
    expect(band.textContent).toMatch(/1\s*\/\s*3 ready/);
    expect(band.textContent).toMatch(/2 to set up/);
  });

  it("calls onSetUp when a card's action is clicked", () => {
    const onSetUp = vi.fn();
    render(
      <MissionControl
        manifest={aManifest([aCap("C", "guided_human")])}
        status={null}
        onSetUp={onSetUp}
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Set up/ }));
    expect(onSetUp).toHaveBeenCalledOnce();
    expect(onSetUp.mock.calls[0][0].id).toBe("C");
  });

  it("uses catalog resolution to render service-friendly names", () => {
    const resolver = (ref: string): CatalogResolution | null =>
      ref === "C.ref"
        ? { serviceName: "Stripe", serviceCategory: "payments", estimatedMinutes: 3 }
        : null;
    render(
      <MissionControl
        manifest={aManifest([aCap("C", "guided_human")])}
        status={null}
        onSetUp={() => {}}
        onStartBuilding={() => {}}
        resolveCatalog={resolver}
      />,
    );
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText(/About 3 minutes/)).toBeInTheDocument();
  });

  it("fires onMount once when supplied", () => {
    const onMount = vi.fn();
    render(
      <MissionControl
        manifest={aManifest([aCap("C", "guided_human")])}
        status={null}
        onSetUp={() => {}}
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
        onMount={onMount}
      />,
    );
    expect(onMount).toHaveBeenCalledOnce();
  });
});
