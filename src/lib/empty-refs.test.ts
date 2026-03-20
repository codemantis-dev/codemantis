import { describe, it, expect } from "vitest";
import { EMPTY_ARRAY, EMPTY_STREAMING, EMPTY_CONTEXT } from "./empty-refs";

describe("EMPTY_ARRAY", () => {
  it("is an array", () => {
    expect(Array.isArray(EMPTY_ARRAY)).toBe(true);
  });

  it("is empty", () => {
    expect(EMPTY_ARRAY).toHaveLength(0);
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(EMPTY_ARRAY)).toBe(true);
  });

  it("is a stable reference (same object on repeated access)", () => {
    const ref1 = EMPTY_ARRAY;
    const ref2 = EMPTY_ARRAY;
    expect(ref1).toBe(ref2);
  });

  it("throws when attempting mutation in strict mode", () => {
    expect(() => {
      "use strict";
      (EMPTY_ARRAY as unknown[]).push(1);
    }).toThrow();
  });
});

describe("EMPTY_STREAMING", () => {
  it("has isStreaming = false", () => {
    expect(EMPTY_STREAMING.isStreaming).toBe(false);
  });

  it("has streamingContent as empty string", () => {
    expect(EMPTY_STREAMING.streamingContent).toBe("");
  });

  it("has currentMessageId as null", () => {
    expect(EMPTY_STREAMING.currentMessageId).toBeNull();
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(EMPTY_STREAMING)).toBe(true);
  });

  it("is a stable reference (same object on repeated access)", () => {
    const ref1 = EMPTY_STREAMING;
    const ref2 = EMPTY_STREAMING;
    expect(ref1).toBe(ref2);
  });

  it("has exactly the expected keys", () => {
    expect(Object.keys(EMPTY_STREAMING).sort()).toEqual(
      ["currentMessageId", "isStreaming", "streamingContent"].sort()
    );
  });

  it("throws when attempting mutation in strict mode", () => {
    expect(() => {
      "use strict";
      (EMPTY_STREAMING as Record<string, unknown>).isStreaming = true;
    }).toThrow();
  });
});

describe("EMPTY_CONTEXT", () => {
  it("has used = 0", () => {
    expect(EMPTY_CONTEXT.used).toBe(0);
  });

  it("has max = 200000", () => {
    expect(EMPTY_CONTEXT.max).toBe(200000);
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(EMPTY_CONTEXT)).toBe(true);
  });

  it("is a stable reference (same object on repeated access)", () => {
    const ref1 = EMPTY_CONTEXT;
    const ref2 = EMPTY_CONTEXT;
    expect(ref1).toBe(ref2);
  });

  it("has exactly the expected keys", () => {
    expect(Object.keys(EMPTY_CONTEXT).sort()).toEqual(["max", "used"].sort());
  });

  it("throws when attempting mutation in strict mode", () => {
    expect(() => {
      "use strict";
      (EMPTY_CONTEXT as Record<string, unknown>).used = 999;
    }).toThrow();
  });
});
