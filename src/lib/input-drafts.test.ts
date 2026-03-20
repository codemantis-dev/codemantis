import { describe, it, expect, beforeEach } from "vitest";
import { inputDrafts, assistantInputDrafts } from "./input-drafts";

describe("inputDrafts", () => {
  beforeEach(() => {
    inputDrafts.clear();
  });

  it("is initially empty", () => {
    expect(inputDrafts.size).toBe(0);
  });

  it("stores and retrieves a draft by session id", () => {
    inputDrafts.set("session-1", "hello world");
    expect(inputDrafts.get("session-1")).toBe("hello world");
  });

  it("returns undefined for a non-existent key", () => {
    expect(inputDrafts.get("no-such-session")).toBeUndefined();
  });

  it("overwrites an existing draft", () => {
    inputDrafts.set("session-1", "first draft");
    inputDrafts.set("session-1", "updated draft");
    expect(inputDrafts.get("session-1")).toBe("updated draft");
  });

  it("deletes a draft", () => {
    inputDrafts.set("session-1", "some text");
    inputDrafts.delete("session-1");
    expect(inputDrafts.has("session-1")).toBe(false);
    expect(inputDrafts.get("session-1")).toBeUndefined();
  });

  it("supports multiple concurrent drafts for different session ids", () => {
    inputDrafts.set("session-a", "draft a");
    inputDrafts.set("session-b", "draft b");
    inputDrafts.set("session-c", "draft c");

    expect(inputDrafts.get("session-a")).toBe("draft a");
    expect(inputDrafts.get("session-b")).toBe("draft b");
    expect(inputDrafts.get("session-c")).toBe("draft c");
    expect(inputDrafts.size).toBe(3);
  });

  it("clears all drafts", () => {
    inputDrafts.set("session-1", "text 1");
    inputDrafts.set("session-2", "text 2");
    inputDrafts.clear();
    expect(inputDrafts.size).toBe(0);
  });

  it("stores empty string draft", () => {
    inputDrafts.set("session-1", "some text");
    inputDrafts.set("session-1", "");
    expect(inputDrafts.get("session-1")).toBe("");
    expect(inputDrafts.has("session-1")).toBe(true);
  });

  it("is a Map instance", () => {
    expect(inputDrafts).toBeInstanceOf(Map);
  });
});

describe("assistantInputDrafts", () => {
  beforeEach(() => {
    assistantInputDrafts.clear();
  });

  it("is initially empty", () => {
    expect(assistantInputDrafts.size).toBe(0);
  });

  it("stores and retrieves a draft by assistant id", () => {
    assistantInputDrafts.set("assistant-1", "assistant draft");
    expect(assistantInputDrafts.get("assistant-1")).toBe("assistant draft");
  });

  it("returns undefined for a non-existent key", () => {
    expect(assistantInputDrafts.get("no-such-assistant")).toBeUndefined();
  });

  it("overwrites an existing draft", () => {
    assistantInputDrafts.set("assistant-1", "first");
    assistantInputDrafts.set("assistant-1", "second");
    expect(assistantInputDrafts.get("assistant-1")).toBe("second");
  });

  it("deletes a draft", () => {
    assistantInputDrafts.set("assistant-1", "text");
    assistantInputDrafts.delete("assistant-1");
    expect(assistantInputDrafts.has("assistant-1")).toBe(false);
  });

  it("supports multiple concurrent drafts for different assistant ids", () => {
    assistantInputDrafts.set("assistant-x", "draft x");
    assistantInputDrafts.set("assistant-y", "draft y");

    expect(assistantInputDrafts.get("assistant-x")).toBe("draft x");
    expect(assistantInputDrafts.get("assistant-y")).toBe("draft y");
    expect(assistantInputDrafts.size).toBe(2);
  });

  it("is independent from inputDrafts", () => {
    inputDrafts.set("shared-key", "from inputDrafts");
    assistantInputDrafts.set("shared-key", "from assistantInputDrafts");

    expect(inputDrafts.get("shared-key")).toBe("from inputDrafts");
    expect(assistantInputDrafts.get("shared-key")).toBe("from assistantInputDrafts");
  });

  it("is a Map instance", () => {
    expect(assistantInputDrafts).toBeInstanceOf(Map);
  });
});
