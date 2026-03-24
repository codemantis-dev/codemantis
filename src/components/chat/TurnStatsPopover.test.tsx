import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TurnStatsPopover from "./TurnStatsPopover";
import type { TurnStats } from "../../types/session";

vi.mock("../../hooks/useClickOutside", () => ({
  useClickOutside: <T extends HTMLElement>() => ({ current: null } as React.RefObject<T | null>),
}));

function makeStats(overrides: Partial<TurnStats> = {}): TurnStats {
  return {
    durationMs: 2500,
    costUsd: 0.015,
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 200,
    cacheReadTokens: 100,
    ...overrides,
  };
}

describe("TurnStatsPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the summary button with total tokens", () => {
    const stats = makeStats();
    render(<TurnStatsPopover stats={stats} />);
    // Total = 1000 + 500 + 200 + 100 = 1800
    expect(screen.getByText(/1\.8K tokens/)).toBeInTheDocument();
  });

  it("shows cost in the summary when costUsd > 0", () => {
    const stats = makeStats({ costUsd: 0.015 });
    render(<TurnStatsPopover stats={stats} />);
    expect(screen.getByText("$0.015")).toBeInTheDocument();
  });

  it("does not show cost when costUsd is 0", () => {
    const stats = makeStats({ costUsd: 0 });
    render(<TurnStatsPopover stats={stats} />);
    // Only the token count should appear
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("opens popover on click and shows detailed breakdown", () => {
    const stats = makeStats();
    render(<TurnStatsPopover stats={stats} />);

    // Click to open
    fireEvent.click(screen.getByTitle("Turn context"));

    // Popover header
    expect(screen.getByText("Turn Context")).toBeInTheDocument();

    // Token breakdown rows
    expect(screen.getByText("Input tokens")).toBeInTheDocument();
    expect(screen.getByText("Output tokens")).toBeInTheDocument();
    expect(screen.getByText("Cache read")).toBeInTheDocument();
    expect(screen.getByText("Cache write")).toBeInTheDocument();
    expect(screen.getByText("Total tokens")).toBeInTheDocument();
  });

  it("shows duration in popover when durationMs is set", () => {
    const stats = makeStats({ durationMs: 3000 });
    render(<TurnStatsPopover stats={stats} />);

    fireEvent.click(screen.getByTitle("Turn context"));
    expect(screen.getByText("Duration")).toBeInTheDocument();
  });

  it("hides cache rows when cache tokens are zero", () => {
    const stats = makeStats({ cacheCreationTokens: 0, cacheReadTokens: 0 });
    render(<TurnStatsPopover stats={stats} />);

    fireEvent.click(screen.getByTitle("Turn context"));
    expect(screen.queryByText("Cache read")).not.toBeInTheDocument();
    expect(screen.queryByText("Cache write")).not.toBeInTheDocument();
  });

  it("toggles popover open and closed", () => {
    const stats = makeStats();
    render(<TurnStatsPopover stats={stats} />);

    const btn = screen.getByTitle("Turn context");

    // Open
    fireEvent.click(btn);
    expect(screen.getByText("Turn Context")).toBeInTheDocument();

    // Close
    fireEvent.click(btn);
    expect(screen.queryByText("Turn Context")).not.toBeInTheDocument();
  });
});
