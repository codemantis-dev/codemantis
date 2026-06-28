import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BranchMapEmpty from "./BranchMapEmpty";

describe("BranchMapEmpty", () => {
  it("not-a-repo variant explains branches and offers to start tracking", () => {
    const onAction = vi.fn();
    render(
      <BranchMapEmpty variant="not-a-repo" projectName="MyApp" onPrimaryAction={onAction} />,
    );
    const root = screen.getByTestId("branch-map-empty");
    expect(root).toHaveAttribute("data-variant", "not-a-repo");
    expect(screen.getByText(/MyApp/)).toBeInTheDocument();
    expect(screen.getByText(/safe space/i)).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: /start tracking changes/i });
    fireEvent.click(cta);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("no-commits variant offers the first checkpoint", () => {
    render(
      <BranchMapEmpty variant="no-commits" projectName="MyApp" onPrimaryAction={() => {}} />,
    );
    expect(screen.getByText(/No checkpoints yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save your first checkpoint/i })).toBeInTheDocument();
  });

  it("hides the CTA when no action handler is provided", () => {
    render(<BranchMapEmpty variant="no-commits" projectName="MyApp" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("error variant shows the detail message and no CTA", () => {
    render(
      <BranchMapEmpty variant="error" projectName="MyApp" detail="git exploded" />,
    );
    expect(screen.getByText(/git exploded/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables the CTA while an action is in flight", () => {
    render(
      <BranchMapEmpty
        variant="not-a-repo"
        projectName="MyApp"
        onPrimaryAction={() => {}}
        actionBusy
      />,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
