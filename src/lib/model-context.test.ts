import { describe, it, expect } from "vitest";
import { getContextWindowForModel } from "./model-context";

describe("getContextWindowForModel", () => {
  it("returns 1_000_000 for model strings containing [1m]", () => {
    expect(getContextWindowForModel("opus[1m]")).toBe(1_000_000);
    expect(getContextWindowForModel("claude-opus-4-8[1m]")).toBe(1_000_000);
  });

  it("returns 200_000 for opus, sonnet, haiku patterns", () => {
    expect(getContextWindowForModel("opus")).toBe(200_000);
    expect(getContextWindowForModel("sonnet")).toBe(200_000);
    expect(getContextWindowForModel("haiku")).toBe(200_000);
  });

  it("returns 200_000 for full model IDs", () => {
    expect(getContextWindowForModel("claude-sonnet-4-20250514")).toBe(200_000);
    expect(getContextWindowForModel("claude-opus-4-8-20250514")).toBe(200_000);
    expect(getContextWindowForModel("claude-haiku-4-5-20250101")).toBe(200_000);
  });

  it("[1m] takes priority over base pattern", () => {
    expect(getContextWindowForModel("sonnet[1m]")).toBe(1_000_000);
    expect(getContextWindowForModel("haiku[1m]")).toBe(1_000_000);
  });

  it("returns settingsDefault when model is null", () => {
    expect(getContextWindowForModel(null, 128_000)).toBe(128_000);
  });

  it("returns settingsDefault when model doesn't match any pattern", () => {
    expect(getContextWindowForModel("gpt-4o", 128_000)).toBe(128_000);
  });

  it("returns 200_000 fallback when model is null and no settingsDefault", () => {
    expect(getContextWindowForModel(null)).toBe(200_000);
    expect(getContextWindowForModel(undefined)).toBe(200_000);
  });

  it("returns 200_000 fallback for unknown model with no settingsDefault", () => {
    expect(getContextWindowForModel("gpt-4o")).toBe(200_000);
    expect(getContextWindowForModel("unknown-model")).toBe(200_000);
  });
});
