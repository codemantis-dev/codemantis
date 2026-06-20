import { describe, it, expect } from "vitest";
import { CATEGORY_CONFIG } from "./changelog-utils";
import type { ChangelogCategory } from "../types/changelog";

const ALL_CATEGORIES: ChangelogCategory[] = [
  "feature",
  "bugfix",
  "refactor",
  "docs",
  "config",
  "test",
  "plan",
  "duo-coding",
];

describe("CATEGORY_CONFIG", () => {
  it("every category has an icon, color, and label", () => {
    for (const category of ALL_CATEGORIES) {
      const config = CATEGORY_CONFIG[category];
      expect(config).toBeDefined();
      expect(config.icon).toBeDefined();
      expect(typeof config.color).toBe("string");
      expect(typeof config.label).toBe("string");
    }
  });

  it('feature has label "Feature"', () => {
    expect(CATEGORY_CONFIG.feature.label).toBe("Feature");
  });

  it('bugfix has label "Bug Fix"', () => {
    expect(CATEGORY_CONFIG.bugfix.label).toBe("Bug Fix");
  });

  it("all expected categories exist", () => {
    const keys = Object.keys(CATEGORY_CONFIG);
    expect(keys.sort()).toEqual(ALL_CATEGORIES.sort());
  });

  it('color strings start with "text-"', () => {
    for (const category of ALL_CATEGORIES) {
      expect(CATEGORY_CONFIG[category].color).toMatch(/^text-/);
    }
  });
});
