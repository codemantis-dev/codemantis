/**
 * Integration test: Self-Drive manual session-complete bypass
 *
 * Reproduces the user-reported incident:
 *   1. Self-Drive runs an unattended session
 *   2. The cross-system parity gate fires (e.g. handler is "Postgres
 *      function in migration SQL" — rg can't reason about it) and pauses
 *      the run with a "Self-Drive halted" banner
 *   3. The user clicks Mark Session Complete
 *
 * Expected (post-fix): the click bypasses the parity gate, marks the
 * session done in BOTH stores (selfDrive + guide), clears the pause so
 * Resume picks up cleanly, and writes audit-trail entries to the run log.
 *
 * Pre-fix: the click silently ran the same gate, got the same FAIL,
 * showed at most a toast, and the user had to Stop → Click → Start.
 *
 * Also covers the regression guard: the auto-advance code path
 * (handleAdvance → attemptMarkSessionComplete with no opts) MUST still
 * gate on parity — the bypass is exclusively for explicit user clicks.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import type { ImplementationGuide } from "../../types/implementation-guide";

const { mockShowToast, mockVerifyActionParity } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockVerifyActionParity: vi.fn(),
}));

vi.mock("../../lib/tauri-commands", () => ({
  saveGuide: vi.fn().mockResolvedValue("guide-1"),
  loadGuide: vi.fn().mockResolvedValue(null),
  updateGuideData: vi.fn().mockResolvedValue(undefined),
  deleteGuide: vi.fn().mockResolvedValue(undefined),
  deleteGuidesForProject: vi.fn().mockResolvedValue(undefined),
  saveSelfDriveState: vi.fn().mockResolvedValue(undefined),
  loadSelfDriveState: vi.fn().mockResolvedValue(null),
  listSelfDriveStates: vi.fn().mockResolvedValue([]),
  deleteSelfDriveState: vi.fn().mockResolvedValue(undefined),
  verifyActionParity: mockVerifyActionParity,
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: mockShowToast,
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

import {
  useSelfDriveStore,
  attemptMarkSessionComplete,
} from "../../stores/selfDriveStore";
import { useGuideStore } from "../../stores/guideStore";

const PROJECT_PATH = "/tmp/juliam-twin";

function makePausedGuide(): ImplementationGuide {
  return {
    id: "guide-juliam",
    projectPath: PROJECT_PATH,
    specFilename: "juliam-twin.md",
    auditFilename: null,
    title: "JULIAM Twin v2 Upscale",
    sessions: [
      {
        index: 1,
        name: "Phase A Foundation Diagnosis and Fix",
        scope: "Diagnose and fix extraction",
        readSections: "1, 2, 3",
        files: ["supabase/migrations/0042_twin_user_settings.sql"],
        prompt: "Build foundation.",
        verifyChecks: [
          { id: "v-1-0", label: "Migration applied", checked: true },
          { id: "v-1-1", label: "Functions deployed", checked: true },
          { id: "v-1-2", label: "Tests pass", checked: true },
        ],
        status: "active",
        promptSent: true,
        verifyRequested: true,
        crossSystemActions: [
          {
            action: "twin_recompute_entity_importance()",
            handler: "Postgres function in migration SQL",
          },
        ],
      },
      {
        index: 2,
        name: "90-Day Backfill",
        scope: "Phase A continued",
        readSections: "4",
        files: ["src/twin/backfill.ts"],
        prompt: "Build backfill.",
        verifyChecks: [],
        status: "pending",
        promptSent: false,
        verifyRequested: false,
      },
    ],
    createdAt: "2026-05-04T00:00:00Z",
    status: "active",
  };
}

/**
 * Seeds Self-Drive into the exact state from the screenshots:
 * paused, with currentSessionIndex=1, pauseReason quoting the parity
 * failure. Mirrors the guide into useGuideStore so the UI store agrees.
 */
