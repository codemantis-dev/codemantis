import { describe, it, expect } from "vitest";
import type { Message } from "../types/session";
import {
  buildTranscriptText,
  buildLocalRecap,
  conversationalCharCount,
  LOCAL_RECAP_MESSAGES,
  LOCAL_RECAP_PER_MESSAGE_CHARS,
} from "./recap";

function msg(partial: Partial<Message> & Pick<Message, "role" | "content">): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    timestamp: "2026-06-13T00:00:00Z",
    activityIds: [],
    isStreaming: false,
    ...partial,
  };
}

describe("buildTranscriptText", () => {
  it("tags roles and joins conversational messages", () => {
    const out = buildTranscriptText([
      msg({ role: "user", content: "fix the bug" }),
      msg({ role: "assistant", content: "done" }),
    ]);
    expect(out).toBe("User: fix the bug\n\nAssistant: done");
  });

  it("skips error/recover/self-drive cards", () => {
    const out = buildTranscriptText([
      msg({ role: "user", content: "real prompt" }),
      msg({ role: "assistant", content: "compaction failed", recoverable: true }),
      msg({ role: "assistant", content: "crashed", restartable: true }),
      msg({ role: "assistant", content: "retry me", retryable: true }),
    ]);
    expect(out).toBe("User: real prompt");
  });

  it("keeps the most recent content within the char budget", () => {
    const big = "x".repeat(500);
    const out = buildTranscriptText(
      [
        msg({ role: "user", content: `OLD ${big}` }),
        msg({ role: "assistant", content: `NEW ${big}` }),
      ],
      600, // budget fits only one message
    );
    expect(out).toContain("NEW");
    expect(out).not.toContain("OLD");
  });
});

describe("conversationalCharCount", () => {
  it("sums trimmed lengths of conversational messages only", () => {
    const messages = [
      msg({ role: "user", content: "  hello  " }), // 5 trimmed
      msg({ role: "assistant", content: "world!" }), // 6
      msg({ role: "assistant", content: "skip me", recoverable: true }), // excluded (card)
    ];
    expect(conversationalCharCount(messages)).toBe(11);
  });

  it("returns 0 for only cards/empty", () => {
    expect(conversationalCharCount([msg({ role: "assistant", content: "x", restartable: true })])).toBe(0);
  });
});

describe("buildLocalRecap", () => {
  it("quotes a bounded tail with a framing note", () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg({ role: i % 2 === 0 ? "user" : "assistant", content: `turn ${i}` }),
    );
    const recap = buildLocalRecap(messages);
    expect(recap).toContain("Recap of the prior conversation");
    // Only the last LOCAL_RECAP_MESSAGES turns are quoted.
    expect(recap).toContain("turn 9");
    expect(recap).not.toContain("turn 0");
    const quotedTurns = recap.match(/turn \d/g) ?? [];
    expect(quotedTurns.length).toBe(LOCAL_RECAP_MESSAGES);
  });

  it("truncates long messages", () => {
    const long = "y".repeat(LOCAL_RECAP_PER_MESSAGE_CHARS + 200);
    const recap = buildLocalRecap([msg({ role: "user", content: long })]);
    expect(recap).toContain("…");
    expect(recap).not.toContain(long);
  });

  it("returns a graceful note when there is nothing to recap", () => {
    const recap = buildLocalRecap([
      msg({ role: "assistant", content: "crashed", restartable: true }),
    ]);
    expect(recap).toContain("could not be recapped");
  });
});
