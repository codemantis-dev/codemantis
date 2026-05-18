import { describe, it, expect } from "vitest";
import type {
  AgentId,
  FrontendEvent,
  SessionInitEvent,
  TextDeltaEvent,
} from "./agent-events";
// Legacy path must keep resolving via the Session 4 re-export shim.
import type { FrontendEvent as LegacyFrontendEvent } from "./claude-events";

describe("agent-events (Phase 1 Session 4 rename)", () => {
  it("AgentId accepts the Phase 1 claude_code value", () => {
    const id: AgentId = "claude_code";
    expect(id).toBe("claude_code");
  });

  it("events compile without agent_id (optional in Phase 1)", () => {
    const ev: SessionInitEvent = {
      type: "session_init",
      session_id: "s1",
      model: "claude-opus-4-7",
    };
    expect(ev.agent_id).toBeUndefined();
  });

  it("events may carry an optional agent_id discriminator", () => {
    const ev: TextDeltaEvent = {
      type: "text_delta",
      session_id: "s1",
      text: "hi",
      agent_id: "claude_code",
    };
    expect(ev.agent_id).toBe("claude_code");
  });

  it("FrontendEvent union still discriminates on type", () => {
    const ev: FrontendEvent = {
      type: "text_complete",
      session_id: "s1",
      full_text: "done",
    };
    if (ev.type === "text_complete") {
      expect(ev.full_text).toBe("done");
    }
  });

  it("legacy ./claude-events path re-exports the same union", () => {
    // Structural identity: a value typed via the shim is assignable to the
    // canonical type. (Type-level check; runtime asserts the shape exists.)
    const viaShim: LegacyFrontendEvent = {
      type: "process_error",
      session_id: "s1",
      error: "boom",
    };
    const viaCanonical: FrontendEvent = viaShim;
    expect(viaCanonical.type).toBe("process_error");
  });
});
