import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GitStatusCard from "./GitStatusCard";
import type { GitStatusInfo } from "../../types/git";

vi.mock("../../lib/tauri-commands", () => ({}));

describe("GitStatusCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when not a git repo", () => {
    const gitStatus: GitStatusInfo = {
      is_git_repo: false,
      branch: null,
      uncommitted_changes: 0,
      last_commit_time: null,
      last_push_time: null,
    };
    const { container } = render(<GitStatusCard gitStatus={gitStatus} projectPath="/test" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders branch name", () => {
    const gitStatus: GitStatusInfo = {
      is_git_repo: true,
      branch: "main",
      uncommitted_changes: 0,
      last_commit_time: null,
      last_push_time: null,
    };
    render(<GitStatusCard gitStatus={gitStatus} projectPath="/test" />);
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows 'detached' when branch is null", () => {
    const gitStatus: GitStatusInfo = {
      is_git_repo: true,
      branch: null,
      uncommitted_changes: 0,
      last_commit_time: null,
      last_push_time: null,
    };
    render(<GitStatusCard gitStatus={gitStatus} projectPath="/test" />);
    expect(screen.getByText("detached")).toBeInTheDocument();
  });

  it("shows uncommitted changes count when > 0", () => {
    const gitStatus: GitStatusInfo = {
      is_git_repo: true,
      branch: "dev",
      uncommitted_changes: 5,
      last_commit_time: null,
      last_push_time: null,
    };
    render(<GitStatusCard gitStatus={gitStatus} projectPath="/test" />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByTitle("Uncommitted changes")).toBeInTheDocument();
  });

  it("does not show uncommitted changes badge when 0", () => {
    const gitStatus: GitStatusInfo = {
      is_git_repo: true,
      branch: "main",
      uncommitted_changes: 0,
      last_commit_time: null,
      last_push_time: null,
    };
    render(<GitStatusCard gitStatus={gitStatus} projectPath="/test" />);
    expect(screen.queryByTitle("Uncommitted changes")).not.toBeInTheDocument();
  });

  it("shows relative times for last commit and push", () => {
    const gitStatus: GitStatusInfo = {
      is_git_repo: true,
      branch: "main",
      uncommitted_changes: 0,
      last_commit_time: null,
      last_push_time: null,
    };
    render(<GitStatusCard gitStatus={gitStatus} projectPath="/test" />);
    // Both should show "never" when null
    const neverElements = screen.getAllByText("never");
    expect(neverElements).toHaveLength(2);
  });
});
