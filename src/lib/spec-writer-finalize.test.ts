import { describe, it, expect } from "vitest";
import {
  finalizeSpecForCapabilities,
  renderAdjustmentsMessage,
  type FinalizeAdjustment,
} from "./spec-writer-finalize";
import type {
  ProbedCapability,
  ProjectCapabilitiesRecord,
} from "../types/spec-writer";
import { inferVocab } from "./self-drive-evidence-vocab";

function cap(
  id: string,
  status: ProbedCapability["status"],
  evidence = `synthetic ${id}`,
): ProbedCapability {
  return {
    id,
    status,
    discoveredBy: "passive-probe",
    evidence,
    lastVerifiedAt: "2026-05-19T00:00:00Z",
    verifyMethod: null,
    expires: null,
  };
}

function record(capabilities: ProbedCapability[]): ProjectCapabilitiesRecord {
  return {
    schemaVersion: 1,
    probedAt: "2026-05-19T00:00:00Z",
    probedByCliVersion: null,
    probedBySpecWriterVersion: null,
    capabilities,
    stalenessWindow: "PT24H",
  };
}

const VOCAB_CLOUD = inferVocab({
  hasSupabaseCloudUrl: true,
  hasLocalSupabaseConfig: false,
  hasDatabaseUrl: false,
  hasMcpSupabase: false,
  supabaseCliLinked: true,
});

const VOCAB_LOCAL = inferVocab({
  hasSupabaseCloudUrl: false,
  hasLocalSupabaseConfig: true,
  hasDatabaseUrl: false,
  hasMcpSupabase: false,
  supabaseCliLinked: false,
});

