import { describe, it, expect } from "vitest";
import {
  buildParityRecoveryPrompt,
  parseDeferredParityRows,
} from "./parity-recovery-prompt";

describe("buildParityRecoveryPrompt", () => {
  it("names every failing row with action, wire, scanned paths, and detail", () => {
    const prompt = buildParityRecoveryPrompt({
      failed: [
        {
          action: "resolve_checkpoint",
          callerPresent: false,
          handlerPresent: true,
          handlerStubFree: true,
          status: "FAIL",
          detail: "no caller path in [src/hooks, src/lib] references wire 'hitl-respond'",
        },
      ],
      callerPaths: ["src/hooks", "src/lib"],
      actions: [
        {
          action: "resolve_checkpoint",
          handler: "functions/hitl-respond/index.ts",
          wire: "hitl-respond",
        },
      ],
    });

    // Row body
    expect(prompt).toContain("action: resolve_checkpoint");
    expect(prompt).toContain("(wire: hitl-respond)");
    expect(prompt).toContain("scanned: src/hooks, src/lib");
    expect(prompt).toContain('searched for literal: "hitl-respond"');
    expect(prompt).toContain("detail: no caller path");

    // Recovery contract — the three legitimate moves Claude Code can make
    expect(prompt).toContain("fix the call site");
    expect(prompt).toMatch(/Cross-system actions introduced/);
    expect(prompt).toContain("DEFERRED:");
    expect(prompt).toMatch(/Do NOT change the spec just to silence the gate/);
  });

  it("falls back to action as the search needle when wire is not set", () => {
    const prompt = buildParityRecoveryPrompt({
      failed: [
        {
          action: "emit_audit_log",
          callerPresent: false,
          handlerPresent: true,
          handlerStubFree: true,
          status: "FAIL",
          detail: "no caller path references action 'emit_audit_log'",
        },
      ],
      callerPaths: ["src/audit"],
      actions: [
        { action: "emit_audit_log", handler: "services/audit/sink.ts" },
      ],
    });

    // Wire label reuses the action; needle is the action.
    expect(prompt).toContain("(wire: emit_audit_log)");
    expect(prompt).toContain('searched for literal: "emit_audit_log"');
  });

  it("emits one row per failure when multiple rows fail in the same session", () => {
    const prompt = buildParityRecoveryPrompt({
      failed: [
        {
          action: "a",
          callerPresent: false,
          handlerPresent: true,
          handlerStubFree: true,
          status: "FAIL",
          detail: "a-detail",
        },
        {
          action: "b",
          callerPresent: false,
          handlerPresent: true,
          handlerStubFree: true,
          status: "FAIL",
          detail: "b-detail",
        },
      ],
      callerPaths: ["src"],
      actions: [
        { action: "a", handler: "h1" },
        { action: "b", handler: "h2", wire: "B" },
      ],
    });

    expect(prompt).toContain("action: a");
    expect(prompt).toContain("action: b");
    expect(prompt).toContain("(wire: a)"); // fallback to action
    expect(prompt).toContain("(wire: B)"); // explicit wire
  });
});

describe("parseDeferredParityRows", () => {
  it("returns an empty set for empty / no-DEFERRED responses", () => {
    expect(parseDeferredParityRows("").size).toBe(0);
    expect(parseDeferredParityRows("nothing here").size).toBe(0);
    expect(parseDeferredParityRows("I fixed the call site.").size).toBe(0);
  });

  it("extracts action names from DEFERRED lines using em-dash, hyphen, and bare forms", () => {
    const set = parseDeferredParityRows(
      [
        "Some text first.",
        "DEFERRED: resolve_checkpoint — wire is built at runtime",
        "DEFERRED: insert_note - handler-only session",
        "DEFERRED: emit_audit_log",
        "More text.",
      ].join("\n"),
    );

    expect(set.size).toBe(3);
    expect(set.has("resolve_checkpoint")).toBe(true);
    expect(set.has("insert_note")).toBe(true);
    expect(set.has("emit_audit_log")).toBe(true);
  });

  it("is case-insensitive on the DEFERRED keyword and strips wrapping backticks/quotes", () => {
    const set = parseDeferredParityRows(
      [
        "deferred: `wrapped_in_backticks` — reason",
        'Deferred:   "double_quoted"  — reason',
        "DEFERRED:'single_quoted' — reason",
      ].join("\n"),
    );

    expect(set.has("wrapped_in_backticks")).toBe(true);
    expect(set.has("double_quoted")).toBe(true);
    expect(set.has("single_quoted")).toBe(true);
  });

  it("ignores 'DEFERRED' text that isn't at the start of a line", () => {
    const set = parseDeferredParityRows(
      "I would have DEFERRED: foo but I fixed it.\nDEFERRED: bar — real",
    );
    expect(set.has("foo")).toBe(false);
    expect(set.has("bar")).toBe(true);
  });
});
