import { describe, it, expect } from "vitest";
import { getActivityType } from "./activity";

describe("getActivityType", () => {
  it("classifies Read as read", () => {
    expect(getActivityType("Read")).toBe("read");
  });

  it("classifies Glob as read", () => {
    expect(getActivityType("Glob")).toBe("read");
  });

  it("classifies Grep as read", () => {
    expect(getActivityType("Grep")).toBe("read");
  });

  it("classifies Write as write", () => {
    expect(getActivityType("Write")).toBe("write");
  });

  it("classifies Edit as edit", () => {
    expect(getActivityType("Edit")).toBe("edit");
  });

  it("classifies Bash as bash", () => {
    expect(getActivityType("Bash")).toBe("bash");
  });

  it("classifies unknown tools as other", () => {
    expect(getActivityType("SomeNewTool")).toBe("other");
    expect(getActivityType("MCP_tool")).toBe("other");
    expect(getActivityType("")).toBe("other");
  });
});
