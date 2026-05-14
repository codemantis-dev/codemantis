import { describe, it, expect } from "vitest";
import {
  extractCapabilityRef,
  findCapability,
  shouldAutoResolveToNA,
  parseIsoDurationMs,
  isCapabilityStale,
  staleCapabilityIds,
  findMissingCapabilityRefs,
} from "./capability-gating";
import type {
  ProbedCapability,
  ProjectCapabilitiesRecord,
} from "../types/spec-writer";

function cap(
  id: string,
  status: ProbedCapability["status"],
  lastVerifiedAt = "2026-05-14T10:00:00Z",
): ProbedCapability {
  return {
    id,
    status,
    discoveredBy: "passive-probe",
    evidence: `mock for ${id}`,
    lastVerifiedAt,
    verifyMethod: null,
    expires: null,
  };
}

function record(
  capabilities: ProbedCapability[],
  stalenessWindow = "PT24H",
): ProjectCapabilitiesRecord {
  return {
    schemaVersion: 1,
    probedAt: "2026-05-14T10:00:00Z",
    probedByCliVersion: null,
    probedBySpecWriterVersion: null,
    capabilities,
    stalenessWindow,
  };
}

describe("extractCapabilityRef", () => {
  it("parses capability= inside [kind capability=...]", () => {
    expect(extractCapabilityRef("[behavioral capability=browser-mcp] Klick ort")).toBe(
      "browser-mcp",
    );
  });

  it("parses dotted namespace ids", () => {
    expect(extractCapabilityRef("[integration capability=db.supabase-service-role] DB write")).toBe(
      "db.supabase-service-role",
    );
  });

  it("parses loose `capability=` without brackets", () => {
    expect(extractCapabilityRef("Run test capability=test-runner.vitest after build")).toBe(
      "test-runner.vitest",
    );
  });

  it("returns null when no capability tag is present", () => {
    expect(extractCapabilityRef("[behavioral] does the thing")).toBeNull();
    expect(extractCapabilityRef("plain label")).toBeNull();
  });

  it("returns the first match when multiple are present", () => {
    expect(extractCapabilityRef("capability=a then capability=b")).toBe("a");
  });
});

describe("findCapability", () => {
  it("returns undefined for null record", () => {
    expect(findCapability(null, "browser-mcp")).toBeUndefined();
  });

  it("returns the matching capability", () => {
    const r = record([cap("browser-mcp", "verified")]);
    expect(findCapability(r, "browser-mcp")?.status).toBe("verified");
  });

  it("returns undefined when id is not present", () => {
    const r = record([cap("browser-mcp", "verified")]);
    expect(findCapability(r, "llm-key.openai")).toBeUndefined();
  });
});

describe("shouldAutoResolveToNA", () => {
  const absentRec = record([cap("browser-mcp", "absent")]);
  const verifiedRec = record([cap("browser-mcp", "verified")]);
  const unverifiedRec = record([cap("browser-mcp", "claimed-unverified")]);

  it("returns autoNA=true when the referenced capability is absent", () => {
    const r = shouldAutoResolveToNA(
      "[behavioral capability=browser-mcp] Klick ort",
      absentRec,
    );
    expect(r.autoNA).toBe(true);
    expect(r.capabilityId).toBe("browser-mcp");
    expect(r.reason).toContain("browser-mcp");
    expect(r.reason).toContain("absent");
  });

  it("returns autoNA=false when the capability is verified", () => {
    const r = shouldAutoResolveToNA(
      "[behavioral capability=browser-mcp] Klick ort",
      verifiedRec,
    );
    expect(r.autoNA).toBe(false);
    expect(r.capabilityId).toBe("browser-mcp");
  });

  it("returns autoNA=false when the capability is claimed-unverified (still demand evidence)", () => {
    const r = shouldAutoResolveToNA(
      "[behavioral capability=browser-mcp] Klick ort",
      unverifiedRec,
    );
    expect(r.autoNA).toBe(false);
  });

  it("returns autoNA=false when the label has no capability tag", () => {
    const r = shouldAutoResolveToNA("[behavioral] Klick ort", absentRec);
    expect(r.autoNA).toBe(false);
    expect(r.capabilityId).toBeNull();
  });

  it("returns autoNA=false when the capability isn't in the record", () => {
    // The orchestrator is responsible for triggering a targeted re-probe in
    // this case (findMissingCapabilityRefs picks it up). We do NOT auto-N/A
    // because the answer is unknown yet.
    const r = shouldAutoResolveToNA(
      "[behavioral capability=unknown.thing] foo",
      absentRec,
    );
    expect(r.autoNA).toBe(false);
    expect(r.capabilityId).toBe("unknown.thing");
  });
});

