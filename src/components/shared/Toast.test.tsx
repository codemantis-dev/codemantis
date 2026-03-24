import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "../../stores/toastStore";
import Toast from "./Toast";

describe("Toast", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("renders nothing when there are no toasts", () => {
    const { container } = render(<Toast />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a toast message", () => {
    useToastStore.setState({
      toasts: [
        { id: "t1", message: "Operation successful", type: "success", duration: 5000 },
      ],
    });
    render(<Toast />);
    expect(screen.getByText("Operation successful")).toBeInTheDocument();
  });

  it("renders multiple toasts", () => {
    useToastStore.setState({
      toasts: [
        { id: "t1", message: "First toast", type: "info", duration: 5000 },
        { id: "t2", message: "Second toast", type: "error", duration: 8000 },
      ],
    });
    render(<Toast />);
    expect(screen.getByText("First toast")).toBeInTheDocument();
    expect(screen.getByText("Second toast")).toBeInTheDocument();
  });

  it("removes toast when dismiss button is clicked", () => {
    useToastStore.setState({
      toasts: [
        { id: "t1", message: "Dismissable toast", type: "info", duration: 5000 },
      ],
    });
    render(<Toast />);
    const dismissBtn = screen.getByLabelText("Dismiss");
    fireEvent.click(dismissBtn);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("applies different border colors based on toast type", () => {
    useToastStore.setState({
      toasts: [
        { id: "t1", message: "Error toast", type: "error", duration: 8000 },
      ],
    });
    const { container } = render(<Toast />);
    const toastEl = container.querySelector("[style]");
    expect(toastEl?.getAttribute("style")).toContain("var(--red)");
  });

  it("applies success border color for success toasts", () => {
    useToastStore.setState({
      toasts: [
        { id: "t1", message: "Success toast", type: "success", duration: 5000 },
      ],
    });
    const { container } = render(<Toast />);
    const toastEl = container.querySelector("[style]");
    expect(toastEl?.getAttribute("style")).toContain("var(--green)");
  });
});
