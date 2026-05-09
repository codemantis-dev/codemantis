import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Capability } from "../../types/preflight";

const { mockInvokes } = vi.hoisted(() => ({
  mockInvokes: {
    storeSecret: vi.fn(),
    verifyOne: vi.fn(),
  },
}));

vi.mock("../../lib/tauri-commands", () => ({
  preflightStoreSecret: mockInvokes.storeSecret,
  preflightVerifyOne: mockInvokes.verifyOne,
  preflightLoadManifest: vi.fn(),
  preflightStatus: vi.fn(),
  preflightVerifyAll: vi.fn(),
  preflightRunAutoInstall: vi.fn(),
  preflightDetectExisting: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import SetupFlowModal, { type SetupFlowDefinition } from "./SetupFlowModal";

function aCap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "C-1",
    catalogRef: "x.y",
    name: "Stripe Secret Key",
    category: "guided_human",
    purpose: "Charges",
    sessionsRequiring: [],
    verification: { kind: "secret_present", key: "k" },
    required: true,
    blocksSelfDrive: true,
    detectionHints: { envVars: [] },
    ...overrides,
  };
}

function aFlow(): SetupFlowDefinition {
  return {
    capability: aCap(),
    serviceName: "Stripe",
    steps: [
      { id: 1, title: "Open the dashboard", action: { kind: "open_url", url: "https://x" } },
      {
        id: 2,
        title: "Paste your secret key",
        action: { kind: "paste_and_verify" },
      },
    ],
  };
}

beforeEach(() => {
  Object.values(mockInvokes).forEach((m) => m.mockReset());
});

describe("SetupFlowModal", () => {
  it("does not render content when closed", () => {
    render(
      <SetupFlowModal
        open={false}
        projectPath="/p"
        flow={aFlow()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("Open the dashboard")).not.toBeInTheDocument();
  });

  it("renders the first step's title and stepper segments", () => {
    render(
      <SetupFlowModal
        open
        projectPath="/p"
        flow={aFlow()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Open the dashboard")).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    expect(screen.getAllByTestId("stepper-segment")).toHaveLength(2);
  });

  it("always shows Skip for now", () => {
    render(
      <SetupFlowModal
        open
        projectPath="/p"
        flow={aFlow()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Skip for now/ })).toBeInTheDocument();
  });

  it("Skip for now closes the modal", () => {
    const onClose = vi.fn();
    render(
      <SetupFlowModal
        open
        projectPath="/p"
        flow={aFlow()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("on PasteAndVerify success: stores the secret and runs verify", async () => {
    mockInvokes.storeSecret.mockResolvedValue(undefined);
    mockInvokes.verifyOne.mockResolvedValue({
      projectId: "/p",
      capabilityId: "C-1",
      state: "satisfied",
      lastChecked: 0,
      userAcknowledgedOptionalSkip: false,
    });
    const onClose = vi.fn();
    const onSatisfied = vi.fn();
    const flow: SetupFlowDefinition = {
      capability: aCap(),
      serviceName: "Stripe",
      // Single paste-and-verify step so onSatisfied fires on success.
      steps: [{ id: 1, title: "Paste it", action: { kind: "paste_and_verify" } }],
    };
    render(
      <SetupFlowModal
        open
        projectPath="/p"
        flow={flow}
        onClose={onClose}
        onSatisfied={onSatisfied}
      />,
    );
    const input = screen.getByPlaceholderText(/Paste the value/);
    fireEvent.change(input, { target: { value: "sk_test_value" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));
    await waitFor(() => expect(mockInvokes.storeSecret).toHaveBeenCalled());
    await waitFor(() => expect(mockInvokes.verifyOne).toHaveBeenCalled());
    await waitFor(() => expect(onSatisfied).toHaveBeenCalled(), { timeout: 1500 });
  });

  it("on PasteAndVerify rejection: surfaces the failure (no advance)", async () => {
    mockInvokes.storeSecret.mockResolvedValue(undefined);
    mockInvokes.verifyOne.mockResolvedValue({
      projectId: "/p",
      capabilityId: "C-1",
      state: "missing",
      lastChecked: 0,
      message: "API rejected the key",
      userAcknowledgedOptionalSkip: false,
    });
    const onSatisfied = vi.fn();
    const flow: SetupFlowDefinition = {
      capability: aCap(),
      serviceName: "Stripe",
      steps: [{ id: 1, title: "Paste it", action: { kind: "paste_and_verify" } }],
    };
    render(
      <SetupFlowModal
        open
        projectPath="/p"
        flow={flow}
        onClose={() => {}}
        onSatisfied={onSatisfied}
      />,
    );
    const input = screen.getByPlaceholderText(/Paste the value/);
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));
    await waitFor(() =>
      expect(screen.getByText(/API rejected the key/)).toBeInTheDocument(),
    );
    expect(onSatisfied).not.toHaveBeenCalled();
  });

  it("renders AiGeneratedBanner when the flow says aiGenerated", () => {
    const flow = aFlow();
    flow.aiGenerated = true;
    render(
      <SetupFlowModal open projectPath="/p" flow={flow} onClose={() => {}} />,
    );
    expect(screen.getByText(/AI-generated guidance/i)).toBeInTheDocument();
  });
});
