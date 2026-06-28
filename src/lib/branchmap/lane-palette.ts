// Lane colors as CSS custom-property references, so the graph recolors across
// all 7 themes automatically (the same `var(--…)` trick recharts already uses).
//
// Lane 0 (the trunk / main) is always the accent. Feature/fix lanes cycle the
// categorical "tool" palette already defined in index.css.

/** Color of the trunk lane (main). */
export const MAIN_COLOR = "var(--accent)";

/** Categorical colors for non-trunk lanes, cycled with wraparound. */
export const LANE_PALETTE = [
  "var(--tool-read)", // blue
  "var(--tool-write)", // green
  "var(--tool-edit)", // amber
  "var(--tool-bash)", // purple
] as const;

/**
 * Color for a given lane index. Lane 0 → accent (the trunk); every other lane
 * cycles {@link LANE_PALETTE} so adjacent branches stay visually distinct.
 */
export function laneColor(laneIndex: number): string {
  if (laneIndex <= 0) return MAIN_COLOR;
  return LANE_PALETTE[(laneIndex - 1) % LANE_PALETTE.length];
}