describe("parseIsoDurationMs", () => {
  it("parses PT24H to 24 hours of ms", () => {
    expect(parseIsoDurationMs("PT24H")).toBe(24 * 60 * 60 * 1000);
  });

  it("parses PT1H30M", () => {
    expect(parseIsoDurationMs("PT1H30M")).toBe((60 + 30) * 60 * 1000);
  });

  it("parses P7D", () => {
    expect(parseIsoDurationMs("P7D")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("parses PT60S", () => {
    expect(parseIsoDurationMs("PT60S")).toBe(60 * 1000);
  });

  it("returns null for malformed input", () => {
    expect(parseIsoDurationMs("24h")).toBeNull();
    expect(parseIsoDurationMs("garbage")).toBeNull();
    expect(parseIsoDurationMs("")).toBeNull();
    expect(parseIsoDurationMs("P")).toBeNull();
  });
});

describe("isCapabilityStale", () => {
  const now = new Date("2026-05-15T11:00:00Z");

  it("returns true for verified capability older than the window", () => {
    // Verified 25h ago, window 24h.
    const c = cap("browser-mcp", "verified", "2026-05-14T10:00:00Z");
    expect(isCapabilityStale(c, "PT24H", now)).toBe(true);
  });

  it("returns false for verified capability within the window", () => {
    const c = cap("browser-mcp", "verified", "2026-05-15T05:00:00Z");
    expect(isCapabilityStale(c, "PT24H", now)).toBe(false);
  });

  it("returns false for absent capability (re-firing is pointless)", () => {
    const c = cap("browser-mcp", "absent", "2020-01-01T00:00:00Z");
    expect(isCapabilityStale(c, "PT24H", now)).toBe(false);
  });

  it("returns false for pending-install capability", () => {
    const c = cap("test-runner.vitest", "pending-install", "2020-01-01T00:00:00Z");
    expect(isCapabilityStale(c, "PT24H", now)).toBe(false);
  });

  it("treats malformed window as 24h fallback", () => {
    const c = cap("browser-mcp", "verified", "2026-05-14T10:00:00Z");
    expect(isCapabilityStale(c, "garbage", now)).toBe(true);
  });
});

describe("staleCapabilityIds", () => {
  const now = new Date("2026-05-15T11:00:00Z");

  it("returns only verified/claimed-unverified items older than the window", () => {
    const r = record(
      [
        cap("browser-mcp", "verified", "2026-05-14T10:00:00Z"),     // stale
        cap("llm-key.openai", "claimed-unverified", "2026-05-14T10:00:00Z"), // stale
        cap("test-runner.vitest", "absent", "2020-01-01T00:00:00Z"),         // not stale (absent)
        cap("db.supabase-anon", "verified", "2026-05-15T05:00:00Z"), // not stale (fresh)
      ],
      "PT24H",
    );
    expect(staleCapabilityIds(r, now)).toEqual(["browser-mcp", "llm-key.openai"]);
  });

  it("returns empty for null record", () => {
    expect(staleCapabilityIds(null, now)).toEqual([]);
  });
});

describe("findMissingCapabilityRefs", () => {
  it("returns capability ids referenced in labels but absent from the record", () => {
    const r = record([cap("browser-mcp", "verified")]);
    const missing = findMissingCapabilityRefs(
      [
        "[behavioral capability=browser-mcp] foo",
        "[behavioral capability=llm-key.openai] bar",
        "[integration capability=db.supabase-anon] baz",
      ],
      r,
    );
    expect(new Set(missing)).toEqual(new Set(["llm-key.openai", "db.supabase-anon"]));
  });

  it("ignores labels without a capability tag", () => {
    const r = record([cap("browser-mcp", "verified")]);
    expect(findMissingCapabilityRefs(["[behavioral] plain", "no tag here"], r)).toEqual([]);
  });

  it("returns empty when every reference is already in the record", () => {
    const r = record([cap("browser-mcp", "verified"), cap("llm-key.openai", "absent")]);
    expect(
      findMissingCapabilityRefs(
        ["[behavioral capability=browser-mcp]", "[behavioral capability=llm-key.openai]"],
        r,
      ),
    ).toEqual([]);
  });

  it("dedupes references that appear in multiple labels", () => {
    const r = record([]);
    expect(
      findMissingCapabilityRefs(
        ["capability=a", "capability=a then capability=b", "capability=b"],
        r,
      ).sort(),
    ).toEqual(["a", "b"]);
  });

  it("handles null record (everything is missing)", () => {
    expect(
      findMissingCapabilityRefs(["[behavioral capability=browser-mcp] x"], null),
    ).toEqual(["browser-mcp"]);
  });
});
