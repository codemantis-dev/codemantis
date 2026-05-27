import { describe, it, expect } from "vitest";
import { CODEX_FALLBACK_MODELS } from "./codex-models";

describe("CODEX_FALLBACK_MODELS", () => {
  it("includes at least one model marked isDefault so the selector can resolve a label", () => {
    // ModelSelector + SpecChat both rely on `.find(m => m.isDefault)` to
    // show a sensible resolved label before the user clicks. Losing the
    // default flag would silently regress the dropdown back to "Model ▼".
    const defaults = CODEX_FALLBACK_MODELS.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].value).toBe("gpt-5.5");
  });

  it("has unique model values", () => {
    const values = CODEX_FALLBACK_MODELS.map((m) => m.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("has non-empty displayName + description for every entry", () => {
    for (const m of CODEX_FALLBACK_MODELS) {
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it("matches the empirical codex-cli 0.130.0 baseline lineup", () => {
    // Regression guard: drift in this list usually means a copy-paste
    // mistake — the source of truth is the live `model/list` response,
    // captured into this constant per the docstring.
    expect(CODEX_FALLBACK_MODELS.map((m) => m.value)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
    ]);
  });
});
