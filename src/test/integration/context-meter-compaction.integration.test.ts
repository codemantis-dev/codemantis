/**
 * Integration test: Context meter across compaction.
 *
 * Reproduces the reported bug — after `/compact`, the CONTEXT meter stayed
 * pinned at its pre-compaction value while the session was idle — and locks in
 * the fix: a `compact_complete` event (carrying the CLI's `post_tokens`, CLI
 * ≥2.1.185 / capture S17) drops the meter to a provisional *pending* value, and
 * the next `usage_update` snaps it to the true full-window fill.
 *
 * Uses REAL stores through the real event pipeline; only Tauri IPC + toasts are
 * mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetAllStores } from "../helpers/store-reset";
import { simulateEventStream } from "../helpers/event-simulator";
import {
  createUsageUpdateEvent,
  createCompactingStatusEvent,
  createCompactCompleteEvent,
  TEST_SESSION_ID,
} from "../helpers/event-fixtures";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session } from "../../types/session";

vi.mock("../../lib/tauri-commands", () => ({
  readFileContent: vi.fn().mockResolvedValue(""),
  syncSessionMode: vi.fn().mockResolvedValue(undefined),
  generateChangelogEntry: vi.fn().mockResolvedValue({}),
  checkProcessAlive: vi.fn().mockResolvedValue(true),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

const SID = TEST_SESSION_ID;

// A [1m] model so the meter max resolves to 1,000,000 — matching the bug report.
const TEST_SESSION: Session = {
  id: SID,
  name: "Test Session",
  project_path: "/tmp/test-project",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: "claude-opus-4-8[1m]",
  icon_index: 0,
};

function setupSession(): void {
  const s = useSettingsStore.getState();
  useSettingsStore.setState({
    settings: { ...s.settings, defaultContextWindow: 200000 },
    loaded: true,
  });
  useSessionStore.getState().addSession(TEST_SESSION);
}

describe("Context meter across compaction (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSession();
  });

  it("drops to a pending post-compaction value, then the next turn sets the true fill", () => {
    // 1. A near-full pre-compaction turn (the alarming stale value).
    simulateEventStream(SID, [
      createUsageUpdateEvent(
        { input_tokens: 900000, output_tokens: 3000, cache_creation_input_tokens: 20000, cache_read_input_tokens: 50000 },
        SID,
      ),
    ]);
    let ctx = useSessionStore.getState().sessionContext.get(SID);
    expect(ctx?.used).toBe(900000 + 3000 + 20000 + 50000);
    expect(ctx?.max).toBe(1_000_000);
    expect(ctx?.pending).toBeFalsy();

    // 2. Compaction runs and completes with post_tokens.
    simulateEventStream(SID, [
      createCompactingStatusEvent(true, SID),
      createCompactCompleteEvent({ trigger: "manual", preTokens: 28258, postTokens: 3367 }, SID),
    ]);
    ctx = useSessionStore.getState().sessionContext.get(SID);
    // Meter no longer shows the stale ~973K — it dropped to the CLI's post count.
    expect(ctx?.used).toBe(3367);
    expect(ctx?.max).toBe(1_000_000); // window preserved
    expect(ctx?.pending).toBe(true);
    expect(useSessionStore.getState().sessionCompacting.get(SID)).toBe(false);

    // 3. The next real turn's usage clears pending and sets the true fill
    //    (includes the fixed system/tool overhead that post_tokens excludes).
    simulateEventStream(SID, [
      createUsageUpdateEvent(
        { input_tokens: 2182, output_tokens: 4, cache_creation_input_tokens: 5746, cache_read_input_tokens: 15626 },
        SID,
      ),
    ]);
    ctx = useSessionStore.getState().sessionContext.get(SID);
    expect(ctx?.pending).toBeFalsy();
    expect(ctx?.used).toBe(2182 + 4 + 5746 + 15626);
  });

  it("falls back to a pending prior value when the CLI omits post_tokens", () => {
    simulateEventStream(SID, [
      createUsageUpdateEvent(
        { input_tokens: 400000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        SID,
      ),
      createCompactCompleteEvent({ trigger: "auto", preTokens: 401000, postTokens: null }, SID),
    ]);
    const ctx = useSessionStore.getState().sessionContext.get(SID);
    expect(ctx?.used).toBe(401000); // prior value retained
    expect(ctx?.pending).toBe(true); // but flagged so it's not presented as current
  });
});
