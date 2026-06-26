import { describe, it, expect } from "vitest";
import { computeDuoRoleCosts } from "./duo-cost";
import type { SessionStats } from "../types/session";

function stats(p: Partial<SessionStats>): SessionStats {
  return {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    turnCount: 1,
    apiCallCount: 1,
    totalReasoningOutputTokens: 0,
    ...p,
  };
}

const PRICING = { "gpt-5.5": { input: 5.0, output: 30.0 } };

describe("computeDuoRoleCosts", () => {
  it("uses the real reported cost when present (no estimate)", () => {
    const r = computeDuoRoleCosts({
      primaryStats: stats({ totalCostUsd: 0.5, totalInputTokens: 1000, totalOutputTokens: 500 }),
      mentorStats: undefined,
      primaryModel: "gpt-5.5",
      mentorModel: undefined,
      modelPricing: PRICING,
      analystUsd: 0,
    });
    expect(r.primary.usd).toBeCloseTo(0.5);
    expect(r.primary.est).toBe(false);
    expect(r.primary.tokens).toBe(1500);
  });

  it("estimates from tokens × pricing when no cost is reported (Codex)", () => {
    const r = computeDuoRoleCosts({
      primaryStats: stats({ totalCostUsd: 0, totalInputTokens: 20_000, totalOutputTokens: 1000 }),
      mentorStats: undefined,
      primaryModel: "gpt-5.5",
      mentorModel: undefined,
      modelPricing: PRICING,
      analystUsd: 0,
    });
    // 20000/1e6*5 + 1000/1e6*30 = 0.10 + 0.03
    expect(r.primary.usd).toBeCloseTo(0.13);
    expect(r.primary.est).toBe(true);
    expect(r.primary.tokens).toBe(21_000);
  });

  it("estimate is $0 (still flagged) when pricing is missing for the model", () => {
    const r = computeDuoRoleCosts({
      primaryStats: stats({ totalCostUsd: 0, totalInputTokens: 10_000, totalOutputTokens: 0 }),
      mentorStats: undefined,
      primaryModel: "unknown-model",
      mentorModel: undefined,
      modelPricing: PRICING,
      analystUsd: 0,
    });
    expect(r.primary.usd).toBe(0);
    expect(r.primary.est).toBe(true);
    expect(r.primary.tokens).toBe(10_000);
  });

  it("zero/absent stats yield $0 with no estimate flag", () => {
    const r = computeDuoRoleCosts({
      primaryStats: undefined,
      mentorStats: undefined,
      primaryModel: "gpt-5.5",
      mentorModel: "claude-opus-4-8",
      modelPricing: PRICING,
      analystUsd: 0,
    });
    expect(r.primary).toEqual({ usd: 0, est: false, tokens: 0 });
    expect(r.mentor).toEqual({ usd: 0, est: false, tokens: 0 });
  });

  it("total is primary + mentor + analyst", () => {
    const r = computeDuoRoleCosts({
      primaryStats: stats({ totalInputTokens: 20_000 }), // est 0.10
      mentorStats: stats({ totalCostUsd: 0.04 }), // real
      primaryModel: "gpt-5.5",
      mentorModel: "claude-opus-4-8",
      modelPricing: PRICING,
      analystUsd: 0.01,
    });
    expect(r.primary.usd).toBeCloseTo(0.1);
    expect(r.mentor.usd).toBeCloseTo(0.04);
    expect(r.analyst.usd).toBeCloseTo(0.01);
    expect(r.total).toBeCloseTo(0.15);
  });
});
