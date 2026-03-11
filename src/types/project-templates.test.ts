import { describe, it, expect } from "vitest";
import {
  TEMPLATE_CATEGORIES,
  GIT_CLONE_STEPS,
  CLI_SCAFFOLD_STEPS,
} from "./project-templates";

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
    expect(steps).toEqual(["validate", "clone", "clean", "install", "claude_md", "commit"]);
  });

  it("CLI_SCAFFOLD_STEPS has the correct pipeline order", () => {
    const steps = CLI_SCAFFOLD_STEPS.map((s) => s.step);
    expect(steps).toEqual(["validate", "generate", "configure", "install", "claude_md", "commit"]);
  });

  it("all steps have non-empty labels", () => {
    for (const step of GIT_CLONE_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
    }
    for (const step of CLI_SCAFFOLD_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
    }
  });
});
