import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile, Badge, ScoreGauge } from "./DuoPrimitives";
import { scoreColor, levelColor } from "./duo-colors";

describe("scoreColor", () => {
  it("bands scores red/yellow/green", () => {
    expect(scoreColor(20)).toBe("var(--red)");
    expect(scoreColor(50)).toBe("var(--yellow)");
    expect(scoreColor(85)).toBe("var(--green)");
  });
});

describe("levelColor", () => {
  it("maps positive levels to green", () => {
    expect(levelColor("high")).toBe("var(--green)");
    expect(levelColor("improving")).toBe("var(--green)");
  });
  it("maps negative levels to red", () => {
    expect(levelColor("blocked")).toBe("var(--red)");
    expect(levelColor("regressing")).toBe("var(--red)");
  });
  it("falls back to dim for unknown", () => {
    expect(levelColor("unknown")).toBe("var(--text-dim)");
  });
});

describe("StatTile + Badge + ScoreGauge", () => {
  it("renders a stat tile value and label", () => {
    render(<StatTile label="reviews" value={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("reviews")).toBeInTheDocument();
  });

  it("renders a badge", () => {
    render(<Badge text="steady" color="var(--yellow)" />);
    expect(screen.getByText("steady")).toBeInTheDocument();
  });

  it("renders a gauge with its numeric score and caption", () => {
    render(<ScoreGauge label="Health" score={78} caption="low friction" />);
    expect(screen.getByText("78")).toBeInTheDocument();
    expect(screen.getByText("Health")).toBeInTheDocument();
    expect(screen.getByText("low friction")).toBeInTheDocument();
  });
});
