// ═══════════════════════════════════════════════════════════════════════
// Preflight Store — manifest + capability statuses + active setup flow.
// Subscribes to Rust-emitted Tauri events; mirrors the listen-on-mount
// pattern from selfDriveStore.ts.
// ═══════════════════════════════════════════════════════════════════════

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AllCompletePayload,
  CapabilityStatus,
  DetectionHit,
  DetectionHitPayload,
  InstallerProgressPayload,
  Manifest,
  PreflightStatus,
  VerificationCompletePayload,
  VerificationStartedPayload,
} from "../types/preflight";
import { PREFLIGHT_EVENTS } from "../types/preflight";
import {
  preflightDetectExisting,
  preflightLoadManifest,
  preflightRunAutoInstall,
  preflightStatus as fetchPreflightStatus,
  preflightStoreSecret,
  preflightVerifyAll,
  preflightVerifyOne,
  preflightAcknowledgeSkip,
} from "../lib/tauri-commands";

// ── Module-level event listener handles ────────────────────────────────
// Same pattern as selfDriveStore.ts: stash UnlistenFn here so the listener
// survives store re-renders. The active project_id, in contrast, lives in
// store state — UI navigation must NOT be able to silently retarget it.

const unlisten: UnlistenFn[] = [];
let listenersAttached = false;

interface PreflightState {
  /** Per-project manifest (one project at a time is "active" in the UI). */
  manifest: Manifest | null;
  /** Aggregated status for the active project (capabilities + counts). */
  status: PreflightStatus | null;
  /** Per-capability progress logs from the auto-installer (keyed by capabilityId). */
  installerLogs: Record<string, string[]>;
  /** Detection hits the user hasn't yet confirmed-or-dismissed. */
  pendingDetectionHits: DetectionHit[];
  /** Capability currently being shown in the SetupFlowModal (null = closed). */
  activeFlowCapabilityId: string | null;
  /** Generic loading flag for verify/load operations. */
  isLoading: boolean;

  // ── Actions ──
  loadManifest: (projectPath: string) => Promise<void>;
  refreshStatus: (projectPath: string) => Promise<void>;
  verifyAll: (projectPath: string) => Promise<void>;
  verifyOne: (projectPath: string, capabilityId: string) => Promise<void>;
  acknowledgeSkip: (projectPath: string, capabilityId: string) => Promise<void>;
  storeSecret: (
    projectPath: string,
    capabilityId: string,
    value: string,
  ) => Promise<void>;
  runAutoInstall: (projectPath: string, capabilityId: string) => Promise<void>;
  detectExisting: (projectPath: string) => Promise<void>;
  acknowledgeDetectionHit: (capabilityId: string) => void;
  startSetupFlow: (capabilityId: string) => void;
  closeSetupFlow: () => void;
  /** Clear everything when switching projects. */
  reset: () => void;
}

const initialState: Omit<
  PreflightState,
  | "loadManifest"
  | "refreshStatus"
  | "verifyAll"
  | "verifyOne"
  | "acknowledgeSkip"
  | "storeSecret"
  | "runAutoInstall"
  | "detectExisting"
  | "acknowledgeDetectionHit"
  | "startSetupFlow"
  | "closeSetupFlow"
  | "reset"
> = {
  manifest: null,
  status: null,
  installerLogs: {},
  pendingDetectionHits: [],
  activeFlowCapabilityId: null,
  isLoading: false,
};

export const usePreflightStore = create<PreflightState>((set, get) => ({
  ...initialState,

  loadManifest: async (projectPath) => {
    set({ isLoading: true });
    try {
      const manifest = await preflightLoadManifest(projectPath);
      set({ manifest });
    } catch {
      set({ manifest: null });
    } finally {
      set({ isLoading: false });
    }
  },

  refreshStatus: async (projectPath) => {
    try {
      const status = await fetchPreflightStatus(projectPath);
      set({ status });
    } catch {
      // No manifest yet — leave status null.
    }
  },

  verifyAll: async (projectPath) => {
    set({ isLoading: true });
    try {
      await preflightVerifyAll(projectPath);
      // Status will arrive via the all_complete event; refresh as a fallback
      // in case the listener isn't yet attached.
      await get().refreshStatus(projectPath);
    } finally {
      set({ isLoading: false });
    }
  },

  verifyOne: async (projectPath, capabilityId) => {
    await preflightVerifyOne(projectPath, capabilityId);
    // verification_complete event will update status; refresh defensively.
    await get().refreshStatus(projectPath);
  },

  acknowledgeSkip: async (projectPath, capabilityId) => {
    await preflightAcknowledgeSkip(projectPath, capabilityId);
    // The Rust side emits verification_complete; refresh defensively so the
    // aggregate allSatisfied/blockingCount recompute even if the listener
    // isn't attached.
    await get().refreshStatus(projectPath);
  },

  storeSecret: async (projectPath, capabilityId, value) => {
    await preflightStoreSecret(projectPath, capabilityId, value);
  },

  runAutoInstall: async (projectPath, capabilityId) => {
    set((s) => ({
      installerLogs: { ...s.installerLogs, [capabilityId]: [] },
    }));
    await preflightRunAutoInstall(projectPath, capabilityId);
    // Re-verify after the install finishes so the user sees the updated state.
    await get().verifyOne(projectPath, capabilityId);
  },

  detectExisting: async (projectPath) => {
    const hits = await preflightDetectExisting(projectPath);
    set({ pendingDetectionHits: hits });
  },

  acknowledgeDetectionHit: (capabilityId) => {
    set((s) => ({
      pendingDetectionHits: s.pendingDetectionHits.filter(
        (h) => h.capabilityId !== capabilityId,
      ),
    }));
  },

  startSetupFlow: (capabilityId) => set({ activeFlowCapabilityId: capabilityId }),
  closeSetupFlow: () => set({ activeFlowCapabilityId: null }),

  reset: () => set(initialState),
}));

