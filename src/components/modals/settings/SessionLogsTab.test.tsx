import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SessionLogsTab from "./SessionLogsTab";

describe("SessionLogsTab", () => {
  const defaultProps = {
    enabled: false,
    retentionDays: 30,
    onEnabledChange: vi.fn(),
    onRetentionDaysChange: vi.fn(),
    codexDebugLoggingEnabled: true,
    onCodexDebugLoggingChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the section title", () => {
    render(<SessionLogsTab {...defaultProps} />);
    expect(screen.getByText("Session Logs")).toBeInTheDocument();
  });

  it("renders the explanation text", () => {
    render(<SessionLogsTab {...defaultProps} />);
    expect(screen.getByText(/Save the complete conversation/)).toBeInTheDocument();
  });

  it("renders the toggle label", () => {
    render(<SessionLogsTab {...defaultProps} />);
    expect(screen.getByText("Save session conversations")).toBeInTheDocument();
  });

  it("renders the toggle sub-explanation", () => {
    render(<SessionLogsTab {...defaultProps} />);
    expect(screen.getByText(/Store all messages when a session closes/)).toBeInTheDocument();
  });

  it("renders the Codex debug logging toggle and fires its change handler", () => {
    render(<SessionLogsTab {...defaultProps} codexDebugLoggingEnabled={true} />);
    const label = screen.getByText("Codex debug logging");
    expect(label).toBeInTheDocument();
    const toggleBtn = label.closest("div")?.parentElement?.querySelector("button");
    expect(toggleBtn).toBeTruthy();
    fireEvent.click(toggleBtn!);
    expect(defaultProps.onCodexDebugLoggingChange).toHaveBeenCalledWith(false);
  });

  it("calls onEnabledChange(true) when toggle clicked while disabled", () => {
    render(<SessionLogsTab {...defaultProps} enabled={false} />);
    const toggleBtn = screen.getByText("Save session conversations")
      .closest("div")?.parentElement?.querySelector("button");
    expect(toggleBtn).toBeTruthy();
    fireEvent.click(toggleBtn!);
    expect(defaultProps.onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("calls onEnabledChange(false) when toggle clicked while enabled", () => {
    render(<SessionLogsTab {...defaultProps} enabled={true} />);
    const toggleBtn = screen.getByText("Save session conversations")
      .closest("div")?.parentElement?.querySelector("button");
    expect(toggleBtn).toBeTruthy();
    fireEvent.click(toggleBtn!);
    expect(defaultProps.onEnabledChange).toHaveBeenCalledWith(false);
  });

  it("hides retention selector when disabled", () => {
    render(<SessionLogsTab {...defaultProps} enabled={false} />);
    expect(screen.queryByText("Retention period")).not.toBeInTheDocument();
  });

  it("shows retention selector when enabled", () => {
    render(<SessionLogsTab {...defaultProps} enabled={true} />);
    expect(screen.getByText("Retention period")).toBeInTheDocument();
  });

  it("shows retention cleanup explanation when enabled", () => {
    render(<SessionLogsTab {...defaultProps} enabled={true} />);
    expect(screen.getByText(/automatically cleaned up on app launch/)).toBeInTheDocument();
  });

  it("renders all retention options", () => {
    render(<SessionLogsTab {...defaultProps} enabled={true} />);
    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option"));
    const values = options.map((o) => o.getAttribute("value"));
    expect(values).toContain("7");
    expect(values).toContain("14");
    expect(values).toContain("30");
    expect(values).toContain("90");
    expect(values).toContain("365");
    expect(values).toContain("0"); // Forever
  });

  it("selects correct default retention value", () => {
    render(<SessionLogsTab {...defaultProps} enabled={true} retentionDays={30} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("30");
  });

  it("calls onRetentionDaysChange when dropdown changed", () => {
    render(<SessionLogsTab {...defaultProps} enabled={true} retentionDays={30} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "90" } });
    expect(defaultProps.onRetentionDaysChange).toHaveBeenCalledWith(90);
  });

  it("calls onRetentionDaysChange with 0 for 'Forever'", () => {
    render(<SessionLogsTab {...defaultProps} enabled={true} retentionDays={30} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "0" } });
    expect(defaultProps.onRetentionDaysChange).toHaveBeenCalledWith(0);
  });

  it("shows 'Forever' option text", () => {
    render(<SessionLogsTab {...defaultProps} enabled={true} />);
    expect(screen.getByText("Forever")).toBeInTheDocument();
  });
});
