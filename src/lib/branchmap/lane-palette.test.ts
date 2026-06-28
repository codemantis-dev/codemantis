import { describe, it, expect } from "vitest";
import { laneColor, MAIN_COLOR, LANE_PALETTE } from "./lane-palette";

describe("laneColor", () => {
  it("maps lane 0 (trunk) to the accent", () => {
    expect(laneColor(0)).toBe(MAIN_COLOR);
  });

  it("treats negative lanes as the trunk", () => {
    expect(laneColor(-1)).toBe(MAIN_COLOR);
  });

  it("cycles the categorical palette for non-trunk lanes", () => {
    expect(laneColor(1)).toBe(LANE_PALETTE[0]);
    expect(laneColor(2)).toBe(LANE_PALETTE[1]);
    expect(laneColor(3)).toBe(LANE_PALETTE[2]);
    expect(laneColor(4)).toBe(LANE_PALETTE[3]);
  });

  it("wraps around past the palette length", () => {
    expect(laneColor(5)).toBe(LANE_PALETTE[0]);
    expect(laneColor(1 + LANE_PALETTE.length)).toBe(LANE_PALETTE[0]);
  });

  it("only ever returns CSS var references (theme-reactive)", () => {
    for (let lane = 0; lane < 10; lane++) {
      expect(laneColor(lane)).toMatch(/^var\(--/);
    }
  });
});