// ── Selectors ────────────────────────────────────────────────────────

export function selectAllSatisfied(state: PreflightState): boolean {
  return state.status?.allSatisfied ?? true;
}

export function selectBlockingMissing(state: PreflightState): CapabilityStatus[] {
  if (!state.status || !state.manifest) return [];
  return state.status.capabilities.filter((cap) => {
    const manifestCap = state.manifest!.capabilities.find(
      (c) => c.id === cap.capabilityId,
    );
    if (!manifestCap) return false;
    if (!manifestCap.blocksSelfDrive || !manifestCap.required) return false;
    if (cap.userAcknowledgedOptionalSkip) return false;
    return cap.state !== "satisfied";
  });
}

// ── Event subscription ────────────────────────────────────────────────

export async function attachPreflightEventListeners(): Promise<void> {
  if (listenersAttached) return;
  listenersAttached = true;

  const set = (partial: Partial<PreflightState>) =>
    usePreflightStore.setState(partial as PreflightState);

  unlisten.push(
    await listen<VerificationStartedPayload>(
      PREFLIGHT_EVENTS.verificationStarted,
      ({ payload }) => {
        // Update the matching capability's state to Detecting (optimistic).
        const status = usePreflightStore.getState().status;
        if (!status || status.projectId !== payload.projectId) return;
        set({
          status: {
            ...status,
            capabilities: status.capabilities.map((c) =>
              c.capabilityId === payload.capabilityId
                ? { ...c, state: "detecting" }
                : c,
            ),
          },
        });
      },
    ),
  );

  unlisten.push(
    await listen<VerificationCompletePayload>(
      PREFLIGHT_EVENTS.verificationComplete,
      ({ payload }) => {
        const status = usePreflightStore.getState().status;
        if (!status || status.projectId !== payload.projectId) return;
        const next = status.capabilities.map((c) =>
          c.capabilityId === payload.capabilityId ? payload.status : c,
        );
        // If the capability wasn't previously in the list (fresh manifest),
        // append it.
        if (!status.capabilities.find((c) => c.capabilityId === payload.capabilityId)) {
          next.push(payload.status);
        }
        set({ status: { ...status, capabilities: next } });
      },
    ),
  );

  unlisten.push(
    await listen<AllCompletePayload>(PREFLIGHT_EVENTS.allComplete, ({ payload }) => {
      set({ status: payload.status });
    }),
  );

  unlisten.push(
    await listen<InstallerProgressPayload>(
      PREFLIGHT_EVENTS.installerProgress,
      ({ payload }) => {
        const logs = usePreflightStore.getState().installerLogs;
        const existing = logs[payload.capabilityId] ?? [];
        const tagged = `[${payload.stream}] ${payload.line}`;
        set({
          installerLogs: {
            ...logs,
            [payload.capabilityId]: [...existing, tagged],
          },
        });
      },
    ),
  );

  unlisten.push(
    await listen<DetectionHitPayload>(PREFLIGHT_EVENTS.detectionHit, ({ payload }) => {
      const hits = usePreflightStore.getState().pendingDetectionHits;
      // Avoid duplicates.
      if (hits.some((h) => h.capabilityId === payload.hit.capabilityId)) return;
      set({ pendingDetectionHits: [...hits, payload.hit] });
    }),
  );
}

export function detachPreflightEventListeners(): void {
  unlisten.splice(0).forEach((fn) => fn());
  listenersAttached = false;
}
