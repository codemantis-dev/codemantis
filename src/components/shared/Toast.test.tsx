import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
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

  // ─── warning + action button ───────────────────────────────────────
  it("renders a warning toast with yellow accent", () => {
    useToastStore.setState({
      toasts: [
        { id: "t-warn", message: "Auto-recovered guide", type: "warning", duration: 12000 },
      ],
    });
    const { container } = render(<Toast />);
    const toastEl = container.querySelector("[style]");
    expect(toastEl?.getAttribute("style")).toContain("--yellow");
    expect(screen.getByText("Auto-recovered guide")).toBeInTheDocument();
  });

  it("renders an action button when toast.action is set", () => {
    const onClick = vi.fn();
    useToastStore.setState({
      toasts: [
        {
          id: "t-act",
          message: "Recovered 12 sessions",
          type: "warning",
          duration: 12000,
          action: { label: "Save corrected version", onClick },
        },
      ],
    });
    render(<Toast />);
    const btn = screen.getByRole("button", { name: "Save corrected version" });
    expect(btn).toBeInTheDocument();
  });

  it("clicking the action button fires onClick and dismisses the toast by default", () => {
    const onClick = vi.fn();
    useToastStore.setState({
      toasts: [
        {
          id: "t-act",
          message: "Recovered",
          type: "warning",
          duration: 12000,
          action: { label: "Save", onClick },
        },
      ],
    });
    render(<Toast />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("clicking the action button keeps the toast open when keepOpen=true", () => {
    const onClick = vi.fn();
    useToastStore.setState({
      toasts: [
        {
          id: "t-act",
          message: "Recovered",
          type: "warning",
          duration: 12000,
          action: { label: "Save", onClick, keepOpen: true },
        },
      ],
    });
    render(<Toast />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("toast without action does NOT render an action button", () => {
    useToastStore.setState({
      toasts: [
        { id: "t1", message: "Plain info", type: "info", duration: 5000 },
      ],
    });
    render(<Toast />);
    // The only button is the dismiss "×" — no action button.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("aria-label", "Dismiss");
  });
});
