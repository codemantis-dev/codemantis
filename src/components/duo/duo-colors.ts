/** Pure color mappers for the Duo-Coding dashboard (theme CSS variables). */

/** Map a 0–100 score to a theme color band. */
export function scoreColor(score: number): string {
  if (score >= 70) return "var(--green)";
  if (score >= 40) return "var(--yellow)";
  return "var(--red)";
}

/** Map a controlled-vocabulary level/trend to a theme color. */
export function levelColor(level: string): string {
  switch (level) {
    case "high":
    case "improving":
    case "accelerating":
      return "var(--green)";
    case "medium":
    case "moderate":
    case "steady":
    case "stable":
    case "flat":
      return "var(--yellow)";
    case "low":
    case "declining":
    case "regressing":
    case "stalling":
    case "blocked":
      return "var(--red)";
    default:
      return "var(--text-dim)";
  }
}
