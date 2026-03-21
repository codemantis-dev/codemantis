import { describe, it, expect } from "vitest";
import {
  TEMPLATE_CATEGORIES,
  GIT_CLONE_STEPS,
  CLI_SCAFFOLD_STEPS,
  GIT_CLONE_FROM_URL_STEPS,
} from "./project-templates";
import type { ProjectAnalysis } from "./project-templates";

describe("project-templates types", () => {
  it("TEMPLATE_CATEGORIES includes all expected categories", () => {
    const ids = TEMPLATE_CATEGORIES.map((c) => c.id);
    expect(ids).toContain("all");
    expect(ids).toContain("frontend");
    expect(ids).toContain("full-stack");
    expect(ids).toContain("backend");
    expect(ids).toContain("mobile");
    expect(ids).toContain("static");
  });

  it("GIT_CLONE_STEPS has the correct pipeline order", () => {
    const steps = GIT_CLONE_STEPS.map((s) => s.step);
    expect(steps).toEqual(["validate", "clone", "clean", "install", "verify", "claude_md", "commit"]);
  });

  it("CLI_SCAFFOLD_STEPS has install before configure", () => {
    const steps = CLI_SCAFFOLD_STEPS.map((s) => s.step);
    expect(steps).toEqual(["validate", "generate", "install", "configure", "verify", "claude_md", "commit"]);
  });

  it("all steps have non-empty labels", () => {
    for (const step of GIT_CLONE_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
    }
    for (const step of CLI_SCAFFOLD_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
    }
    for (const step of GIT_CLONE_FROM_URL_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
    }
  });
});

describe("GIT_CLONE_FROM_URL_STEPS", () => {
  it("has expected steps in order", () => {
    const stepNames = GIT_CLONE_FROM_URL_STEPS.map((s) => s.step);
    expect(stepNames).toEqual(["validate", "clone", "install", "claude_md", "verify"]);
  });

  it("does NOT include clean or commit steps (unlike template scaffold)", () => {
    const stepNames = GIT_CLONE_FROM_URL_STEPS.map((s) => s.step);
    expect(stepNames).not.toContain("clean");
    expect(stepNames).not.toContain("commit");
  });

  it("has clone step labeled 'Cloning repository'", () => {
    const cloneStep = GIT_CLONE_FROM_URL_STEPS.find((s) => s.step === "clone");
    expect(cloneStep?.label).toBe("Cloning repository");
  });

  it("has claude_md step labeled 'Generating CLAUDE.md'", () => {
    const step = GIT_CLONE_FROM_URL_STEPS.find((s) => s.step === "claude_md");
    expect(step?.label).toBe("Generating CLAUDE.md");
  });
});

describe("ProjectAnalysis type", () => {
  it("can be constructed with all fields", () => {
    const analysis: ProjectAnalysis = {
      name: "test",
      description: "A test project",
      framework: "Next.js",
      framework_version: "15.0.0",
      language: "TypeScript/JavaScript",
      router_type: "App Router",
      css_framework: "Tailwind CSS",
      database: "PostgreSQL",
      orm: "Prisma",
      auth: "Clerk",
      test_framework: "Vitest",
      state_management: "Zustand",
      deployment: "Vercel",
      scripts: [["dev", "next dev"]],
      env_vars: ["DATABASE_URL"],
      directory_tree: "src/\n  app/",
      key_directories: [["src/app", "Next.js routes"]],
      conventions: ["TypeScript strict"],
      architecture_notes: ["App Router"],
      has_monorepo: false,
      package_manager: "pnpm",
    };
    expect(analysis.name).toBe("test");
    expect(analysis.scripts).toHaveLength(1);
  });

  it("can be constructed with nullable fields as null", () => {
    const analysis: ProjectAnalysis = {
      name: "minimal",
      description: null,
      framework: null,
      framework_version: null,
      language: "Unknown",
      router_type: null,
      css_framework: null,
      database: null,
      orm: null,
      auth: null,
      test_framework: null,
      state_management: null,
      deployment: null,
      scripts: [],
      env_vars: [],
      directory_tree: "",
      key_directories: [],
      conventions: [],
      architecture_notes: [],
      has_monorepo: false,
      package_manager: null,
    };
    expect(analysis.framework).toBeNull();
    expect(analysis.scripts).toHaveLength(0);
  });
});
