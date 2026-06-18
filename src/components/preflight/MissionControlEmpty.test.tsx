import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MissionControlEmpty from "./MissionControlEmpty";

describe("MissionControlEmpty", () => {
  it("renders the project name in the heading", () => {
    render(
      <MissionControlEmpty projectName="Atikon" onOpenSpecWriter={() => {}} />,
    );
    expect(screen.getByTestId("mission-control-empty")).toBeInTheDocument();
    expect(screen.getByText(/Atikon/)).toBeInTheDocument();
    expect(screen.getByText(/No capabilities tracked/i)).toBeInTheDocument();
  });

  it("shows the 'write a spec' guidance when there is no saved spec", () => {
    render(
      <MissionControlEmpty projectName="P" onOpenSpecWriter={() => {}} />,
    );
    expect(screen.getByText(/generated automatically when you save a spec/i)).toBeInTheDocument();
  });

  it("shows the 're-save' guidance when a spec already exists", () => {
    render(
      <MissionControlEmpty projectName="P" hasSavedSpec onOpenSpecWriter={() => {}} />,
    );
    expect(screen.getByText(/Re-save it in SpecWriter/i)).toBeInTheDocument();
  });

  it("calls onOpenSpecWriter when the button is clicked", () => {
    const onOpenSpecWriter = vi.fn();
    render(
      <MissionControlEmpty projectName="P" onOpenSpecWriter={onOpenSpecWriter} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open SpecWriter/i }));
    expect(onOpenSpecWriter).toHaveBeenCalledTimes(1);
  });
});
