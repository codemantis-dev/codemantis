import { describe, it, expect } from "vitest";
import {
  buildRecoveryVerifyPrompt,
  recoveryBodyForKind,
  RECOVERY_MODE_PREAMBLE,
} from "./recovery-prompt";
import type { Blocker, BlockerKind } from "../types/implementation-guide";

function makeBlocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    id: "blk-1",
    sessionIndex: 1,
    detectedAt: 0,
    kind: "infra-state-drift",
    summary: "Supabase local/remote migration history mismatch (14 versions)",
    detail: "supabase db push failed because the remote has versions the local repo does not.",
    optionsOffered: [
      "Run supabase migration repair to realign history",
      "Rename the 14 local migration timestamps to match remote",
      "User resolves manually, then Resume",
    ],
    resolutionCriteria:
      "supabase db push succeeds AND supabase_migrations.schema_migrations contains 20260418120000",
    status: "user-decided",
    userResolution: "Ran supabase migration repair --status reverted <old> --status applied <new>",
    ...overrides,
  };
}

describe("RECOVERY_MODE_PREAMBLE", () => {
  it("forbids advancing and requires quoted output", () => {
    expect(RECOVERY_MODE_PREAMBLE).toContain("Do NOT try to advance");
    expect(RECOVERY_MODE_PREAMBLE).toContain("QUOTE their output verbatim");
    expect(RECOVERY_MODE_PREAMBLE).toContain("RECOVERY STATUS: RESOLVED | NOT-RESOLVED | NEEDS-USER");
  });

  it("bans the same skim phrases as the verify preamble", () => {
    expect(RECOVERY_MODE_PREAMBLE).toContain("LGTM");
    expect(RECOVERY_MODE_PREAMBLE).toContain('"should be fine now"');
  });
});

describe("recoveryBodyForKind", () => {
  const allKinds: BlockerKind[] = [
    "infra-state-drift",
    "permissions",
    "missing-deps",
    "credentials",
    "env-config",
    "user-decision",
    "external-failure",
    "unknown",
  ];

  it.each(allKinds)("returns a non-empty body for %s", (kind) => {
    const body = recoveryBodyForKind(kind);
    expect(body.length).toBeGreaterThan(50);
  });

  it("infra-state-drift names supabase-specific commands", () => {
    const body = recoveryBodyForKind("infra-state-drift");
    expect(body).toContain("supabase migration list");
    expect(body).toContain("supabase db push --dry-run");
    // File citations alone are disallowed for infra state
    expect(body).toMatch(/not rely on the migration FILE/i);
  });

  it("credentials warns against printing the secret", () => {
    const body = recoveryBodyForKind("credentials");
    expect(body).toContain("NEVER print the key/token");
  });

  it("external-failure requires a minimal live request", () => {
    const body = recoveryBodyForKind("external-failure");
    expect(body).toMatch(/curl|ping|health check/i);
  });
});

describe("buildRecoveryVerifyPrompt", () => {
  it("includes the preamble, blocker summary, resolution criteria, and user resolution", () => {
    const blocker = makeBlocker();
    const result = buildRecoveryVerifyPrompt(blocker, blocker.userResolution ?? "");

    expect(result).toContain("RECOVERY VERIFICATION — READ BEFORE DOING ANYTHING");
    expect(result).toContain(blocker.kind);
    expect(result).toContain(blocker.summary);
    expect(result).toContain(blocker.resolutionCriteria);
    expect(result).toContain(blocker.userResolution!);
  });

  it("branches on blocker kind — migration prompt differs from credentials prompt", () => {
    const infra = buildRecoveryVerifyPrompt(makeBlocker({ kind: "infra-state-drift" }), "repair ran");
    const creds = buildRecoveryVerifyPrompt(makeBlocker({ kind: "credentials" }), "fresh key exported");

    expect(infra).toContain("supabase migration list");
    expect(infra).not.toContain("NEVER print the key/token");
    expect(creds).toContain("NEVER print the key/token");
    expect(creds).not.toContain("supabase migration list");
  });

  it("handles empty userResolution gracefully without crashing or omitting the section", () => {
    const result = buildRecoveryVerifyPrompt(makeBlocker({ userResolution: undefined }), "");
    expect(result).toContain("USER STATES THEY DID:");
    expect(result).toContain("user did not specify");
  });

  it("ends with the status-line requirement", () => {
    const result = buildRecoveryVerifyPrompt(makeBlocker(), "ok");
    expect(result.trim().endsWith("End your response with the final status line described in the preamble.")).toBe(true);
  });
});
