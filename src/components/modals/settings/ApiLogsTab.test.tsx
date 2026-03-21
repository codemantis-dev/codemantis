import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const { mockGetApiLogs, mockGetApiCostSummary, mockCleanupApiLogs } = vi.hoisted(() => ({
  mockGetApiLogs: vi.fn(),
  mockGetApiCostSummary: vi.fn(),
  mockCleanupApiLogs: vi.fn(),
}));

vi.mock("../../../lib/tauri-commands", () => ({
  getApiLogs: mockGetApiLogs,
  getApiCostSummary: mockGetApiCostSummary,
  cleanupApiLogs: mockCleanupApiLogs,
}));

import ApiLogsTab from "./ApiLogsTab";
import type { ApiLogEntry, ApiCostSummary } from "../../../types/api-logs";

// ── Test data ──

const sampleLog: ApiLogEntry = {
  id: "log-1",
  timestamp: "2026-03-21T10:00:00Z",
  provider: "anthropic",
  model: "claude-opus-4-6",
  sessionId: "s1",
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: 0.05,
  success: true,
  errorMessage: null,
};

const errorLog: ApiLogEntry = {
  ...sampleLog,
  id: "log-2",
  provider: "openai",
  model: "gpt-4",
  success: false,
  errorMessage: "Rate limit exceeded",
  costUsd: 0,
};

const emptySummary: ApiCostSummary = {
  totalCost: 0,
  totalCalls: 0,
  byProvider: [],
};

const summary: ApiCostSummary = {
  totalCost: 0.15,
  totalCalls: 3,
  byProvider: [
    { provider: "anthropic", cost: 0.10, calls: 2 },
    { provider: "openai", cost: 0.05, calls: 1 },
  ],
};

// ── Helpers ──

function setupMocks(logs: ApiLogEntry[] = [], costSummary: ApiCostSummary = emptySummary): void {
  mockCleanupApiLogs.mockResolvedValue(0);
  mockGetApiLogs.mockResolvedValue(logs);
  mockGetApiCostSummary.mockResolvedValue(costSummary);
}

