import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MissionControl, { type CatalogResolution } from "./MissionControl";
import { usePreflightStore } from "../../stores/preflightStore";
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
  beforeEach(() => {
    // Inject no-op store actions so card buttons don't reach Tauri invoke.
    usePreflightStore.setState({
      verifyOne: vi.fn(() => Promise.resolve()),
      acknowledgeSkip: vi.fn(() => Promise.resolve()),
    });
  });

  it("renders the project name in the header", () => {
    render(
      <MissionControl
        manifest={aManifest([aCap("C", "guided_human")])}
        status={null}
        projectPath="/p"
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
        projectPath="/p"
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
        projectPath="/p"
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
        projectPath="/p"
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
        projectPath="/p"
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    const band = screen.getByTestId("status-band");
    expect(band.textContent).toMatch(/1\s*\/\s*3 ready/);
    expect(band.textContent).toMatch(/2 to set up/);
  });

  it("re-checks a capability via the store when Re-check is clicked", () => {
    const verifyOne = vi.fn(() => Promise.resolve());
    usePreflightStore.setState({ verifyOne });
    render(
      <MissionControl
        manifest={aManifest([aCap("C", "guided_human")])}
        status={null}
        projectPath="/p"
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Re-check/ }));
    expect(verifyOne).toHaveBeenCalledWith("/p", "C");
  });

  it("skips an optional capability via the store when Skip is clicked", () => {
    const acknowledgeSkip = vi.fn(() => Promise.resolve());
    usePreflightStore.setState({ acknowledgeSkip });
    render(
      <MissionControl
        manifest={aManifest([aCap("Opt", "guided_human", { required: false })])}
        status={aStatus([
          {
            projectId: "p",
            capabilityId: "Opt",
            state: "missing",
            lastChecked: 0,
            userAcknowledgedOptionalSkip: false,
          },
        ])}
        projectPath="/p"
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(acknowledgeSkip).toHaveBeenCalledWith("/p", "Opt");
  });

  it("shows manual guidance derived from the capability's verification", () => {
    render(
      <MissionControl
        manifest={aManifest([
          aCap("C", "guided_human", {
            verification: { kind: "env_var_present", varName: "STRIPE_KEY" },
          }),
        ])}
        status={null}
        projectPath="/p"
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
      />,
    );
    expect(screen.getByTestId("capability-guidance")).toHaveTextContent(/STRIPE_KEY/);
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
        projectPath="/p"
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
        projectPath="/p"
        onStartBuilding={() => {}}
        resolveCatalog={noopResolver}
        onMount={onMount}
      />,
    );
    expect(onMount).toHaveBeenCalledOnce();
  });
});
