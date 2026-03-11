import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TemplateDetail from "./TemplateDetail";
import type { TemplateEntry } from "../../types/project-templates";

// Mock tauri dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

// Mock tauri opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const TEMPLATE: TemplateEntry = {
  id: "nextjs-boilerplate",
  name: "Next.js Full-Stack",
  description: "Short description.",
  long_description: "Full detailed description of the template with all features explained.",
  category: "full-stack",
  tags: ["next.js", "react", "typescript", "tailwind"],
  repo_url: "https://github.com/example/nextjs",
  branch: "main",
  stars: 12700,
  license: "MIT",
  install_command: "npm install",
  dev_command: "npm run dev",
  icon: "triangle",
  verified: true,
  last_verified: "2026-03-10",
  scaffold_type: "git-clone",
};

describe("TemplateDetail", () => {
  const defaultProps = {
    template: TEMPLATE,
    onBack: vi.fn(),
    onUseTemplate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders template name", () => {
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.getByText("Next.js Full-Stack")).toBeInTheDocument();
  });

  it("renders long description when available", () => {
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.getByText(/Full detailed description/)).toBeInTheDocument();
  });

  it("falls back to short description when no long_description", () => {
    const noLong = { ...TEMPLATE, long_description: undefined };
    render(<TemplateDetail {...defaultProps} template={noLong} />);
    expect(screen.getByText("Short description.")).toBeInTheDocument();
  });

  it("renders all tags", () => {
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.getByText("next.js")).toBeInTheDocument();
    expect(screen.getByText("react")).toBeInTheDocument();
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.getByText("tailwind")).toBeInTheDocument();
  });

  it("renders star count and license", () => {
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.getByText("12.7K stars")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
  });

  it("renders Back button and calls onBack", () => {
    const onBack = vi.fn();
    render(<TemplateDetail {...defaultProps} onBack={onBack} />);
    fireEvent.click(screen.getByText("Back to templates"));
    expect(onBack).toHaveBeenCalled();
  });

  it("renders project name input pre-filled with slugified name", () => {
    render(<TemplateDetail {...defaultProps} />);
    const input = screen.getByDisplayValue("next-js-full-stack");
    expect(input).toBeInTheDocument();
  });

  it("renders location picker", () => {
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.getByText("Choose a folder...")).toBeInTheDocument();
  });

  it("renders View on GitHub link", () => {
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.getByText("View on GitHub")).toBeInTheDocument();
  });

  it("renders Use This Template button", () => {
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.getByText("Use This Template")).toBeInTheDocument();
  });

  it("shows validation error for empty project name", () => {
    localStorage.setItem("codemantis-last-scaffold-dir", "/tmp");
    render(<TemplateDetail {...defaultProps} />);
    const input = screen.getByDisplayValue("next-js-full-stack");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByText("Use This Template"));
    expect(screen.getByText("Project name is required")).toBeInTheDocument();
  });

  it("shows validation error for invalid characters", () => {
    localStorage.setItem("codemantis-last-scaffold-dir", "/tmp");
    render(<TemplateDetail {...defaultProps} />);
    const input = screen.getByDisplayValue("next-js-full-stack");
    fireEvent.change(input, { target: { value: "my project!" } });
    fireEvent.click(screen.getByText("Use This Template"));
    expect(screen.getByText("Only letters, numbers, hyphens, underscores, dots")).toBeInTheDocument();
  });

  it("shows validation error when name starts with dot", () => {
    localStorage.setItem("codemantis-last-scaffold-dir", "/tmp");
    render(<TemplateDetail {...defaultProps} />);
    const input = screen.getByDisplayValue("next-js-full-stack");
    fireEvent.change(input, { target: { value: ".hidden" } });
    fireEvent.click(screen.getByText("Use This Template"));
    expect(screen.getByText("Cannot start with '.' or '-'")).toBeInTheDocument();
  });

  it("shows prerequisites warning when present", () => {
    const withPrereq = { ...TEMPLATE, prerequisites: "Requires Docker" };
    render(<TemplateDetail {...defaultProps} template={withPrereq} />);
    expect(screen.getByText("Requires Docker")).toBeInTheDocument();
  });

  it("does not show View on GitHub for templates without repo_url", () => {
    const noRepo = { ...TEMPLATE, repo_url: "" };
    render(<TemplateDetail {...defaultProps} template={noRepo} />);
    expect(screen.queryByText("View on GitHub")).not.toBeInTheDocument();
  });

  it("remembers last scaffold directory from localStorage", () => {
    localStorage.setItem("codemantis-last-scaffold-dir", "/Users/test/projects");
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.getByText("/Users/test/projects")).toBeInTheDocument();
  });
});
