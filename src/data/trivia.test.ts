import { describe, it, expect } from "vitest";
import { getRandomTrivia, getRandomEasterEgg } from "./trivia";

describe("getRandomTrivia", () => {
  it("returns a fact with topic and isEasterEgg false", () => {
    const result = getRandomTrivia();
    expect(result).toHaveProperty("topic");
    expect(result).toHaveProperty("fact");
    expect(result.isEasterEgg).toBe(false);
    expect(typeof result.topic).toBe("string");
    expect(typeof result.fact).toBe("string");
  });

  it("never returns the excluded topic", () => {
    const first = getRandomTrivia();
    for (let i = 0; i < 50; i++) {
      const next = getRandomTrivia(first.topic);
      expect(next.topic).not.toBe(first.topic);
    }
  });
});

describe("getRandomEasterEgg", () => {
  it("returns a fact with isEasterEgg true", () => {
    const result = getRandomEasterEgg();
    expect(result).toHaveProperty("topic");
    expect(result).toHaveProperty("fact");
    expect(result.isEasterEgg).toBe(true);
    expect(typeof result.topic).toBe("string");
    expect(typeof result.fact).toBe("string");
  });
});
