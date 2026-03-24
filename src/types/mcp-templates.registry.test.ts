import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { MCP_TEMPLATES } from "./mcp-templates";

interface RegistryEntry {
  id: string;
  serverType: "stdio" | "http";
  npmPackage?: string;
  pypiPackage?: string;
  httpUrl?: string;
  githubRepo: string;
  docsUrl: string;
  expectedEnvVars: string[];
  expectedArgs: string[];
  verified: boolean;
  lastVerified: string | null;
}

interface Registry {
  version: number;
  templates: RegistryEntry[];
}

const registryPath = resolve(__dirname, "../../scripts/mcp-templates-registry.json");
const registry: Registry = JSON.parse(readFileSync(registryPath, "utf-8"));

describe("MCP Templates ↔ Registry sync", () => {
  it("registry JSON is valid and has version field", () => {
    expect(registry.version).toBe(1);
    expect(Array.isArray(registry.templates)).toBe(true);
  });

  it("same number of templates in both sources", () => {
    expect(registry.templates.length).toBe(MCP_TEMPLATES.length);
  });

  it("every template has a registry entry", () => {
    const registryIds = new Set(registry.templates.map((r) => r.id));
    for (const t of MCP_TEMPLATES) {
      expect(registryIds.has(t.id), `Template "${t.id}" missing from registry`).toBe(true);
    }
  });

  it("every registry entry has a template", () => {
    const templateIds = new Set(MCP_TEMPLATES.map((t) => t.id));
    for (const r of registry.templates) {
      expect(templateIds.has(r.id), `Registry entry "${r.id}" has no matching template`).toBe(true);
    }
  });

  it("stdio registry entries have npmPackage or pypiPackage", () => {
    for (const r of registry.templates.filter((r) => r.serverType === "stdio")) {
      const hasPkg = Boolean(r.npmPackage) || Boolean(r.pypiPackage);
      expect(hasPkg, `stdio entry "${r.id}" missing both npmPackage and pypiPackage`).toBe(true);
    }
  });

  it("http registry entries have httpUrl", () => {
    for (const r of registry.templates.filter((r) => r.serverType === "http")) {
      expect(r.httpUrl, `http entry "${r.id}" missing httpUrl`).toBeDefined();
    }
  });

  it("stdio template args contain the registered package name", () => {
    for (const r of registry.templates.filter((r) => r.serverType === "stdio")) {
      const template = MCP_TEMPLATES.find((t) => t.id === r.id);
      expect(template, `Template not found for "${r.id}"`).toBeDefined();
      const argsStr = template!.args?.join(" ") ?? "";
      const pkg = r.npmPackage ?? r.pypiPackage!;
      expect(
        argsStr.includes(pkg),
        `Template "${r.id}" args don't contain "${pkg}". Args: [${template!.args?.join(", ")}]`,
      ).toBe(true);
    }
  });

  it("http template url matches registered httpUrl", () => {
    for (const r of registry.templates.filter((r) => r.serverType === "http")) {
      const template = MCP_TEMPLATES.find((t) => t.id === r.id);
      expect(template, `Template not found for "${r.id}"`).toBeDefined();
      expect(
        template!.url,
        `Template "${r.id}" url doesn't match registry`,
      ).toBe(r.httpUrl);
    }
  });

  it("registry expectedEnvVars match template env keys", () => {
    for (const r of registry.templates) {
      if (r.expectedEnvVars.length === 0) continue;
      const template = MCP_TEMPLATES.find((t) => t.id === r.id);
      expect(template, `Template not found for "${r.id}"`).toBeDefined();
      const envKeys = Object.keys(template!.env ?? {});
      for (const expectedVar of r.expectedEnvVars) {
        expect(
          envKeys.includes(expectedVar),
          `Template "${r.id}" env missing expected var "${expectedVar}". Has: [${envKeys.join(", ")}]`,
        ).toBe(true);
      }
    }
  });

  it("registry expectedArgs appear in template args", () => {
    for (const r of registry.templates) {
      if (r.expectedArgs.length === 0) continue;
      const template = MCP_TEMPLATES.find((t) => t.id === r.id);
      expect(template, `Template not found for "${r.id}"`).toBeDefined();
      const args = template!.args ?? [];
      for (const expectedArg of r.expectedArgs) {
        expect(
          args.includes(expectedArg),
          `Template "${r.id}" args missing expected arg "${expectedArg}". Has: [${args.join(", ")}]`,
        ).toBe(true);
      }
    }
  });

  it("every registry entry has at least one documentation URL", () => {
    for (const r of registry.templates) {
      const hasDoc = Boolean(r.githubRepo) || Boolean(r.docsUrl);
      expect(hasDoc, `Registry entry "${r.id}" has no documentation URL`).toBe(true);
    }
  });

  it("serverType matches between template and registry", () => {
    for (const r of registry.templates) {
      const template = MCP_TEMPLATES.find((t) => t.id === r.id);
      expect(template, `Template not found for "${r.id}"`).toBeDefined();
      expect(
        template!.serverType,
        `serverType mismatch for "${r.id}": template=${template!.serverType}, registry=${r.serverType}`,
      ).toBe(r.serverType);
    }
  });
});
