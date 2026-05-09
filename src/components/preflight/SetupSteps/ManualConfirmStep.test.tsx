import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ManualConfirmStep from "./ManualConfirmStep";

describe("ManualConfirmStep", () => {
  it("uses the supplied label", () => {
    render(<ManualConfirmStep label="I've installed it" onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: /I've installed it/ })).toBeInTheDocument();
  });

  it("falls back to a default label", () => {
    render(<ManualConfirmStep onConfirm={() => {}} />);
    expect(
      screen.getByRole("button", { name: /I've completed this step/ }),
    ).toBeInTheDocument();
  });

  it("calls onConfirm exactly once when clicked", () => {
    const onConfirm = vi.fn();
    render(<ManualConfirmStep onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
