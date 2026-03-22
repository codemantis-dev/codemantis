import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
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

const mockCheckPrerequisites = vi.fn();
const mockInstallPrerequisite = vi.fn();

vi.mock("../../lib/tauri-commands", () => ({
  checkTemplatePrerequisites: (...args: unknown[]) => mockCheckPrerequisites(...args),
  installPrerequisite: (...args: unknown[]) => mockInstallPrerequisite(...args),
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

const TEMPLATE_WITH_CHECKS: TemplateEntry = {
  ...TEMPLATE,
  id: "fastapi-boilerplate",
  name: "FastAPI Boilerplate",
  prerequisites: "Requires uv and Docker",
  prerequisite_checks: [
    { command: "uv", label: "uv package manager", required: true, install_command: "brew install uv" },
    { command: "docker", label: "Docker", required: true, install_command: "brew install --cask docker" },
  ],
};

const TEMPLATE_WITH_OPTIONAL: TemplateEntry = {
  ...TEMPLATE,
  id: "next-forge",
  name: "next-forge",
  prerequisite_checks: [
    { command: "mintlify", label: "Mintlify CLI", required: false, install_command: "npm install -g mintlify" },
    { command: "stripe", label: "Stripe CLI", required: false, install_command: "brew install stripe/stripe-cli/stripe" },
  ],
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
    mockCheckPrerequisites.mockResolvedValue([]);
    mockInstallPrerequisite.mockResolvedValue({ success: true, output: "" });
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
    expect(screen.getByText("Project name can only contain letters, numbers, hyphens, underscores, and dots (no spaces)")).toBeInTheDocument();
  });

  it("shows validation error when name starts with dot", () => {
    localStorage.setItem("codemantis-last-scaffold-dir", "/tmp");
    render(<TemplateDetail {...defaultProps} />);
    const input = screen.getByDisplayValue("next-js-full-stack");
    fireEvent.change(input, { target: { value: ".hidden" } });
    fireEvent.click(screen.getByText("Use This Template"));
    expect(screen.getByText("Project name cannot start with '.' or '-'")).toBeInTheDocument();
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

  // ── Prerequisite checks ──

  it("does not show prerequisites section for templates without checks", () => {
    render(<TemplateDetail {...defaultProps} />);
    expect(screen.queryByText("Prerequisites")).not.toBeInTheDocument();
  });

  it("calls checkTemplatePrerequisites on mount for templates with checks", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: true, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    expect(mockCheckPrerequisites).toHaveBeenCalledWith(TEMPLATE_WITH_CHECKS.prerequisite_checks);
  });

  it("shows green checks for found prerequisites", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: true, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    expect(screen.getByText("Prerequisites")).toBeInTheDocument();
    expect(screen.getByText("uv package manager")).toBeInTheDocument();
    expect(screen.getByText("Docker")).toBeInTheDocument();
    // No "required" labels shown when found
    expect(screen.queryByText("required")).not.toBeInTheDocument();
  });

  it("shows red X and 'required' label for missing required prerequisites", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: false, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    expect(screen.getByText("uv package manager")).toBeInTheDocument();
    expect(screen.getByText("required")).toBeInTheDocument();
  });

  it("shows 'optional' label for missing optional prerequisites", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "mintlify", label: "Mintlify CLI", found: false, required: false },
      { command: "stripe", label: "Stripe CLI", found: false, required: false },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_OPTIONAL} />);
    });

    const optionals = screen.getAllByText("optional");
    expect(optionals).toHaveLength(2);
  });

  it("disables Use This Template button when required prerequisites are missing", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: false, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);
    localStorage.setItem("codemantis-last-scaffold-dir", "/tmp");

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    const button = screen.getByText("Use This Template");
    expect(button).toBeDisabled();
  });

  it("enables Use This Template button when only optional prerequisites are missing", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "mintlify", label: "Mintlify CLI", found: false, required: false },
      { command: "stripe", label: "Stripe CLI", found: false, required: false },
    ]);
    localStorage.setItem("codemantis-last-scaffold-dir", "/tmp");

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_OPTIONAL} />);
    });

    const button = screen.getByText("Use This Template");
    expect(button).not.toBeDisabled();
  });

  it("shows Install button for missing prerequisites with install_command", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: false, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    const installButtons = screen.getAllByText("Install");
    expect(installButtons).toHaveLength(1);
  });

  it("does not show Install button for found prerequisites", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: true, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    expect(screen.queryByText("Install")).not.toBeInTheDocument();
  });

  it("shows Re-check button when prerequisites are missing", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: false, required: true },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    expect(screen.getByText("Re-check")).toBeInTheDocument();
  });

  it("does not show Re-check button when all prerequisites are met", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: true, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    expect(screen.queryByText("Re-check")).not.toBeInTheDocument();
  });

  it("Re-check button re-runs prerequisite checks", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: false, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    expect(mockCheckPrerequisites).toHaveBeenCalledTimes(1);

    // Now simulate user installed uv manually
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: true, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);

    await act(async () => {
      fireEvent.click(screen.getByText("Re-check"));
    });

    expect(mockCheckPrerequisites).toHaveBeenCalledTimes(2);
  });

  it("Install button calls installPrerequisite with correct command", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: false, required: true },
      { command: "docker", label: "Docker", found: true, required: true },
    ]);
    mockInstallPrerequisite.mockResolvedValue({ success: true, output: "Installed!" });

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Install"));
    });

    expect(mockInstallPrerequisite).toHaveBeenCalledWith("brew install uv");
  });

  it("auto-rechecks after successful install", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: false, required: true },
    ]);
    mockInstallPrerequisite.mockResolvedValue({ success: true, output: "" });

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    // Initial check + recheck after install = 2
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: true, required: true },
    ]);

    await act(async () => {
      fireEvent.click(screen.getByText("Install"));
    });

    await waitFor(() => {
      expect(mockCheckPrerequisites).toHaveBeenCalledTimes(2);
    });
  });

  it("shows error message when install fails", async () => {
    mockCheckPrerequisites.mockResolvedValue([
      { command: "uv", label: "uv package manager", found: false, required: true },
    ]);
    mockInstallPrerequisite.mockResolvedValue({
      success: false,
      output: "Error: brew not found",
    });

    await act(async () => {
      render(<TemplateDetail {...defaultProps} template={TEMPLATE_WITH_CHECKS} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Install"));
    });

    await waitFor(() => {
      expect(screen.getByText("Error: brew not found")).toBeInTheDocument();
    });
  });
});
