import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import ModeSelector from "./ModeSelector";

vi.mock("../../lib/tauri-commands", () => ({
  setSessionMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../hooks/useClickOutside", () => ({
  useClickOutside: <T extends HTMLElement>() => ({ current: null } as React.RefObject<T | null>),
}));

describe("ModeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeSessionId: "s1",
      sessionModes: new Map([["s1", "normal"]]),
      setSessionMode: vi.fn(),
    });
  });

  it("renders current mode label", () => {
    render(<ModeSelector />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("shows Auto-Accept label when mode is auto-accept", () => {
    useSessionStore.setState({
      sessionModes: new Map([["s1", "auto-accept"]]),
    });
    render(<ModeSelector />);
    expect(screen.getByText("Auto-Accept")).toBeInTheDocument();
  });

  it("shows Plan label when mode is plan", () => {
    useSessionStore.setState({
      sessionModes: new Map([["s1", "plan"]]),
    });
    render(<ModeSelector />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("shows Auto label when mode is auto", () => {
    useSessionStore.setState({
      sessionModes: new Map([["s1", "auto"]]),
    });
    render(<ModeSelector />);
    expect(screen.getByText("Auto")).toBeInTheDocument();
  });

  it("shows Don't Ask label when mode is dont-ask", () => {
    useSessionStore.setState({
      sessionModes: new Map([["s1", "dont-ask"]]),
    });
    render(<ModeSelector />);
    expect(screen.getByText("Don't Ask")).toBeInTheDocument();
  });

  it("shows Bypass label when mode is bypass-permissions", () => {
    useSessionStore.setState({
      sessionModes: new Map([["s1", "bypass-permissions"]]),
    });
    render(<ModeSelector />);
    expect(screen.getByText("Bypass")).toBeInTheDocument();
  });

  it("opens mode dropdown on click with all six modes", () => {
    render(<ModeSelector />);
    fireEvent.click(screen.getByText("Normal"));
    // All six mode options should now be visible.
    expect(screen.getByText("Ask permission before edits")).toBeInTheDocument();
    expect(screen.getByText("Accept all tool calls automatically")).toBeInTheDocument();
    expect(screen.getByText("Plan only, no code changes")).toBeInTheDocument();
    expect(screen.getByText("CLI decides per tool (auto-routing)")).toBeInTheDocument();
    expect(screen.getByText("Accept everything, no prompts")).toBeInTheDocument();
    expect(screen.getByText("Skip all permission checks (dangerous)")).toBeInTheDocument();
  });

  it("selects bypass-permissions when its option is clicked", () => {
    const mockSetSessionMode = vi.fn();
    useSessionStore.setState({ setSessionMode: mockSetSessionMode });

    render(<ModeSelector />);
    fireEvent.click(screen.getByText("Normal")); // open dropdown
    fireEvent.click(screen.getByText("Skip all permission checks (dangerous)"));

    expect(mockSetSessionMode).toHaveBeenCalledWith("s1", "bypass-permissions");
  });

  it("updates mode when a dropdown option is clicked", () => {
    const mockSetSessionMode = vi.fn();
    useSessionStore.setState({ setSessionMode: mockSetSessionMode });

    render(<ModeSelector />);
    fireEvent.click(screen.getByText("Normal")); // Open dropdown
    fireEvent.click(screen.getByText("Accept all tool calls automatically")); // Select Auto-Accept

    expect(mockSetSessionMode).toHaveBeenCalledWith("s1", "auto-accept");
  });

  it("is disabled when no active session", () => {
    useSessionStore.setState({ activeSessionId: null });
    render(<ModeSelector />);
    const button = screen.getByTitle(/Mode:/);
    expect(button).toBeDisabled();
  });

  it("defaults to normal when mode is not set for session", () => {
    useSessionStore.setState({
      sessionModes: new Map(), // no mode set
    });
    render(<ModeSelector />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });
});
