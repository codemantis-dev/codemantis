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
});
