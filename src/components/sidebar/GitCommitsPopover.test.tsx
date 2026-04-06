import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GitCommitsPopover from "./GitCommitsPopover";
import type { GitCommit } from "../../types/git";

// Mock Portal to render children inline (avoids createPortal issues in tests)
vi.mock("../shared/Portal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockGetGitLog = vi.fn();
vi.mock("../../lib/tauri-commands", () => ({
  getGitLog: (...args: unknown[]) => mockGetGitLog(...args),
}));

const sampleCommits: GitCommit[] = [
  {
    hash: "abc1234",
    message: "fix: resolve login bug",
    author: "Alice",
    timestamp: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
  },
  {
    hash: "def5678",
    message: "feat: add dark mode",
    author: "Bob",
    timestamp: new Date(Date.now() - 3_600_000).toISOString(), // 1 hour ago
  },
];

describe("GitCommitsPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitLog.mockResolvedValue(sampleCommits);
  });

  it("renders commit list after clicking trigger", async () => {
    render(<GitCommitsPopover projectPath="/tmp/project" branch="main" />);
    fireEvent.click(screen.getByTitle("Recent commits"));

    await waitFor(() => {
      expect(screen.getByText("Recent Commits")).toBeInTheDocument();
    });
    expect(screen.getByText("fix: resolve login bug")).toBeInTheDocument();
    expect(screen.getByText("feat: add dark mode")).toBeInTheDocument();
  });

  it("displays hash, message, and author for each commit", async () => {
    render(<GitCommitsPopover projectPath="/tmp/project" branch="main" />);
    fireEvent.click(screen.getByTitle("Recent commits"));

    await waitFor(() => {
      expect(screen.getByText("abc1234")).toBeInTheDocument();
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("def5678")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows loading state", async () => {
    // Make getGitLog hang until resolved manually
    let resolvePromise!: (v: GitCommit[]) => void;
    mockGetGitLog.mockReturnValue(new Promise<GitCommit[]>((res) => { resolvePromise = res; }));

    render(<GitCommitsPopover projectPath="/tmp/project" branch="dev" />);
    fireEvent.click(screen.getByTitle("Recent commits"));

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // Resolve so the test doesn't leak
    resolvePromise(sampleCommits);
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  it("handles empty commit list", async () => {
    mockGetGitLog.mockResolvedValue([]);

    render(<GitCommitsPopover projectPath="/tmp/project" branch="main" />);
    fireEvent.click(screen.getByTitle("Recent commits"));

    await waitFor(() => {
      expect(screen.getByText("No commits found")).toBeInTheDocument();
    });
  });
});
