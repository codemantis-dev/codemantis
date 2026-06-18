import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  CapabilityStatus,
  Manifest,
  PreflightStatus,
} from "../types/preflight";

// ── Hoisted mocks for the Tauri command wrappers ──────────────────────

const { mockInvokes } = vi.hoisted(() => ({
  mockInvokes: {
    loadManifest: vi.fn(),
    status: vi.fn(),
    verifyAll: vi.fn(),
    verifyOne: vi.fn(),
    storeSecret: vi.fn(),
    runAutoInstall: vi.fn(),
    detectExisting: vi.fn(),
    acknowledgeSkip: vi.fn(),
  },
}));

vi.mock("../lib/tauri-commands", () => ({
  preflightLoadManifest: mockInvokes.loadManifest,
  preflightStatus: mockInvokes.status,
  preflightVerifyAll: mockInvokes.verifyAll,
  preflightVerifyOne: mockInvokes.verifyOne,
  preflightStoreSecret: mockInvokes.storeSecret,
  preflightRunAutoInstall: mockInvokes.runAutoInstall,
  preflightDetectExisting: mockInvokes.detectExisting,
  preflightAcknowledgeSkip: mockInvokes.acknowledgeSkip,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import {
  usePreflightStore,
  selectAllSatisfied,
  selectBlockingMissing,
} from "./preflightStore";

function aManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: "1.0",
    project: "test",
    capabilities: [
      {
        id: "C-blocking",
        catalogRef: "x.y",
        name: "Blocking cap",
        category: "guided_human",
        sessionsRequiring: [],
        verification: { kind: "secret_present", key: "k" },
        required: true,
        blocksSelfDrive: true,
        detectionHints: { envVars: [] },
      },
      {
        id: "C-optional",
        catalogRef: "x.z",
        name: "Optional cap",
        category: "guided_human",
        sessionsRequiring: [],
        verification: { kind: "secret_present", key: "k" },
        required: false,
        blocksSelfDrive: false,
        detectionHints: { envVars: [] },
      },
    ],
    ...overrides,
  };
}

function aStatus(caps: CapabilityStatus[]): PreflightStatus {
  return {
    projectId: "p",
    allSatisfied: caps.every((c) => c.state === "satisfied"),
    blockingCount: 1,
    optionalCount: 1,
    capabilities: caps,
  };
}

function aCapStatus(
  capabilityId: string,
  state: CapabilityStatus["state"],
  ack = false,
): CapabilityStatus {
  return {
    projectId: "p",
    capabilityId,
    state,
    lastChecked: 0,
    userAcknowledgedOptionalSkip: ack,
  };
}

beforeEach(() => {
  usePreflightStore.getState().reset();
  Object.values(mockInvokes).forEach((fn) => fn.mockReset());
});

describe("preflightStore selectors", () => {
  it("selectAllSatisfied returns true when status is null (no manifest = no gate)", () => {
    expect(selectAllSatisfied(usePreflightStore.getState())).toBe(true);
  });

  it("selectAllSatisfied reflects status.allSatisfied", () => {
    usePreflightStore.setState({
      status: aStatus([
        aCapStatus("C-blocking", "satisfied"),
        aCapStatus("C-optional", "missing"),
      ]),
    });
    // allSatisfied is computed by the BACKEND, not derived in the selector.
    // The selector just reads the field.
    expect(selectAllSatisfied(usePreflightStore.getState())).toBe(false);
  });

  it("selectBlockingMissing surfaces only blocking, non-acknowledged, non-satisfied", () => {
    usePreflightStore.setState({
      manifest: aManifest(),
      status: aStatus([
        aCapStatus("C-blocking", "missing"),
        aCapStatus("C-optional", "missing"),
      ]),
    });
    const blocking = selectBlockingMissing(usePreflightStore.getState());
    expect(blocking).toHaveLength(1);
    expect(blocking[0].capabilityId).toBe("C-blocking");
  });

  it("selectBlockingMissing filters out acknowledged-skip even when blocking", () => {
    usePreflightStore.setState({
      manifest: aManifest(),
      status: aStatus([aCapStatus("C-blocking", "missing", true)]),
    });
    expect(selectBlockingMissing(usePreflightStore.getState())).toHaveLength(0);
  });

  it("selectBlockingMissing returns empty when no manifest is loaded", () => {
    usePreflightStore.setState({
      status: aStatus([aCapStatus("C-blocking", "missing")]),
    });
    expect(selectBlockingMissing(usePreflightStore.getState())).toEqual([]);
  });
});

describe("preflightStore actions", () => {
  it("loadManifest stores the returned manifest", async () => {
    const m = aManifest();
    mockInvokes.loadManifest.mockResolvedValue(m);
    await usePreflightStore.getState().loadManifest("/path");
    expect(usePreflightStore.getState().manifest).toEqual(m);
  });

  it("loadManifest clears manifest on failure (legacy projects)", async () => {
    mockInvokes.loadManifest.mockRejectedValue(new Error("no preflight.yaml"));
    usePreflightStore.setState({ manifest: aManifest() });
    await usePreflightStore.getState().loadManifest("/path");
    expect(usePreflightStore.getState().manifest).toBeNull();
  });

  it("startSetupFlow / closeSetupFlow toggle activeFlowCapabilityId", () => {
    usePreflightStore.getState().startSetupFlow("C-blocking");
    expect(usePreflightStore.getState().activeFlowCapabilityId).toBe("C-blocking");
    usePreflightStore.getState().closeSetupFlow();
    expect(usePreflightStore.getState().activeFlowCapabilityId).toBeNull();
  });

  it("acknowledgeDetectionHit removes only the matching hit", () => {
    usePreflightStore.setState({
      pendingDetectionHits: [
        { capabilityId: "A", source: "env_var", confidence: 0.9 },
        { capabilityId: "B", source: "env_var", confidence: 0.9 },
      ],
    });
    usePreflightStore.getState().acknowledgeDetectionHit("A");
    const hits = usePreflightStore.getState().pendingDetectionHits;
    expect(hits).toHaveLength(1);
    expect(hits[0].capabilityId).toBe("B");
  });

  it("storeSecret forwards arguments to the Tauri command", async () => {
    mockInvokes.storeSecret.mockResolvedValue(undefined);
    await usePreflightStore.getState().storeSecret("/p", "C", "secret");
    expect(mockInvokes.storeSecret).toHaveBeenCalledWith("/p", "C", "secret");
  });

  it("detectExisting populates pendingDetectionHits from the response", async () => {
    mockInvokes.detectExisting.mockResolvedValue([
      { capabilityId: "X", source: "env_var", confidence: 0.85 },
    ]);
    await usePreflightStore.getState().detectExisting("/p");
    expect(usePreflightStore.getState().pendingDetectionHits).toHaveLength(1);
  });

  it("runAutoInstall initializes an empty progress log for the capability", async () => {
    mockInvokes.runAutoInstall.mockResolvedValue({
      success: true,
      exitCode: 0,
      message: "ok",
    });
    mockInvokes.verifyOne.mockResolvedValue(aCapStatus("C-blocking", "satisfied"));
    mockInvokes.status.mockResolvedValue(
      aStatus([aCapStatus("C-blocking", "satisfied")]),
    );
    await usePreflightStore.getState().runAutoInstall("/p", "C-blocking");
    expect(
      usePreflightStore.getState().installerLogs["C-blocking"],
    ).toBeDefined();
  });

  it("acknowledgeSkip forwards to the command and refreshes status", async () => {
    mockInvokes.acknowledgeSkip.mockResolvedValue(
      aCapStatus("C-optional", "missing", true),
    );
    mockInvokes.status.mockResolvedValue(
      aStatus([aCapStatus("C-optional", "missing", true)]),
    );
    await usePreflightStore.getState().acknowledgeSkip("/p", "C-optional");
    expect(mockInvokes.acknowledgeSkip).toHaveBeenCalledWith("/p", "C-optional");
    // Refreshed → store reflects the persisted skip.
    expect(mockInvokes.status).toHaveBeenCalledWith("/p");
    expect(
      usePreflightStore.getState().status?.capabilities[0]
        .userAcknowledgedOptionalSkip,
    ).toBe(true);
  });

  it("acknowledgeSkip propagates command errors", async () => {
    mockInvokes.acknowledgeSkip.mockRejectedValue(new Error("not in manifest"));
    await expect(
      usePreflightStore.getState().acknowledgeSkip("/p", "nope"),
    ).rejects.toThrow(/not in manifest/);
  });

  it("reset clears all state", () => {
    usePreflightStore.setState({
      manifest: aManifest(),
      activeFlowCapabilityId: "X",
      pendingDetectionHits: [{ capabilityId: "X", source: "env_var", confidence: 1 }],
      installerLogs: { X: ["line"] },
    });
    usePreflightStore.getState().reset();
    const s = usePreflightStore.getState();
    expect(s.manifest).toBeNull();
    expect(s.activeFlowCapabilityId).toBeNull();
    expect(s.pendingDetectionHits).toEqual([]);
    expect(s.installerLogs).toEqual({});
  });
});
