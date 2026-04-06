import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UpdateNotification from "./UpdateNotification";
import { useUiStore } from "../../stores/uiStore";

describe("UpdateNotification", () => {
  beforeEach(() => {
    useUiStore.setState({
      updateAvailable: false,
      availableVersion: null,
      availableNotes: null,
    });
  });

  it("returns null when no update is available", () => {
    const { container } = render(<UpdateNotification />);
    expect(container.firstChild).toBeNull();
  });

  it("renders when update is available", () => {
    useUiStore.setState({
      updateAvailable: true,
      availableVersion: "1.5.0",
      availableNotes: "Bug fixes and improvements",
    });
    render(<UpdateNotification />);
    expect(screen.getByText(/is available/)).toBeInTheDocument();
  });

  it("shows version number", () => {
    useUiStore.setState({
      updateAvailable: true,
      availableVersion: "2.0.0",
      availableNotes: null,
    });
    render(<UpdateNotification />);
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
  });

  it("update button calls openUpdateModal", () => {
    const openUpdateModal = vi.fn();
    useUiStore.setState({
      updateAvailable: true,
      availableVersion: "1.5.0",
      availableNotes: "New features",
      openUpdateModal,
    });
    render(<UpdateNotification />);
    fireEvent.click(screen.getByText("Update Now"));
    expect(openUpdateModal).toHaveBeenCalledWith("1.5.0", "New features");
  });
});
