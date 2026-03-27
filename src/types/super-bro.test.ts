import { describe, it, expect } from "vitest";
import type {
  SuperBroTrigger,
  SuperBroMessage,
  Observation,
  SuperBroState,
} from "./super-bro";

describe("SuperBroTrigger", () => {
  it("accepts all 9 trigger values", () => {
    const triggers: SuperBroTrigger[] = [
      "claude_response",
      "build_error",
      "test_failure",
      "preview_error",
      "guide_session_complete",
      "guide_session_start",
      "silence_timeout",
      "destructive_action",
      "session_start",
    ];

    expect(triggers).toHaveLength(9);
    triggers.forEach((t) => {
      expect(typeof t).toBe("string");
    });
  });
});

describe("SuperBroMessage", () => {
  it("contains all required fields", () => {
    const msg: SuperBroMessage = {
      id: "msg-1",
      guidance: "Consider running tests before committing.",
      suggestedPrompt: "pnpm test",
      fileCheckRequest: null,
      trigger: "build_error",
      timestamp: "2026-03-27T12:00:00Z",
      dismissed: false,
    };

    expect(msg.id).toBe("msg-1");
    expect(msg.guidance).toBe("Consider running tests before committing.");
    expect(msg.suggestedPrompt).toBe("pnpm test");
    expect(msg.fileCheckRequest).toBeNull();
    expect(msg.trigger).toBe("build_error");
    expect(msg.timestamp).toBe("2026-03-27T12:00:00Z");
    expect(msg.dismissed).toBe(false);
  });

  it("allows null for suggestedPrompt and fileCheckRequest", () => {
    const msg: SuperBroMessage = {
      id: "msg-2",
      guidance: "All clear.",
      suggestedPrompt: null,
      fileCheckRequest: null,
      trigger: "session_start",
      timestamp: "2026-03-27T12:00:00Z",
      dismissed: true,
    };

    expect(msg.suggestedPrompt).toBeNull();
    expect(msg.fileCheckRequest).toBeNull();
  });

  it("allows string values for suggestedPrompt and fileCheckRequest", () => {
    const msg: SuperBroMessage = {
      id: "msg-3",
      guidance: "Check this file.",
      suggestedPrompt: "cat src/main.ts",
      fileCheckRequest: "src/main.ts",
      trigger: "claude_response",
      timestamp: "2026-03-27T12:00:00Z",
      dismissed: false,
    };

    expect(msg.suggestedPrompt).toBe("cat src/main.ts");
    expect(msg.fileCheckRequest).toBe("src/main.ts");
  });
});

describe("Observation", () => {
  it("contains all required fields", () => {
    const obs: Observation = {
      id: "obs-1",
      text: "User prefers functional components",
      category: "preference",
      createdAt: "2026-03-27T10:00:00Z",
      lastReferencedAt: "2026-03-27T12:00:00Z",
    };

    expect(obs.id).toBe("obs-1");
    expect(obs.text).toBe("User prefers functional components");
    expect(obs.category).toBe("preference");
    expect(obs.createdAt).toBe("2026-03-27T10:00:00Z");
    expect(obs.lastReferencedAt).toBe("2026-03-27T12:00:00Z");
  });

  it("accepts all 4 category values", () => {
    const categories: Observation["category"][] = [
      "pattern",
      "preference",
      "issue",
      "project_note",
    ];

    expect(categories).toHaveLength(4);

    const observations: Observation[] = categories.map((cat, i) => ({
      id: `obs-${i}`,
      text: `Observation with category ${cat}`,
      category: cat,
      createdAt: "2026-03-27T10:00:00Z",
      lastReferencedAt: "2026-03-27T12:00:00Z",
    }));

    expect(observations[0].category).toBe("pattern");
    expect(observations[1].category).toBe("preference");
    expect(observations[2].category).toBe("issue");
    expect(observations[3].category).toBe("project_note");
  });
});

describe("SuperBroState", () => {
  it("contains all required fields with defaults", () => {
    const state: SuperBroState = {
      enabled: true,
      currentMessage: null,
      isThinking: false,
      isPaused: false,
      observations: [],
      messageHistory: [],
    };

    expect(state.enabled).toBe(true);
    expect(state.currentMessage).toBeNull();
    expect(state.isThinking).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.observations).toEqual([]);
    expect(state.messageHistory).toEqual([]);
  });

  it("holds a currentMessage when present", () => {
    const msg: SuperBroMessage = {
      id: "msg-state",
      guidance: "Heads up!",
      suggestedPrompt: null,
      fileCheckRequest: null,
      trigger: "destructive_action",
      timestamp: "2026-03-27T12:00:00Z",
      dismissed: false,
    };

    const state: SuperBroState = {
      enabled: true,
      currentMessage: msg,
      isThinking: true,
      isPaused: false,
      observations: [],
      messageHistory: [msg],
    };

    expect(state.currentMessage).toBe(msg);
    expect(state.currentMessage?.trigger).toBe("destructive_action");
    expect(state.isThinking).toBe(true);
    expect(state.messageHistory).toHaveLength(1);
  });

  it("holds observations and messageHistory arrays", () => {
    const obs: Observation = {
      id: "obs-state",
      text: "Prefers Tailwind",
      category: "preference",
      createdAt: "2026-03-27T10:00:00Z",
      lastReferencedAt: "2026-03-27T12:00:00Z",
    };

    const msg: SuperBroMessage = {
      id: "msg-history",
      guidance: "Old guidance",
      suggestedPrompt: null,
      fileCheckRequest: null,
      trigger: "silence_timeout",
      timestamp: "2026-03-27T11:00:00Z",
      dismissed: true,
    };

    const state: SuperBroState = {
      enabled: false,
      currentMessage: null,
      isThinking: false,
      isPaused: true,
      observations: [obs],
      messageHistory: [msg],
    };

    expect(state.enabled).toBe(false);
    expect(state.isPaused).toBe(true);
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0].category).toBe("preference");
    expect(state.messageHistory).toHaveLength(1);
    expect(state.messageHistory[0].dismissed).toBe(true);
  });
});