function seedPausedOnParity(): void {
  const guide = makePausedGuide();
  useGuideStore.setState({ guide });
  useSelfDriveStore.setState({
    status: "paused",
    projectPath: PROJECT_PATH,
    sessionId: "session-juliam",
    guide,
    currentSessionIndex: 1,
    currentPhase: "verifying",
    pauseReason:
      "Self-Drive halted: cross-system action parity check failed. " +
      "twin_recompute_entity_importance(): handler path 'Postgres function in migration SQL' " +
      "does not reference action 'twin_recompute_entity_importance()'",
    activeBlocker: null,
    runLog: [],
  });
}

describe("Self-Drive: manual Mark Session Complete bypasses parity gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
  });

  it("end-to-end: paused on parity FAIL → user clicks Mark Complete → session done, pause cleared, audit log written", async () => {
    seedPausedOnParity();

    // Sanity: we're starting in the exact halted state from the screenshots.
    expect(useSelfDriveStore.getState().status).toBe("paused");
    expect(useSelfDriveStore.getState().pauseReason).toMatch(/parity check failed/);

    // The fix: manual click invokes attemptMarkSessionComplete with the
    // skipParityGate opt set. (This mirrors GuidePanel.handleMarkComplete.)
    const outcome = await attemptMarkSessionComplete(1, { skipParityGate: true });

    // 1. Completion succeeded.
    expect(outcome.ok).toBe(true);

    // 2. Parity scan was NOT invoked — the gate is genuinely skipped,
    //    not just ignored. This is the core fix; without it the rg-based
    //    scanner would still false-positive on "Postgres function in
    //    migration SQL".
    expect(mockVerifyActionParity).not.toHaveBeenCalled();

    // 3. Session is flipped to "done" in selfDrive's pinned guide.
    const sdGuide = useSelfDriveStore.getState().guide!;
    expect(sdGuide.sessions[0].status).toBe("done");

    // 4. Run log carries the audit entry — the run log honestly shows
    //    which completions were human-overridden, not gate-cleared.
    const log = useSelfDriveStore.getState().runLog;
    expect(
      log.some(
        (e) =>
          e.phase === "decision" &&
          e.summary.includes("parity gate bypassed"),
      ),
    ).toBe(true);

    // 5. The UI flow then calls clearPause() (mirrors GuidePanel handler
    //    after a successful manual complete). Verify it actually unwedges
    //    the run so Resume can proceed.
    useSelfDriveStore.getState().clearPause();
    const after = useSelfDriveStore.getState();
    expect(after.status).toBe("idle");
    expect(after.pauseReason).toBeNull();
    expect(after.activeBlocker).toBeNull();
    expect(
      after.runLog.some(
        (e) =>
          e.phase === "resumed" &&
          e.summary.includes("Pause cleared by manual session completion"),
      ),
    ).toBe(true);
  });

  it("regression guard: default opts (skipParityGate omitted) still runs parity and blocks on FAIL — auto-advance path stays gated", async () => {
    // handleAdvance() calls attemptMarkSessionComplete(idx) with NO opts.
    // The legitimate "mocked tests pass, real handlers missing" guard
    // must remain in force for the unattended automation path. The
    // bypass is exclusively for explicit user button clicks.
    mockVerifyActionParity.mockResolvedValueOnce([
      {
        action: "twin_recompute_entity_importance()",
        callerPresent: true,
        handlerPresent: false,
        handlerStubFree: false,
        status: "FAIL",
        detail:
          "handler path 'Postgres function in migration SQL' does not reference action",
      },
    ]);

    seedPausedOnParity();
    // Reset to running for the regression test (handleAdvance only fires
    // mid-run, not from the paused state).
    useSelfDriveStore.setState({ status: "running", pauseReason: null });

    const outcome = await attemptMarkSessionComplete(1); // no opts → gated

    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toBe("parity-failed");
    expect(mockVerifyActionParity).toHaveBeenCalledTimes(1);
    // Session must remain "active" — the gate held.
    expect(useSelfDriveStore.getState().guide!.sessions[0].status).toBe("active");
  });
});
