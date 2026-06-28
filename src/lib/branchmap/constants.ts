// Geometry constants for the Branch Map swim-lane SVG.
// Kept in one place so the pure layout function and the renderer agree.

/** Horizontal pixels per commit column (oldest left → newest right). */
export const COL_W = 64;
/** Vertical pixels per branch lane. */
export const LANE_H = 56;
/** Left gutter reserved for lane labels. */
export const PAD_X = 88;
/** Top/bottom padding inside the canvas. */
export const PAD_Y = 32;
/** Commit node radius. */
export const NODE_R = 7;
/** "You are here" HEAD halo radius. */
export const HEAD_R = 13;
