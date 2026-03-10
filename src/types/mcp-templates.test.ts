import { describe, it, expect } from "vitest";
import { MCP_TEMPLATES, MCP_TEMPLATE_CATEGORIES } from "./mcp-templates";

describe("MCP Templates data integrity", () => {
  it("all template IDs are unique", () => {
    const ids = MCP_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all IDs match [a-zA-Z0-9_-]+ pattern", () => {
    for (const t of MCP_TEMPLATES) {
      expect(t.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it("stdio templates have command", () => {
    for (const t of MCP_TEMPLATES.filter((t) => t.serverType === "stdio")) {
      expect(t.command).toBeTruthy();
    }
  });

  it("http/sse templates have url", () => {
    for (const t of MCP_TEMPLATES.filter(
      (t) => t.serverType === "http" || t.serverType === "sse"
    )) {
      expect(t.url).toBeTruthy();
    }
  });

  it("all templates reference valid category IDs", () => {
    const categoryIds = new Set(MCP_TEMPLATE_CATEGORIES.map((c) => c.id));
    for (const t of MCP_TEMPLATES) {
      expect(categoryIds.has(t.category)).toBe(true);
    }
  });

  it("every category has at least one template", () => {
    for (const cat of MCP_TEMPLATE_CATEGORIES) {
      const count = MCP_TEMPLATES.filter((t) => t.category === cat.id).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  it("has exactly 15 templates", () => {
    expect(MCP_TEMPLATES.length).toBe(15);
  });
});
