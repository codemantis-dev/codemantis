import { describe, it, expect, vi, afterEach } from "vitest";
import { relativeTime, basename } from "./commit-format";

describe("relativeTime", () => {
  afterEach(() => vi.useRealTimers());

  function at(now: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
  }

  it("formats sub-minute as 'just now'", () => {
    at("2026-06-01T12:00:30Z");
    expect(relativeTime("2026-06-01T12:00:00Z")).toBe("just now");
  });

  it("formats minutes, hours, days, months, years", () => {
    at("2026-06-01T12:00:00Z");
    expect(relativeTime("2026-06-01T11:55:00Z")).toBe("5m ago");
    expect(relativeTime("2026-06-01T09:00:00Z")).toBe("3h ago");
    expect(relativeTime("2026-05-29T12:00:00Z")).toBe("3d ago");
    expect(relativeTime("2026-04-01T12:00:00Z")).toBe("2mo ago");
    expect(relativeTime("2024-06-01T12:00:00Z")).toBe("2y ago");
  });

  it("treats a future timestamp as 'just now'", () => {
    at("2026-06-01T12:00:00Z");
    expect(relativeTime("2026-06-01T12:05:00Z")).toBe("just now");
  });

  it("returns empty string for an unparseable date", () => {
    expect(relativeTime("nonsense")).toBe("");
  });
});

describe("basename", () => {
  it("returns the final path segment", () => {
    expect(basename("src/components/App.tsx")).toBe("App.tsx");
    expect(basename("README.md")).toBe("README.md");
    expect(basename("a/b/c/")).toBe("c");
  });
});
