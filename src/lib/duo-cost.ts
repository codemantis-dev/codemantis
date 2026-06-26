/**
 * Per-role cost breakdown for the Duo dashboard.
 *
 * Claude Code self-reports a real `cost_usd` per turn (accumulated into each
 * session's `SessionStats.totalCostUsd`). Codex is a ChatGPT-subscription CLI and
 * reports NO per-call cost — only token usage. So for the primary we fall back to
 * an ESTIMATE: token usage × the configured model pricing (the same `modelPricing`
 * table the analyst uses). Estimated values are flagged so the UI can mark them.
 */
import type { SessionStats } from "../types/session";
import type { ModelPricing } from "../types/settings";

export interface RoleCost {
  usd: number;
  /** True when `usd` is a token×pricing estimate (no real cost was reported). */
  est: boolean;
  tokens: number;
}

export interface DuoRoleCosts {
  primary: RoleCost;
  mentor: RoleCost;
  analyst: { usd: number };
  total: number;
}

function estimateFromTokens(
  stats: SessionStats | undefined,
  pricing: ModelPricing | undefined,
): number {
  if (!stats || !pricing) return 0;
  return (
    (stats.totalInputTokens / 1_000_000) * pricing.input +
    (stats.totalOutputTokens / 1_000_000) * pricing.output
  );
}

function roleCost(
  stats: SessionStats | undefined,
  pricing: ModelPricing | undefined,
): RoleCost {
  const tokens = stats ? stats.totalInputTokens + stats.totalOutputTokens : 0;
  const real = stats?.totalCostUsd ?? 0;
  if (real > 0) return { usd: real, est: false, tokens };
  return { usd: estimateFromTokens(stats, pricing), est: tokens > 0, tokens };
}

/**
 * Compute the primary/mentor/analyst cost split. Primary/mentor use real reported
 * cost when present, else a token×pricing estimate. Analyst cost is passed in
 * (it arrives via the snapshot event; there's no session for it).
 */
export function computeDuoRoleCosts(params: {
  primaryStats: SessionStats | undefined;
  mentorStats: SessionStats | undefined;
  primaryModel: string | undefined;
  mentorModel: string | undefined;
  modelPricing: Record<string, ModelPricing>;
  analystUsd: number;
}): DuoRoleCosts {
  const primary = roleCost(
    params.primaryStats,
    params.primaryModel ? params.modelPricing[params.primaryModel] : undefined,
  );
  const mentor = roleCost(
    params.mentorStats,
    params.mentorModel ? params.modelPricing[params.mentorModel] : undefined,
  );
  const analyst = { usd: params.analystUsd };
  return { primary, mentor, analyst, total: primary.usd + mentor.usd + analyst.usd };
}
