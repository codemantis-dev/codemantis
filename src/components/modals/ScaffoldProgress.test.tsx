import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ScaffoldProgress from "./ScaffoldProgress";
import type { TemplateEntry } from "../../types/project-templates";

// Mock the tauri commands listen
vi.mock("../../lib/tauri-commands", () => ({
  listenScaffoldProgress: vi.fn(() => Promise.resolve(() => {})),
}));

const TEMPLATE: TemplateEntry = {
  id: "nextjs-boilerplate",
  name: "Next.js Full-Stack",
  description: "Test",
  category: "full-stack",
  tags: ["next.js"],
  repo_url: "https://github.com/example/nextjs",
  branch: "main",
  license: "MIT",
  install_command: "npm install",
  dev_command: "npm run dev",
  icon: "triangle",
  verified: true,
  last_verified: "2026-03-10",
  scaffold_type: "git-clone",
};

const CLI_TEMPLATE: TemplateEntry = {
  ...TEMPLATE,
  id: "astro-starter",
  scaffold_type: "cli",
  cli_command: "pnpm create astro",
};

describe("ScaffoldProgress", () => {
  const defaultProps = {
    template: TEMPLATE,
    projectName: "my-project",
    resultPath: null,
    scaffoldError: null,
    onOpenProject: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders project name in header", () => {
    render(<ScaffoldProgress {...defaultProps} />);
    expect(screen.getByText("Setting up: my-project")).toBeInTheDocument();
  });

  it("shows git-clone steps for git-clone templates", () => {
    render(<ScaffoldProgress {...defaultProps} />);
    expect(screen.getByText("Validating environment")).toBeInTheDocument();
    expect(screen.getByText("Cloning template")).toBeInTheDocument();
    expect(screen.getByText("Cleaning up")).toBeInTheDocument();
    expect(screen.getByText("Installing dependencies")).toBeInTheDocument();
    expect(screen.getByText("Setting up CLAUDE.md")).toBeInTheDocument();
    expect(screen.getByText("Finalizing project")).toBeInTheDocument();
  });

  it("shows CLI steps for CLI-generated templates", () => {
    render(<ScaffoldProgress {...defaultProps} template={CLI_TEMPLATE} />);
    expect(screen.getByText("Generating project")).toBeInTheDocument();
    expect(screen.getByText("Running post-setup")).toBeInTheDocument();
  });

  it("shows cancel button while in progress", () => {
    render(<ScaffoldProgress {...defaultProps} />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<ScaffoldProgress {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows Open in CodeMantis when result is available", () => {
    render(<ScaffoldProgress {...defaultProps} resultPath="/tmp/my-project" />);
    expect(screen.getByText("Project ready!")).toBeInTheDocument();
    expect(screen.getByText("Open in CodeMantis")).toBeInTheDocument();
  });

  it("calls onOpenProject when Open button is clicked", () => {
    const onOpen = vi.fn();
    render(<ScaffoldProgress {...defaultProps} resultPath="/tmp/my-project" onOpenProject={onOpen} />);
    fireEvent.click(screen.getByText("Open in CodeMantis"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("shows error message and retry button on scaffold error", () => {
    render(
      <ScaffoldProgress
        {...defaultProps}
        scaffoldError="Network error: could not clone"
      />
    );
    expect(screen.getByText("Network error: could not clone")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("calls onRetry when Retry is clicked", () => {
    const onRetry = vi.fn();
    render(
      <ScaffoldProgress
        {...defaultProps}
        scaffoldError="Something failed"
        onRetry={onRetry}
      />
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalled();
  });
});
