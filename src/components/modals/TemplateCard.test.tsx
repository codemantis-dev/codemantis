import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TemplateCard from "./TemplateCard";
import type { TemplateEntry } from "../../types/project-templates";

const TEMPLATE: TemplateEntry = {
  id: "nextjs-boilerplate",
  name: "Next.js Full-Stack",
  description: "Production-ready Next.js 16 with TypeScript and Tailwind.",
  category: "full-stack",
  tags: ["next.js", "react", "typescript", "tailwind", "drizzle"],
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

describe("TemplateCard", () => {
  it("renders template name", () => {
    render(<TemplateCard template={TEMPLATE} onSelect={vi.fn()} />);
    expect(screen.getByText("Next.js Full-Stack")).toBeInTheDocument();
  });

  it("renders description", () => {
    render(<TemplateCard template={TEMPLATE} onSelect={vi.fn()} />);
    expect(screen.getByText(TEMPLATE.description)).toBeInTheDocument();
  });

  it("renders first 3 tags and shows +N for overflow", () => {
    render(<TemplateCard template={TEMPLATE} onSelect={vi.fn()} />);
    expect(screen.getByText("next.js")).toBeInTheDocument();
    expect(screen.getByText("react")).toBeInTheDocument();
    expect(screen.getByText("typescript")).toBeInTheDocument();
    // 5 tags total, 3 shown → "+2"
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("renders star count formatted", () => {
    render(<TemplateCard template={TEMPLATE} onSelect={vi.fn()} />);
    expect(screen.getByText("12.7K stars")).toBeInTheDocument();
  });

  it("renders license", () => {
    render(<TemplateCard template={TEMPLATE} onSelect={vi.fn()} />);
    expect(screen.getByText("MIT")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<TemplateCard template={TEMPLATE} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Next.js Full-Stack"));
    expect(onSelect).toHaveBeenCalledWith(TEMPLATE);
  });

  it("shows CLI badge for CLI-generated templates", () => {
    const cliTemplate: TemplateEntry = {
      ...TEMPLATE,
      scaffold_type: "cli",
      cli_command: "pnpm create vite",
    };
    render(<TemplateCard template={cliTemplate} onSelect={vi.fn()} />);
    expect(screen.getByText("CLI")).toBeInTheDocument();
  });

  it("does not show star count when not provided", () => {
    const noStars = { ...TEMPLATE, stars: undefined };
    render(<TemplateCard template={noStars} onSelect={vi.fn()} />);
    expect(screen.queryByText(/stars/)).not.toBeInTheDocument();
  });

  it("shows all tags when 3 or fewer", () => {
    const fewTags = { ...TEMPLATE, tags: ["react", "typescript"] };
    render(<TemplateCard template={fewTags} onSelect={vi.fn()} />);
    expect(screen.getByText("react")).toBeInTheDocument();
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });
});
