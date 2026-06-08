import { describe, it, expect } from "vitest";
import { parseMcpRows, configEntries } from "./codex-panel-helpers";

describe("CodexManagementPanel — parseMcpRows", () => {
  it("maps server entries with auth status and tool counts", () => {
    const resp = {
      data: [
        { name: "github", authStatus: "oAuth", tools: { a: {}, b: {} } },
        { name: "fs", authStatus: "notLoggedIn", tools: {} },
      ],
    };
    expect(parseMcpRows(resp)).toEqual([
      { name: "github", authStatus: "oAuth", toolCount: 2 },
      { name: "fs", authStatus: "notLoggedIn", toolCount: 0 },
    ]);
  });

  it("tolerates missing/extra fields without throwing", () => {
    const resp = { data: [{ name: "x" }, { tools: { only: {} } }] };
    expect(parseMcpRows(resp)).toEqual([
      { name: "x", authStatus: undefined, toolCount: 0 },
      { name: "(unnamed)", authStatus: undefined, toolCount: 1 },
    ]);
  });

  it("returns [] for non-array / null / missing data", () => {
    expect(parseMcpRows(null)).toEqual([]);
    expect(parseMcpRows({})).toEqual([]);
    expect(parseMcpRows({ data: "nope" })).toEqual([]);
  });
});

describe("CodexManagementPanel — configEntries", () => {
  it("classifies scalars vs nested values and sorts by key", () => {
    const resp = {
      config: {
        model: "gpt-5.5",
        approval: { rules: true },
        web_search: false,
        servers: ["a", "b"],
      },
    };
    const entries = configEntries(resp);
    expect(entries.map((e) => e.key)).toEqual([
      "approval",
      "model",
      "servers",
      "web_search",
    ]);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e.scalar]));
    expect(byKey.model).toBe(true);
    expect(byKey.web_search).toBe(true);
    expect(byKey.approval).toBe(false);
    expect(byKey.servers).toBe(false);
  });

  it("never hardcodes keys — surfaces unknown keys generically", () => {
    const resp = { config: { some_future_key_2027: "x" } };
    expect(configEntries(resp).map((e) => e.key)).toEqual(["some_future_key_2027"]);
  });

  it("returns [] when config is missing or not an object", () => {
    expect(configEntries(null)).toEqual([]);
    expect(configEntries({})).toEqual([]);
    expect(configEntries({ config: "nope" })).toEqual([]);
  });
});
