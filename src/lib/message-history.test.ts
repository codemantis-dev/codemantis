import { describe, it, expect } from "vitest";
import { stripAttachmentRefs, getUserMessageHistory } from "./message-history";
import type { Message } from "../types/session";

function makeMessage(role: "user" | "assistant", content: string, id?: string): Message {
  return {
    id: id ?? `msg-${Math.random()}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    activityIds: [],
    isStreaming: false,
  };
}

describe("stripAttachmentRefs", () => {
  it("returns plain text unchanged", () => {
    expect(stripAttachmentRefs("hello world")).toBe("hello world");
  });

  it("strips a single attachment prefix", () => {
    expect(
      stripAttachmentRefs("[Attached file: /path/to/file.png]\n\nhello world")
    ).toBe("hello world");
  });

  it("strips multiple attachment prefixes", () => {
    expect(
      stripAttachmentRefs(
        "[Attached file: /a.png]\n[Attached file: /b.pdf]\n\nsome text"
      )
    ).toBe("some text");
  });

  it("returns empty string for attachment-only content", () => {
    expect(stripAttachmentRefs("[Attached file: /a.png]\n")).toBe("");
  });

  it("handles content with no newline after attachment prefix", () => {
    expect(stripAttachmentRefs("[Attached file: /a.png]text")).toBe("text");
  });

  it("does not strip attachment-like text in the middle of content", () => {
    expect(
      stripAttachmentRefs("please see [Attached file: /a.png] for details")
    ).toBe("please see [Attached file: /a.png] for details");
  });

  it("returns empty string for empty input", () => {
    expect(stripAttachmentRefs("")).toBe("");
  });
});

describe("getUserMessageHistory", () => {
  it("returns empty array for no messages", () => {
    expect(getUserMessageHistory([])).toEqual([]);
  });

  it("returns empty array when only assistant messages exist", () => {
    const messages = [
      makeMessage("assistant", "Hello, how can I help?"),
      makeMessage("assistant", "Sure, I can do that."),
    ];
    expect(getUserMessageHistory(messages)).toEqual([]);
  });

  it("extracts user messages in oldest-first order", () => {
    const messages = [
      makeMessage("user", "first"),
      makeMessage("assistant", "reply 1"),
      makeMessage("user", "second"),
      makeMessage("assistant", "reply 2"),
      makeMessage("user", "third"),
    ];
    expect(getUserMessageHistory(messages)).toEqual(["first", "second", "third"]);
  });

  it("deduplicates by content, keeping most recent position", () => {
    const messages = [
      makeMessage("user", "hello"),
      makeMessage("assistant", "hi"),
      makeMessage("user", "goodbye"),
      makeMessage("assistant", "bye"),
      makeMessage("user", "hello"),
    ];
    // "hello" appears twice; deduplicated with most recent position (last)
    expect(getUserMessageHistory(messages)).toEqual(["goodbye", "hello"]);
  });

  it("respects the limit parameter", () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeMessage("user", `message ${i}`)
    );
    const result = getUserMessageHistory(messages, 5);
    expect(result).toHaveLength(5);
    expect(result).toEqual([
      "message 15",
      "message 16",
      "message 17",
      "message 18",
      "message 19",
    ]);
  });

  it("defaults limit to 10", () => {
    const messages = Array.from({ length: 15 }, (_, i) =>
      makeMessage("user", `msg ${i}`)
    );
    expect(getUserMessageHistory(messages)).toHaveLength(10);
  });

  it("strips attachment prefixes from user messages", () => {
    const messages = [
      makeMessage("user", "[Attached file: /a.png]\n\ncheck this image"),
      makeMessage("user", "plain text"),
    ];
    expect(getUserMessageHistory(messages)).toEqual([
      "check this image",
      "plain text",
    ]);
  });

  it("excludes attachment-only messages (empty after stripping)", () => {
    const messages = [
      makeMessage("user", "[Attached file: /a.png]\n"),
      makeMessage("user", "real message"),
    ];
    expect(getUserMessageHistory(messages)).toEqual(["real message"]);
  });

  it("deduplication considers stripped content", () => {
    const messages = [
      makeMessage("user", "hello"),
      makeMessage("user", "[Attached file: /a.png]\n\nhello"),
    ];
    // Both resolve to "hello" after stripping; keep most recent
    expect(getUserMessageHistory(messages)).toEqual(["hello"]);
  });
});
