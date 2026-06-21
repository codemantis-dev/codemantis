import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextMeter from "./ContextMeter";

describe("ContextMeter", () => {
  it("renders label and usage", () => {
    render(<ContextMeter used={47000} max={200000} />);
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("47K / 200K")).toBeInTheDocument();
  });

  it("renders 0 values", () => {
    render(<ContextMeter used={0} max={200000} />);
    expect(screen.getByText("0 / 200K")).toBeInTheDocument();
  });

  it("renders small values without K suffix", () => {
    render(<ContextMeter used={500} max={999} />);
    expect(screen.getByText("500 / 999")).toBeInTheDocument();
  });

  it("renders 100% without exceeding", () => {
    render(<ContextMeter used={200000} max={200000} />);
    expect(screen.getByText("200K / 200K")).toBeInTheDocument();
  });

  describe("pending (post-compaction)", () => {
    it("prefixes the value with ~ and shows the refresh hint", () => {
      render(<ContextMeter used={3367} max={1_000_000} pending />);
      expect(screen.getByText("~3K / 1M")).toBeInTheDocument();
      expect(screen.getAllByTitle(/refreshes on next message/i).length).toBeGreaterThan(0);
    });

    it("does not prefix or hint when not pending", () => {
      render(<ContextMeter used={3367} max={1_000_000} />);
      expect(screen.getByText("3K / 1M")).toBeInTheDocument();
      expect(screen.queryAllByTitle(/refreshes on next message/i).length).toBe(0);
    });
  });
});
