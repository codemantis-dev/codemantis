import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const { mockGetApiLogs, mockGetApiCostSummary, mockCleanupApiLogs, mockRevealItemInDir, mockHomeDir } = vi.hoisted(() => ({
  mockGetApiLogs: vi.fn(),
  mockGetApiCostSummary: vi.fn(),
  mockCleanupApiLogs: vi.fn(),
  mockRevealItemInDir: vi.fn(),
  mockHomeDir: vi.fn(),
}));

vi.mock("../../../lib/tauri-commands", () => ({
  getApiLogs: mockGetApiLogs,
  getApiCostSummary: mockGetApiCostSummary,
  cleanupApiLogs: mockCleanupApiLogs,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: mockRevealItemInDir,
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: mockHomeDir,
}));

vi.mock("../../../stores/superBroStore", () => ({
  useSuperBroStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ log: [] }),
    ),
    { setState: vi.fn(), getState: vi.fn(() => ({ log: [] })) },
  ),
}));

import ApiLogsTab from "./ApiLogsTab";
import type { ApiLogEntry, ApiCostSummary } from "../../../types/api-logs";

// ── Test data ──

const sampleLog: ApiLogEntry = {
  id: "log-1",
  timestamp: "2026-03-21T10:00:00Z",
  provider: "anthropic",
  model: "claude-opus-4-8",
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
    expect(screen.getByText("claude-opus-4-8")).toBeInTheDocument();
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

    // Click the error row to expand (use text + closest to avoid slow getByRole name computation)
    const errorText = screen.getByText("Rate limit exceeded");
    const errorRow = errorText.closest('[role="button"]')!;
    fireEvent.click(errorRow);

    // The expanded detail should show the full error message
    const errorDetails = screen.getAllByText("Rate limit exceeded");
    expect(errorDetails.length).toBeGreaterThanOrEqual(2); // row + expanded detail
  });

  it("collapses error details on second click", async () => {
    setupMocks([errorLog], summary);
    await renderAndWait();

    fireEvent.click(screen.getByText("Error Log (1)"));
    const errorText = screen.getByText("Rate limit exceeded");
    const errorRow = errorText.closest('[role="button"]')!;

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

  it("renders Open in Finder button", async () => {
    setupMocks();
    await renderAndWait();
    expect(screen.getByText("Open in Finder")).toBeInTheDocument();
  });

  it("calls revealItemInDir with resolved path on Open in Finder click", async () => {
    setupMocks();
    mockHomeDir.mockResolvedValue("/Users/test");
    mockRevealItemInDir.mockResolvedValue(undefined);
    await renderAndWait();

    const btn = screen.getByText("Open in Finder");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockHomeDir).toHaveBeenCalled();
    expect(mockRevealItemInDir).toHaveBeenCalledWith(
      "/Users/test/Library/Logs/dev.codemantis.myapp/codemantis.log"
    );
  });

  it("handles Open in Finder failure gracefully", async () => {
    setupMocks();
    mockHomeDir.mockRejectedValue(new Error("no home"));
    await renderAndWait();

    const btn = screen.getByText("Open in Finder");
    // Should not throw
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByText("Open in Finder")).toBeInTheDocument();
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

  // ── Copy buttons ──

  it("copies cost log entry to clipboard", async () => {
    setupMocks([sampleLog], summary);
    await renderAndWait();

    const copyBtn = screen.getByTitle("Copy entry");
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const call = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call).toContain("anthropic");
    expect(call).toContain("claude-opus-4-8");
  });

  it("copies error log entry to clipboard", async () => {
    setupMocks([errorLog], summary);
    await renderAndWait();

    fireEvent.click(screen.getByText("Error Log (1)"));

    const copyBtn = screen.getByTitle("Copy entry");
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const call = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call).toContain("Rate limit exceeded");
  });

  it("copies expanded error detail to clipboard", async () => {
    setupMocks([errorLog], summary);
    await renderAndWait();

    fireEvent.click(screen.getByText("Error Log (1)"));

    // Expand the error
    const errorRow = screen.getByRole("button", { name: /Rate limit exceeded/i });
    fireEvent.click(errorRow);

    const detailCopyBtn = screen.getByTitle("Copy error message");
    await act(async () => {
      fireEvent.click(detailCopyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Rate limit exceeded");
  });

  // ── Cost by Feature matrix ─────────────────────────────────────

  it("renders cost-by-feature matrix with provider rows and feature columns", async () => {
    const featureLogs: ApiLogEntry[] = [
      { ...sampleLog, id: "cl-1", provider: "gemini", sessionId: "session-abc", costUsd: 0.02 },
      { ...sampleLog, id: "as-1", provider: "openai", sessionId: "api-asst-123-xyz", costUsd: 1.50 },
      { ...sampleLog, id: "sb-1", provider: "openai", sessionId: "__super-bro__", costUsd: 0.03 },
    ];
    mockCleanupApiLogs.mockResolvedValue(undefined);
    mockGetApiLogs.mockResolvedValue(featureLogs);
    mockGetApiCostSummary.mockResolvedValue({
      totalCost: 1.55,
      totalCalls: 3,
      byProvider: [
        { provider: "gemini", cost: 0.02, calls: 1 },
        { provider: "openai", cost: 1.53, calls: 2 },
      ],
    });

    await act(async () => {
      render(<ApiLogsTab />);
    });

    // Column headers exist in the table
    const table = document.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.textContent).toContain("Changelog");
    expect(table!.textContent).toContain("Assistant");
    expect(table!.textContent).toContain("Super-Bro");
    // Provider rows in the table
    expect(table!.textContent).toContain("gemini");
    expect(table!.textContent).toContain("openai");
    // Footer total row
    const tfoot = table!.querySelector("tfoot");
    expect(tfoot).not.toBeNull();
    expect(tfoot!.textContent).toContain("Total");
  });

  // ── Super-Bro tab ───────────────────────────────────────────────

  it("renders Super-Bro tab button", async () => {
    mockCleanupApiLogs.mockResolvedValue(undefined);
    mockGetApiLogs.mockResolvedValue([]);
    mockGetApiCostSummary.mockResolvedValue(emptySummary);

    await act(async () => {
      render(<ApiLogsTab />);
    });

    expect(screen.getByText("Super-Bro")).toBeInTheDocument();
  });

  it("shows empty state for Super-Bro when no log entries", async () => {
    mockCleanupApiLogs.mockResolvedValue(undefined);
    mockGetApiLogs.mockResolvedValue([]);
    mockGetApiCostSummary.mockResolvedValue(emptySummary);

    await act(async () => {
      render(<ApiLogsTab />);
    });

    fireEvent.click(screen.getByText("Super-Bro"));

    expect(screen.getByText("No Super-Bro activity yet")).toBeInTheDocument();
  });

  it("shows Super-Bro log entries when present", async () => {
    // Override the mock for this test to return log entries
    const { useSuperBroStore } = await import("../../../stores/superBroStore");
    const mockStore = useSuperBroStore as unknown as ReturnType<typeof vi.fn>;
    mockStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        log: [
          { timestamp: "2026-03-28T10:00:00Z", type: "trigger", message: "Event: claude_response" },
          { timestamp: "2026-03-28T10:00:01Z", type: "api_call", message: "Calling OpenAI gpt-5.4-mini" },
          { timestamp: "2026-03-28T10:00:03Z", type: "all_good", message: "NOTHING_TO_REPORT — all good" },
        ],
      }),
    );

    mockCleanupApiLogs.mockResolvedValue(undefined);
    mockGetApiLogs.mockResolvedValue([]);
    mockGetApiCostSummary.mockResolvedValue(emptySummary);

    await act(async () => {
      render(<ApiLogsTab />);
    });

    fireEvent.click(screen.getByText("Super-Bro"));

    expect(screen.getByText("Total Events")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // total count
    expect(screen.getByText(/claude_response/)).toBeInTheDocument();
    expect(screen.getByText(/Calling OpenAI/)).toBeInTheDocument();
  });
});
