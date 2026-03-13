/**
 * Centralized formatting utilities for tokens, cost, duration, and model names.
 * Replaces duplicated formatting functions across components.
 */

/** Format a token count with K/M suffixes. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/** Format a USD cost value.
 * - "label": shows "<$0.001" for tiny costs (popover/detail views)
 * - "compact": returns "" for tiny costs (status bar)
 * - "explicit": shows "$0" for zero, fewer decimals (summary views)
 */
export function formatCost(
  usd: number,
  style: "label" | "compact" | "explicit" = "label",
): string {
  if (style === "compact") {
    if (usd < 0.001) return "";
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(3)}`;
  }
  if (style === "explicit") {
    if (usd === 0) return "$0";
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  }
  // "label" (default)
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

/** Format a millisecond duration.
 * - "short": "100ms", "1.5s" (popover, turn stats)
 * - "medium": "100ms", "1.5s", "2m 30s" (message bubble)
 * - "elapsed": "0:45", "1:23", "2:15:30" (status bar, timers)
 * - "human": "45s", "2m 30s", "1h 15m" (thinking indicator)
 */
export function formatDuration(
  ms: number,
  style: "short" | "medium" | "elapsed" | "human" = "short",
): string {
  if (style === "elapsed") {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    const hours = Math.floor(minutes / 60);
    const remainingMin = minutes % 60;
    return `${hours}:${remainingMin.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  if (style === "human") {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMin = minutes % 60;
    return `${hours}h ${remainingMin.toString().padStart(2, "0")}m`;
  }

  if (style === "medium") {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return `${min}m ${sec}s`;
  }

  // "short" (default)
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format seconds (not ms) for agent elapsed display. */
export function formatSecondsElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/** Format a model ID to a human-readable name.
 * "claude-opus-4-6-20250101" → "Opus 4.6"
 * Returns null if model is null/undefined. */
export function formatModelName(model: string | null | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  const families = ["opus", "sonnet", "haiku"];
  for (const family of families) {
    const idx = m.indexOf(family);
    if (idx === -1) continue;
    const after = m.slice(idx + family.length).replace(/^-/, "");
    const versionPart = after.replace(/-?\d{8,}.*$/, "").replace(/-/g, ".");
    const name = family.charAt(0).toUpperCase() + family.slice(1);
    return versionPart ? `${name} ${versionPart}` : name;
  }
  return model;
}
