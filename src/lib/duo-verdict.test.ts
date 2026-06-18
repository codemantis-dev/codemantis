import { describe, it, expect } from "vitest";
import {
  parseDuoVerdict,
  isBlockingVerdict,
  needsClarificationVerdict,
} from "./duo-verdict";

function block(json: string): string {
  return "I reviewed the diff.\n\n```duo-verdict\n" + json + "\n```\n";
}

describe("parseDuoVerdict", () => {
  it("parses a well-formed agree verdict", () => {
    const res = parseDuoVerdict(
      block(
        JSON.stringify({
          stance: "agree",
          severity: "nit",
          summary: "Looks correct",
          rationale: "Tests pass, logic sound",
          confidence: 0.9,
          ranBuild: true,
          ranTests: true,
          citedFiles: ["src/a.ts"],
        }),
      ),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.verdict.stance).toBe("agree");
      expect(res.verdict.ranTests).toBe(true);
      expect(res.verdict.citedFiles).toEqual(["src/a.ts"]);
    }
  });

  it("parses a blocking concern with a repair task", () => {
    const res = parseDuoVerdict(
      block(
        JSON.stringify({
          stance: "concern",
          severity: "blocking",
          summary: "Missing error handling",
          rationale: "The fetch can reject",
          repairTask: "Wrap the fetch in try/catch and surface a toast",
          confidence: 0.7,
          ranBuild: true,
          ranTests: false,
        }),
      ),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.verdict.repairTask).toContain("try/catch");
      expect(isBlockingVerdict(res.verdict)).toBe(true);
    }
  });

  it("uses the LAST fenced block when several are present", () => {
    const raw =
      block(JSON.stringify({ stance: "agree", severity: "nit", summary: "first" })) +
      block(JSON.stringify({ stance: "disagree", severity: "blocking", summary: "final" }));
    const res = parseDuoVerdict(raw);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.verdict.summary).toBe("final");
  });

  it("clamps confidence into [0,1]", () => {
    const res = parseDuoVerdict(
      block(JSON.stringify({ stance: "agree", severity: "nit", summary: "ok", confidence: 5 })),
    );
    expect(res.ok && res.verdict.confidence).toBe(1);
  });

  it("defaults missing booleans/arrays to safe values", () => {
    const res = parseDuoVerdict(
      block(JSON.stringify({ stance: "agree", severity: "nit", summary: "ok" })),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.verdict.ranBuild).toBe(false);
      expect(res.verdict.citedFiles).toEqual([]);
      expect(res.verdict.repairTask).toBeUndefined();
    }
  });

  it("reports no-block when the fence is absent", () => {
    const res = parseDuoVerdict("Just some prose, no verdict block.");
    expect(res).toMatchObject({ ok: false, reason: "no-block" });
  });

  it("reports invalid-json for a malformed block", () => {
    const res = parseDuoVerdict("```duo-verdict\n{ not json }\n```");
    expect(res).toMatchObject({ ok: false, reason: "invalid-json" });
  });

  it("reports schema-mismatch for an unknown stance", () => {
    const res = parseDuoVerdict(
      block(JSON.stringify({ stance: "maybe", severity: "nit", summary: "x" })),
    );
    expect(res).toMatchObject({ ok: false, reason: "schema-mismatch" });
  });

  it("reports schema-mismatch when summary is empty", () => {
    const res = parseDuoVerdict(
      block(JSON.stringify({ stance: "agree", severity: "nit", summary: "  " })),
    );
    expect(res).toMatchObject({ ok: false, reason: "schema-mismatch" });
  });
});

describe("isBlockingVerdict", () => {
  it("is false for agree regardless of severity", () => {
    expect(
      isBlockingVerdict({
        stance: "agree", severity: "blocking", summary: "", rationale: "",
        confidence: 1, ranBuild: true, ranTests: true, citedFiles: [],
      }),
    ).toBe(false);
  });

  it("is false for an advisory concern", () => {
    expect(
      isBlockingVerdict({
        stance: "concern", severity: "advisory", summary: "", rationale: "",
        confidence: 1, ranBuild: true, ranTests: true, citedFiles: [],
      }),
    ).toBe(false);
  });
});

describe("needsClarificationVerdict", () => {
  it("produces an advisory concern carrying a truncated raw snippet", () => {
    const v = needsClarificationVerdict("x".repeat(1000));
    expect(v.stance).toBe("concern");
    expect(v.severity).toBe("advisory");
    expect(v.rationale.length).toBe(500);
  });
});
