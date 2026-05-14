import { describe, it, expect } from "vitest";
import {
  buildHandshakeQuestion,
  buildHandshakeQuestions,
  MAX_HANDSHAKE_QUESTIONS,
} from "./capability-handshake-prompt";
import type {
  ProbedCapability,
  ProjectCapabilitiesRecord,
} from "../types/spec-writer";

function cap(
  id: string,
  status: ProbedCapability["status"] = "claimed-unverified",
): ProbedCapability {
  return {
    id,
    status,
    discoveredBy: "passive-probe",
    evidence: `mock evidence for ${id}`,
    lastVerifiedAt: "2026-05-14T10:00:00Z",
    verifyMethod: "mock-verify",
    expires: null,
  };
}

function record(...capabilities: ProbedCapability[]): ProjectCapabilitiesRecord {
  return {
    schemaVersion: 1,
    probedAt: "2026-05-14T10:00:00Z",
    probedByCliVersion: null,
    probedBySpecWriterVersion: null,
    capabilities,
    stalenessWindow: "PT24H",
  };
}

describe("buildHandshakeQuestion", () => {
  it("returns null for verified capabilities", () => {
    expect(buildHandshakeQuestion(cap("browser-mcp", "verified"))).toBeNull();
  });

  it("returns null for absent capabilities", () => {
    expect(buildHandshakeQuestion(cap("browser-mcp", "absent"))).toBeNull();
  });

  it("returns null for pending-install capabilities", () => {
    expect(buildHandshakeQuestion(cap("test-runner.vitest", "pending-install"))).toBeNull();
  });

  it("BrowserMCP question offers verify and absent options", () => {
    const q = buildHandshakeQuestion(cap("browser-mcp"))!;
    expect(q.capabilityId).toBe("browser-mcp");
    expect(q.options.map((o) => o.action)).toEqual(["verify", "absent"]);
    expect(q.question).toMatch(/BrowserMCP/);
  });

  it("Supabase service-role offers three options (verify, skip, absent)", () => {
    const q = buildHandshakeQuestion(cap("db.supabase-service-role"))!;
    const actions = q.options.map((o) => o.action);
    expect(actions).toContain("verify");
    expect(actions).toContain("skip");
    expect(actions).toContain("absent");
  });

  it("LLM keys default to verify-or-absent (binary)", () => {
    for (const id of ["llm-key.anthropic", "llm-key.openai", "llm-key.gemini"]) {
      const q = buildHandshakeQuestion(cap(id))!;
      expect(q.options.map((o) => o.action).sort()).toEqual(["absent", "verify"]);
    }
  });

  it("falls back to generic question for unknown ids", () => {
    const q = buildHandshakeQuestion(cap("custom.weird-thing"))!;
    expect(q.capabilityId).toBe("custom.weird-thing");
    expect(q.options.map((o) => o.action).sort()).toEqual(["skip", "verify"]);
    expect(q.question).toMatch(/custom\.weird-thing/);
  });

  it("header is at most 12 chars (AskUserQuestion contract)", () => {
    const q = buildHandshakeQuestion(cap("a-very-long-capability-id"))!;
    expect(q.header.length).toBeLessThanOrEqual(12);
  });
});

describe("buildHandshakeQuestions", () => {
  it("returns empty array when nothing is claimed-unverified", () => {
    const r = record(cap("browser-mcp", "verified"), cap("test-runner.any", "absent"));
    expect(buildHandshakeQuestions(r)).toEqual([]);
  });

  it("skips verified and absent items, returns only claimed-unverified questions", () => {
    const r = record(
      cap("browser-mcp", "claimed-unverified"),
      cap("test-runner.vitest", "verified"),
      cap("typecheck.tsc-projectref", "verified"),
      cap("llm-key.openai", "claimed-unverified"),
    );
    const qs = buildHandshakeQuestions(r);
    expect(qs.map((q) => q.capabilityId)).toEqual(["browser-mcp", "llm-key.openai"]);
  });

  it("prioritises BrowserMCP first when budget is exceeded", () => {
    const r = record(
      cap("llm-key.gemini"),
      cap("llm-key.openai"),
      cap("llm-key.anthropic"),
      cap("db.supabase-anon"),
      cap("db.supabase-service-role"),
      cap("browser-mcp"),
    );
    const qs = buildHandshakeQuestions(r);
    expect(qs).toHaveLength(MAX_HANDSHAKE_QUESTIONS);
    expect(qs[0].capabilityId).toBe("browser-mcp");
    // db.supabase-service-role (rank 1) ranks above db.supabase-anon (rank 2)
    expect(qs[1].capabilityId).toBe("db.supabase-service-role");
    expect(qs[2].capabilityId).toBe("db.supabase-anon");
  });

  it("caps at MAX_HANDSHAKE_QUESTIONS", () => {
    const many = Array.from({ length: 10 }, (_, i) => cap(`unknown.cap-${i}`));
    const qs = buildHandshakeQuestions(record(...many));
    expect(qs).toHaveLength(MAX_HANDSHAKE_QUESTIONS);
  });
});