async function renderAndWait(): Promise<ReturnType<typeof render>> {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<ApiLogsTab />);
  });
  // Wait for loading to finish
  await waitFor(() => {
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
  return result!;
}

// ── Tests ──

describe("ApiLogsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  // ── Loading state ──

  it("shows loading state initially", () => {
    setupMocks();
    // Don't resolve yet — render synchronously to see loading
    render(<ApiLogsTab />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  // ── Empty state ──

  it("shows empty state when no logs exist", async () => {
    setupMocks([], emptySummary);
    await renderAndWait();
    expect(screen.getByText("No API calls logged yet")).toBeInTheDocument();
  });

  it("auto-cleans up logs older than 5 days on mount", async () => {
    setupMocks();
    await renderAndWait();
    expect(mockCleanupApiLogs).toHaveBeenCalledWith(5);
  });

  // ── Cost tab ──

  it("renders cost summary when logs exist", async () => {
    setupMocks([sampleLog], summary);
    await renderAndWait();
    expect(screen.getByText("Total Cost")).toBeInTheDocument();
    expect(screen.getByText("Total Calls")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders cost log entries", async () => {
    setupMocks([sampleLog], summary);
    await renderAndWait();
    expect(screen.getByText("claude-opus-4-6")).toBeInTheDocument();
    expect(screen.getByText("1500 tok")).toBeInTheDocument();
  });

  it("shows provider breakdown in cost summary", async () => {
    setupMocks([sampleLog], summary);
    await renderAndWait();
    // "anthropic" appears in both the provider breakdown and the log entry row
    const matches = screen.getAllByText("anthropic");
    expect(matches.length).toBeGreaterThanOrEqual(2); // breakdown + log entry
  });

  // ── Error tab ──

  it("switches to error tab and shows error logs", async () => {
    setupMocks([sampleLog, errorLog], summary);
    await renderAndWait();

    const errorTab = screen.getByText("Error Log (1)");
    fireEvent.click(errorTab);

    expect(screen.getByText("Total Errors")).toBeInTheDocument();
    expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument();
  });

  it("shows empty error state when no errors exist", async () => {
    setupMocks([sampleLog], summary);
    await renderAndWait();

    const errorTab = screen.getByText("Error Log");
    fireEvent.click(errorTab);

    expect(screen.getByText("No errors logged")).toBeInTheDocument();
  });

  it("expands error details on click", async () => {
    setupMocks([errorLog], summary);
    await renderAndWait();

    const errorTab = screen.getByText("Error Log (1)");
    fireEvent.click(errorTab);

    // Click the error row to expand
    const errorRow = screen.getByRole("button", { name: /Rate limit exceeded/i });
    fireEvent.click(errorRow);

    // The expanded detail should show the full error message
    const errorDetails = screen.getAllByText("Rate limit exceeded");
    expect(errorDetails.length).toBeGreaterThanOrEqual(2); // row + expanded detail
  });

  it("collapses error details on second click", async () => {
    setupMocks([errorLog], summary);
    await renderAndWait();

    fireEvent.click(screen.getByText("Error Log (1)"));
    const errorRow = screen.getByRole("button", { name: /Rate limit exceeded/i });

    // First click expands
    fireEvent.click(errorRow);
    const expanded = screen.getAllByText("Rate limit exceeded");
    expect(expanded.length).toBeGreaterThanOrEqual(2);

    // Second click collapses
    fireEvent.click(errorRow);
    await waitFor(() => {
      // Should be back to just the row text
      const collapsed = screen.getAllByText("Rate limit exceeded");
      expect(collapsed.length).toBe(1);
    });
  });

  it("shows error count by provider", async () => {
    const err2: ApiLogEntry = { ...errorLog, id: "log-3", provider: "openai" };
    setupMocks([errorLog, err2], summary);
    await renderAndWait();

    fireEvent.click(screen.getByText("Error Log (2)"));
    expect(screen.getByText("2 errors")).toBeInTheDocument();
  });

  // ── Diagnostics section ──

  it("renders Diagnostics section with log path", async () => {
    setupMocks();
    await renderAndWait();
    expect(screen.getByText("Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("~/Library/Logs/dev.codemantis.myapp/codemantis.log")).toBeInTheDocument();
  });

  it("renders Copy Log Path button", async () => {
    setupMocks();
    await renderAndWait();
    expect(screen.getByText("Copy Log Path")).toBeInTheDocument();
  });

  it("copies log path to clipboard on button click", async () => {
    setupMocks();
    await renderAndWait();

    const btn = screen.getByText("Copy Log Path");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "~/Library/Logs/dev.codemantis.myapp/codemantis.log"
    );
  });

  it("shows Copied! feedback after clicking Copy Log Path", async () => {
    setupMocks();
    await renderAndWait();

    const btn = screen.getByText("Copy Log Path");
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });

  // ── Error handling ──

  it("handles load failure gracefully", async () => {
    mockCleanupApiLogs.mockResolvedValue(0);
    mockGetApiLogs.mockRejectedValue(new Error("DB error"));
    mockGetApiCostSummary.mockRejectedValue(new Error("DB error"));

    vi.spyOn(console, "error").mockImplementation(() => {});

    await renderAndWait();
    // Should show empty state after error, not crash
    expect(screen.getByText("No API calls logged yet")).toBeInTheDocument();
  });

  // ── Tab switching ──

  it("defaults to cost tab", async () => {
    setupMocks([sampleLog], summary);
    await renderAndWait();
    // Cost tab content should be visible
    expect(screen.getByText("Total Cost")).toBeInTheDocument();
  });

  it("switches between cost and error tabs", async () => {
    setupMocks([sampleLog, errorLog], summary);
    await renderAndWait();

    // Start on cost tab
    expect(screen.getByText("Total Cost")).toBeInTheDocument();

    // Switch to error tab
    fireEvent.click(screen.getByText("Error Log (1)"));
    expect(screen.getByText("Total Errors")).toBeInTheDocument();

    // Switch back to cost tab
    fireEvent.click(screen.getByText("Cost Log"));
    expect(screen.getByText("Total Cost")).toBeInTheDocument();
  });

  // ── Auto-cleanup note ──

  it("shows auto-cleanup note", async () => {
    setupMocks();
    await renderAndWait();
    expect(screen.getByText("Logs older than 5 days are automatically deleted.")).toBeInTheDocument();
  });
});
