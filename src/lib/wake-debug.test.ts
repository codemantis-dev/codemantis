import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { appendDiagnosticLog, formatBreadcrumb, logBreadcrumb } from "./wake-debug";

describe("formatBreadcrumb", () => {
  it("joins event and fields with ' | '", () => {
    expect(formatBreadcrumb("wake", { ms: 250, project: "x" })).toBe(
      "wake | ms=250 | project=x",
    );
  });

  it("emits 'null' for explicit null and skips undefined", () => {
    expect(formatBreadcrumb("e", { a: null, b: undefined, c: false })).toBe(
      "e | a=null | c=false",
    );
  });

  it("strips field delimiters and newlines from values", () => {
    expect(formatBreadcrumb("e", { v: "a|b\nc\rd" })).toBe("e | v=a_b_c_d");
  });
});

describe("appendDiagnosticLog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the append_diagnostic_log command with category and line", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await appendDiagnosticLog("wake", "hello");
    expect(invokeMock).toHaveBeenCalledWith("append_diagnostic_log", {
      category: "wake",
      line: "hello",
    });
  });

  it("swallows backend failures so callers never see an error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(appendDiagnosticLog("wake", "x")).resolves.toBeUndefined();
  });
});

describe("logBreadcrumb", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("fires invoke with a formatted line and returns synchronously", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    logBreadcrumb("wake", "pong-recv", { delta_ms: 12 });
    // Synchronous call schedules the invoke; flush microtasks.
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("append_diagnostic_log", {
      category: "wake",
      line: "pong-recv | delta_ms=12",
    });
  });
});