describe("finalizeSpecForCapabilities", () => {
  it("passes through non-criterion lines unchanged", () => {
    const input = [
      "# Spec",
      "",
      "Some prose here.",
      "",
      "## Acceptance criteria",
      "",
    ].join("\n");
    const result = finalizeSpecForCapabilities(input, null, VOCAB_CLOUD);
    expect(result.content).toBe(input);
    expect(result.adjustments).toEqual([]);
  });

  describe("auto-tagging by inference", () => {
    it("infers db.supabase-anon for `supabase db push` lines", () => {
      const r = record([cap("db.supabase-anon", "verified")]);
      const input = "- [side-effect] `supabase db push` succeeds";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);
      expect(out.content).toContain("capability=db.supabase-anon");
      expect(out.adjustments[0].kind).toBe("inferred-tag");
      expect(out.adjustments[0].capabilityId).toBe("db.supabase-anon");
    });

    it("infers test-runner.any for `vitest passes` lines", () => {
      const r = record([cap("test-runner.any", "verified")]);
      const input = "- [behavioral] vitest passes for FooComponent";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);
      expect(out.content).toContain("[behavioral capability=test-runner.any]");
      expect(out.adjustments[0].kind).toBe("inferred-tag");
    });

    it("infers browser-mcp for `browser_navigate` lines", () => {
      const r = record([cap("browser-mcp", "verified")]);
      const input = "- [behavioral] browser_navigate to /login and browser_snapshot";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);
      expect(out.content).toContain("capability=browser-mcp");
    });

    it("infers db.supabase.local-stack for `psql -h localhost` lines", () => {
      const r = record([cap("db.supabase.local-stack", "verified")]);
      const input = "- [side-effect] psql -h localhost -p 54322 -c \"SELECT 1\" returns 1";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_LOCAL);
      expect(out.content).toContain("capability=db.supabase.local-stack");
    });

    it("leaves existing capability= tags untouched", () => {
      const r = record([cap("db.supabase-anon", "verified")]);
      const input =
        "- [side-effect capability=db.supabase-anon] `supabase db push` succeeds";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);
      expect(out.content).toBe(input);
      // No adjustment because nothing changed.
      expect(out.adjustments).toEqual([]);
    });
  });

  describe("substitution when capability is absent", () => {
    it("Atikon regression: `supabase db reset` on cloud-only project gets rewritten to `db push`", () => {
      const r = record([
        cap("db.supabase.local-stack", "absent", "no supabase/config.toml; cloud-only"),
        cap("db.supabase-anon", "verified"),
      ]);
      const input = "- [side-effect] supabase db reset clean";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);

      expect(out.content).not.toContain("db reset");
      expect(out.content).toMatch(/supabase db push/);
      // After substitution the cap should switch to the cloud-side one.
      expect(out.content).toContain("capability=db.supabase-anon");

      const adj = out.adjustments[0];
      expect(adj.kind).toBe("substituted");
      expect(adj.original).toContain("db reset");
    });

    it("rewrites `psql -h localhost` to project vocab on cloud project", () => {
      const r = record([
        cap("db.supabase.local-stack", "absent"),
        cap("db.supabase-anon", "verified"),
      ]);
      const input = "- [side-effect] psql -h localhost -p 54322 -U postgres -c \"SELECT 1\"";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);
      expect(out.content).toMatch(/supabase db query --linked/);
      expect(out.adjustments[0].kind).toBe("substituted");
    });

    it("rewrites `psql $DATABASE_URL` to project vocab", () => {
      const r = record([cap("db.supabase.local-stack", "absent")]);
      const input = "- [side-effect] psql $DATABASE_URL -c \"SELECT 1\"";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);
      expect(out.content).toMatch(/supabase db query --linked/);
      expect(out.adjustments[0].kind).toBe("substituted");
    });

    it("does not substitute when the capability is present", () => {
      const r = record([cap("db.supabase.local-stack", "verified")]);
      const input = "- [side-effect] supabase db reset clean";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_LOCAL);
      // Tag inferred, but no substitution because local-stack is verified here.
      expect(out.content).toContain("db reset");
      expect(out.content).toContain("capability=db.supabase.local-stack");
      expect(out.adjustments[0].kind).toBe("inferred-tag");
    });
  });

  describe("DEFERRED path", () => {
    it("marks an item DEFERRED when its capability is absent and no substitution rule applies", () => {
      // test-runner.any is absent — there's no command-level substitution
      // (the project has no test runner at all), so the line must be
      // preserved as DEFERRED rather than dropped.
      const r = record([cap("test-runner.any", "absent")]);
      const input = "- [behavioral] vitest passes for FooMigration";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);
      expect(out.content).toContain("DEFERRED");
      expect(out.content).toContain("test-runner.any");
      expect(out.adjustments[0].kind).toBe("deferred");
    });
  });

  describe("warning path", () => {
    it("surfaces a warning when no capability can be inferred", () => {
      const r = record([]);
      const input = "- [integration] something opaque and unique happens";
      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);
      // Line is preserved as-is.
      expect(out.content).toContain("something opaque and unique happens");
      expect(out.adjustments[0].kind).toBe("warned");
      expect(out.adjustments[0].capabilityId).toBe(null);
    });
  });

  describe("end-to-end Atikon scenario", () => {
    it("rewrites a multi-item checklist correctly", () => {
      const r = record([
        cap("db.supabase.local-stack", "absent", "cloud-only Supabase"),
        cap("db.supabase-anon", "verified"),
        cap("test-runner.any", "absent"),
        cap("browser-mcp", "absent"),
      ]);
      const input = [
        "## Verification",
        "",
        "- [side-effect] supabase db reset clean",
        "- [side-effect] supabase db push succeeds",
        "- [behavioral] vitest passes for migration",
        "- [integration] mcp__supabase__execute_sql returns expected rows",
      ].join("\n");

      const out = finalizeSpecForCapabilities(input, r, VOCAB_CLOUD);

      // db reset → cloud substitution
      expect(out.content).not.toContain("supabase db reset");
      // db push line: tag inferred, no substitution needed
      expect(out.content).toContain("[side-effect capability=db.supabase-anon] supabase db push succeeds");
      // vitest: DEFERRED
      expect(out.content).toContain("DEFERRED");
      // mcp__supabase tag inferred to db.supabase-anon
      expect(out.content).toMatch(/mcp__supabase__execute_sql.*capability=db\.supabase-anon|capability=db\.supabase-anon.*mcp__supabase__execute_sql/);

      const kinds = out.adjustments.map((a) => a.kind);
      expect(kinds).toContain("substituted");
      expect(kinds).toContain("inferred-tag");
      expect(kinds).toContain("deferred");
    });
  });
});

describe("renderAdjustmentsMessage", () => {
  it("returns null when there are no adjustments", () => {
    expect(renderAdjustmentsMessage([])).toBe(null);
  });

  it("groups adjustments by kind and lists each one", () => {
    const adjustments: FinalizeAdjustment[] = [
      {
        kind: "substituted",
        original: "[side-effect] supabase db reset clean",
        replacement: "[side-effect capability=db.supabase-anon] supabase db push…",
        capabilityId: "db.supabase-anon",
        reason: "local-stack absent → cloud vocab",
      },
      {
        kind: "deferred",
        original: "[behavioral] vitest passes",
        replacement: "[behavioral] DEFERRED: capability `test-runner.any` absent…",
        capabilityId: "test-runner.any",
        reason: "test runner absent",
      },
      {
        kind: "inferred-tag",
        original: "[side-effect] supabase db push succeeds",
        replacement: "[side-effect capability=db.supabase-anon] supabase db push succeeds",
        capabilityId: "db.supabase-anon",
        reason: "inferred from evidence text",
      },
    ];
    const msg = renderAdjustmentsMessage(adjustments);
    expect(msg).not.toBeNull();
    expect(msg).toContain("Substituted (1)");
    expect(msg).toContain("Deferred (1)");
    expect(msg).toContain("Auto-tagged (1)");
    expect(msg).toContain("db.supabase-anon");
  });
});
