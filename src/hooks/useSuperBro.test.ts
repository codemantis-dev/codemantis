import { describe, it, expect } from "vitest";
import type { SuperBroTrigger } from "../types/super-bro";
import { DEBOUNCE_BY_TRIGGER, RATE_LIMIT_MS } from "./useSuperBro";

// ── Timing constants sanity checks ──────────────────────────────────

const ALL_TRIGGERS: SuperBroTrigger[] = [
  "claude_response",
  "build_error",
  "test_failure",
  "preview_error",
  "guide_session_complete",
  "guide_session_start",
  "silence_timeout",
  "destructive_action",
  "session_start",
];

describe("DEBOUNCE_BY_TRIGGER", () => {
  it("has an entry for every SuperBroTrigger", () => {
    for (const trigger of ALL_TRIGGERS) {
      expect(DEBOUNCE_BY_TRIGGER).toHaveProperty(trigger);
    }
  });

  it("has no unknown keys beyond SuperBroTrigger values", () => {
    const keys = Object.keys(DEBOUNCE_BY_TRIGGER);
    for (const key of keys) {
      expect(ALL_TRIGGERS).toContain(key);
    }
  });

  it.each(Object.entries(DEBOUNCE_BY_TRIGGER))(
    "%s debounce (%dms) is between 0 and 2000ms",
    (_trigger, ms) => {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(2000);
    },
  );

  it("urgent triggers have 0ms debounce", () => {
    expect(DEBOUNCE_BY_TRIGGER.silence_timeout).toBe(0);
    expect(DEBOUNCE_BY_TRIGGER.destructive_action).toBe(0);
  });

  it("claude_response debounce is ≤ 500ms (fast path)", () => {
    expect(DEBOUNCE_BY_TRIGGER.claude_response).toBeLessThanOrEqual(500);
  });
});

describe("RATE_LIMIT_MS", () => {
  it("is between 5s and 15s", () => {
    expect(RATE_LIMIT_MS).toBeGreaterThanOrEqual(5_000);
    expect(RATE_LIMIT_MS).toBeLessThanOrEqual(15_000);
  });
});
