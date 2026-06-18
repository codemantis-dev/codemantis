// Focused tests for the Self-Drive pre-run preflight gate.
// Lives in its own file so the existing 3,000-line selfDriveStore.test.ts
// stays readable.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ImplementationGuide } from "../types/implementation-guide";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    preflightStatus: vi.fn(),
    sendMessage: vi.fn(() => Promise.resolve()),
    syncSessionMode: vi.fn(() => Promise.resolve()),
    saveSelfDriveState: vi.fn(() => Promise.resolve()),
    deleteSelfDriveState: vi.fn(() => Promise.resolve()),
    verifyActionParity: vi.fn(() =>
      Promise.resolve({ overallStatus: "PASS", calls: [] }),
    ),
    showToast: vi.fn(),
    callOrchestrator: vi.fn(),
  },
}));

vi.mock("../lib/tauri-commands", () => ({
  sendMessage: mocks.sendMessage,
  syncSessionMode: mocks.syncSessionMode,
  saveGuide: vi.fn(() => Promise.resolve("g-1")),
  loadGuide: vi.fn(() => Promise.resolve(null)),
  updateGuideData: vi.fn(() => Promise.resolve()),
  deleteGuide: vi.fn(() => Promise.resolve()),
  deleteGuidesForProject: vi.fn(() => Promise.resolve()),
  saveSelfDriveState: mocks.saveSelfDriveState,
  loadSelfDriveState: vi.fn(() => Promise.resolve(null)),
  listSelfDriveStates: vi.fn(() => Promise.resolve([])),
  deleteSelfDriveState: mocks.deleteSelfDriveState,
  verifyActionParity: mocks.verifyActionParity,
  preflightStatus: mocks.preflightStatus,

  listenChatEvents: vi.fn(() => Promise.resolve(() => {})),}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../lib/self-drive-orchestrator", () => ({
  callOrchestrator: mocks.callOrchestrator,
}));

vi.mock("./toastStore", () => ({
  showToast: mocks.showToast,
}));

import {
  useSelfDriveStore,
  selectPausedCapability,
  selectPausedSessionContext,
} from "./selfDriveStore";
import { useSessionStore } from "./sessionStore";
import { useGuideStore } from "./guideStore";
import { useSettingsStore } from "./settingsStore";

function aGuide(requires?: string[]): ImplementationGuide {
  return {
    id: "g-1",
    projectPath: "/p",
    title: "Test",
    sessions: [
      {
        index: 1,
        name: "First",
        scope: "Phase 1",
        readSections: "",
        files: [],
        prompt: "Build it",
        verifyChecks: [],
        ...(requires ? { requires } : {}),
        status: "active",
      },
    ],
    techStack: { language: "TypeScript", framework: "React", buildCommand: "pnpm build", testCommand: "pnpm test" },
    isComplete: false,
  } as unknown as ImplementationGuide;
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.preflightStatus.mockReset();
  mocks.sendMessage.mockResolvedValue(undefined);
  mocks.syncSessionMode.mockResolvedValue(undefined);
  mocks.saveSelfDriveState.mockResolvedValue(undefined);
  mocks.verifyActionParity.mockResolvedValue({
    overallStatus: "PASS",
    calls: [],
  });

  // Reset stores
  useSelfDriveStore.setState({ status: "idle", projectPath: null, sessionId: null });
  useSessionStore.setState({
    activeSessionId: "S-1",
    activeProjectPath: "/p",
  } as never);
  useGuideStore.setState({ guide: aGuide() } as never);
  useSettingsStore.setState({
    settings: {
      apiKeys: { anthropic: "sk-ant-test" },
    } as never,
  });
});

function preflightToasts(): string[] {
  return mocks.showToast.mock.calls
    .map((args) => args[0] as string)
    .filter((m) => /setup item/i.test(m) && /Mission Control/.test(m));
}

