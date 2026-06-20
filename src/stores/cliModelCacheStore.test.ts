import { describe, it, expect, beforeEach } from "vitest";
import { useCliModelCacheStore } from "./cliModelCacheStore";
import type { CliModelInfo } from "../types/agent-events";

const codexModels: CliModelInfo[] = [
  { value: "gpt-5.5", displayName: "GPT-5.5", description: "Default", isDefault: true },
  { value: "gpt-5.4", displayName: "GPT-5.4", description: "General" },
];

const claudeModels: CliModelInfo[] = [
  { value: "sonnet", displayName: "Sonnet", description: "Fast", isDefault: true },
];

beforeEach(() => {
  useCliModelCacheStore.getState().clear();
});

describe("cliModelCacheStore", () => {
  it("starts empty for every agent", () => {
    const s = useCliModelCacheStore.getState();
    expect(s.getModels("codex")).toBeUndefined();
    expect(s.getModels("claude_code")).toBeUndefined();
  });

  it("setModels then getModels round-trips the payload", () => {
    useCliModelCacheStore.getState().setModels("codex", codexModels);
    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(codexModels);
  });

  it("isolates the cache per agent", () => {
    const s = useCliModelCacheStore.getState();
    s.setModels("codex", codexModels);
    s.setModels("claude_code", claudeModels);
    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(codexModels);
    expect(useCliModelCacheStore.getState().getModels("claude_code")).toEqual(claudeModels);
  });

  it("records populatedAt timestamps when setModels lands", () => {
    const before = Date.now();
    useCliModelCacheStore.getState().setModels("codex", codexModels);
    const ts = useCliModelCacheStore.getState().populatedAt.codex;
    expect(ts).toBeDefined();
    expect(ts!).toBeGreaterThanOrEqual(before);
  });

  it("refuses to overwrite a populated cache with an empty list", () => {
    // Regression guard: a transport hiccup that delivers models:[] must
    // not erase a previously-good cache — that would silently empty
    // consumer dropdowns the user was relying on.
    const s = useCliModelCacheStore.getState();
    s.setModels("codex", codexModels);
    s.setModels("codex", []);
    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(codexModels);
  });

  it("replaces a populated cache with a new non-empty list", () => {
    const s = useCliModelCacheStore.getState();
    s.setModels("codex", codexModels);
    const newList: CliModelInfo[] = [
      { value: "gpt-6", displayName: "GPT-6", description: "New" },
    ];
    s.setModels("codex", newList);
    expect(useCliModelCacheStore.getState().getModels("codex")).toEqual(newList);
  });

  it("clear(agent) removes only the targeted agent", () => {
    const s = useCliModelCacheStore.getState();
    s.setModels("codex", codexModels);
    s.setModels("claude_code", claudeModels);
    s.clear("codex");
    expect(useCliModelCacheStore.getState().getModels("codex")).toBeUndefined();
    expect(useCliModelCacheStore.getState().getModels("claude_code")).toEqual(claudeModels);
  });

  it("clear() with no arg removes every agent's cache", () => {
    const s = useCliModelCacheStore.getState();
    s.setModels("codex", codexModels);
    s.setModels("claude_code", claudeModels);
    s.clear();
    expect(useCliModelCacheStore.getState().getModels("codex")).toBeUndefined();
    expect(useCliModelCacheStore.getState().getModels("claude_code")).toBeUndefined();
  });

  it("persists the cache to localStorage so it survives a launch", () => {
    useCliModelCacheStore.getState().setModels("codex", codexModels);
    const raw = localStorage.getItem("cm-cli-model-cache");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    // zustand persist nests under `state`; only data is persisted (not methods).
    expect(parsed.state.models.codex).toEqual(codexModels);
    expect(parsed.state.populatedAt.codex).toBeTypeOf("number");
  });
});
