import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SessionTab from "./SessionTab";

vi.mock("../../lib/tauri-commands", () => ({}));
vi.mock("../shared/StatusDot", () => ({
  default: ({ color, pulse }: { color: string; pulse: boolean }) => (
    <span data-testid="status-dot" data-color={color} data-pulse={pulse} />
  ),
}));

describe("SessionTab", () => {
  const defaultProps = {
    id: "session-1",
    name: "Test Session",
    projectName: "MyProject",
    iconIndex: 0,
    isActive: false,
    isStreaming: false,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onRename: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders session name and project name", () => {
    render(<SessionTab {...defaultProps} />);
    expect(screen.getByText("Test Session")).toBeInTheDocument();
    expect(screen.getByText("MyProject")).toBeInTheDocument();
  });

  it("does not show project name when same as session name", () => {
    render(<SessionTab {...defaultProps} name="MyProject" projectName="MyProject" />);
    // Should only have one instance of the name
    const elements = screen.getAllByText("MyProject");
    expect(elements).toHaveLength(1);
  });

  it("calls onSelect when clicked", () => {
    render(<SessionTab {...defaultProps} />);
    fireEvent.click(screen.getByText("Test Session"));
    expect(defaultProps.onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows close button when active", () => {
    render(<SessionTab {...defaultProps} isActive={true} />);
    expect(screen.getByLabelText("Close Test Session")).toBeInTheDocument();
  });

  it("calls onClose and stops propagation when close button is clicked", () => {
    render(<SessionTab {...defaultProps} isActive={true} />);
    const closeBtn = screen.getByLabelText("Close Test Session");
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSelect).not.toHaveBeenCalled();
  });

  it("enters edit mode on double-click and commits rename on Enter", () => {
    render(<SessionTab {...defaultProps} isActive={true} />);
    fireEvent.doubleClick(screen.getByText("Test Session"));
    const input = screen.getByDisplayValue("Test Session");
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(defaultProps.onRename).toHaveBeenCalledWith("New Name");
  });

  it("cancels edit on Escape without renaming", () => {
    render(<SessionTab {...defaultProps} isActive={true} />);
    fireEvent.doubleClick(screen.getByText("Test Session"));
    const input = screen.getByDisplayValue("Test Session");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(defaultProps.onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Test Session")).toBeInTheDocument();
  });

  it("shows streaming status when isStreaming is true", () => {
    render(<SessionTab {...defaultProps} isStreaming={true} />);
    const dot = screen.getByTestId("status-dot");
    expect(dot).toHaveAttribute("data-color", "yellow");
    expect(dot).toHaveAttribute("data-pulse", "true");
  });
});