describe("Self-Drive pre-run preflight gate", () => {
  it("aborts when preflight has unsatisfied blocking capabilities", async () => {
    mocks.preflightStatus.mockResolvedValue({
      projectId: "/p",
      allSatisfied: false,
      blockingCount: 2,
      optionalCount: 0,
      capabilities: [],
    });

    await useSelfDriveStore.getState().start();

    // The run never started — status stayed idle.
    expect(useSelfDriveStore.getState().status).toBe("idle");
    // The user got the preflight-specific toast pointing to Mission Control.
    expect(preflightToasts()).toHaveLength(1);
    expect(preflightToasts()[0]).toMatch(/2 setup items need/);
    // We did NOT proceed to send any prompt.
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("uses singular wording when exactly one item is missing", async () => {
    mocks.preflightStatus.mockResolvedValue({
      projectId: "/p",
      allSatisfied: false,
      blockingCount: 1,
      optionalCount: 0,
      capabilities: [],
    });

    await useSelfDriveStore.getState().start();

    expect(preflightToasts()[0]).toMatch(/1 setup item needs/);
  });

  it("does NOT fire the preflight abort toast when allSatisfied is true", async () => {
    mocks.preflightStatus.mockResolvedValue({
      projectId: "/p",
      allSatisfied: true,
      blockingCount: 0,
      optionalCount: 0,
      capabilities: [],
    });

    await useSelfDriveStore.getState().start();

    // The gate let us through — no preflight abort toast.
    // (Self-Drive may abort later for unrelated reasons in this minimal
    // mock setup, but those toasts won't match our preflight-specific filter.)
    expect(preflightToasts()).toHaveLength(0);
  });

  it("does NOT fire the preflight abort toast when no manifest exists", async () => {
    mocks.preflightStatus.mockRejectedValue(new Error("No preflight.yaml"));

    await useSelfDriveStore.getState().start();

    // Legacy project — preflight gate didn't fire its abort toast.
    expect(preflightToasts()).toHaveLength(0);
  });
});

describe("Self-Drive per-session requires gate", () => {
  beforeEach(() => {
    // The per-session gate runs AFTER the API-key check, so the provider must
    // resolve to a configured key for the run to reach it.
    useSettingsStore.setState({
      settings: {
        apiKeys: { anthropic: "sk-ant-test" },
        selfDriveProvider: "anthropic",
      } as never,
    });
  });

  it("pauses on a session's missing requires even when the project is allSatisfied", async () => {
    // Regression: the whole-project gate reports allSatisfied (the missing cap
    // is non-blocking project-wide), so ONLY a per-session check catches it.
    useGuideStore.setState({ guide: aGuide(["stripe"]) } as never);
    mocks.preflightStatus.mockResolvedValue({
      projectId: "/p",
      allSatisfied: true,
      blockingCount: 0,
      optionalCount: 0,
      capabilities: [
        {
          projectId: "/p",
          capabilityId: "stripe",
          state: "missing",
          lastChecked: 0,
          userAcknowledgedOptionalSkip: false,
        },
      ],
    });

    await useSelfDriveStore.getState().start();

    const s = useSelfDriveStore.getState();
    expect(s.status).toBe("paused");
    expect(s.activeBlocker?.kind).toBe("capability-missing");
    expect(s.activeBlocker?.capabilityId).toBe("stripe");
    // The build prompt was NOT dispatched.
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("proceeds when the session's required capability is satisfied", async () => {
    useGuideStore.setState({ guide: aGuide(["stripe"]) } as never);
    mocks.preflightStatus.mockResolvedValue({
      projectId: "/p",
      allSatisfied: true,
      blockingCount: 0,
      optionalCount: 0,
      capabilities: [
        {
          projectId: "/p",
          capabilityId: "stripe",
          state: "satisfied",
          lastChecked: 0,
          userAcknowledgedOptionalSkip: false,
        },
      ],
    });

    await useSelfDriveStore.getState().start();

    const s = useSelfDriveStore.getState();
    expect(s.status).toBe("running");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("treats a user-acknowledged-skip capability as satisfied", async () => {
    useGuideStore.setState({ guide: aGuide(["analytics"]) } as never);
    mocks.preflightStatus.mockResolvedValue({
      projectId: "/p",
      allSatisfied: true,
      blockingCount: 0,
      optionalCount: 0,
      capabilities: [
        {
          projectId: "/p",
          capabilityId: "analytics",
          state: "missing",
          lastChecked: 0,
          userAcknowledgedOptionalSkip: true,
        },
      ],
    });

    await useSelfDriveStore.getState().start();

    expect(useSelfDriveStore.getState().status).toBe("running");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("passes through when the session declares no requires", async () => {
    useGuideStore.setState({ guide: aGuide() } as never);
    mocks.preflightStatus.mockResolvedValue({
      projectId: "/p",
      allSatisfied: true,
      blockingCount: 0,
      optionalCount: 0,
      capabilities: [],
    });

    await useSelfDriveStore.getState().start();

    expect(useSelfDriveStore.getState().status).toBe("running");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("passes through when the project has no manifest (preflightStatus throws)", async () => {
    useGuideStore.setState({ guide: aGuide(["stripe"]) } as never);
    mocks.preflightStatus.mockRejectedValue(new Error("No preflight.yaml"));

    await useSelfDriveStore.getState().start();

    expect(useSelfDriveStore.getState().status).toBe("running");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("Self-Drive paused-capability selectors", () => {
  it("selectPausedCapability returns the name only when paused on capability-missing", () => {
    expect(
      selectPausedCapability({ status: "running", activeBlocker: null } as never),
    ).toBeNull();

    expect(
      selectPausedCapability({
        status: "paused",
        activeBlocker: { kind: "credentials" },
      } as never),
    ).toBeNull();

    expect(
      selectPausedCapability({
        status: "paused",
        activeBlocker: { kind: "capability-missing", capabilityName: "Stripe" },
      } as never),
    ).toEqual({ capabilityName: "Stripe" });
  });

  it("selectPausedCapability falls back to the id, then a generic label", () => {
    expect(
      selectPausedCapability({
        status: "paused",
        activeBlocker: { kind: "capability-missing", capabilityId: "stripe" },
      } as never),
    ).toEqual({ capabilityName: "stripe" });

    expect(
      selectPausedCapability({
        status: "paused",
        activeBlocker: { kind: "capability-missing" },
      } as never),
    ).toEqual({ capabilityName: "a required capability" });
  });

  it("selectPausedSessionContext resolves the session name from the guide", () => {
    expect(
      selectPausedSessionContext({
        status: "paused",
        currentSessionIndex: 1,
        activeBlocker: { kind: "capability-missing", sessionIndex: 1 },
        guide: { sessions: [{ index: 1, name: "First" }] },
      } as never),
    ).toEqual({ sessionName: "First", sessionIndex: 1 });

    expect(
      selectPausedSessionContext({ status: "running", activeBlocker: null } as never),
    ).toBeNull();
  });
});
