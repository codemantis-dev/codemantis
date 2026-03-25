import { describe, it, expect } from "vitest";
import { shouldSend, sendShortcutLabel, sendShortcutHint } from "./keyboard";

function key(overrides: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) {
  return { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, ...overrides };
}

describe("shouldSend", () => {
  describe('shortcut = "cmd+enter"', () => {
    it("returns true for Cmd+Enter", () => {
      expect(shouldSend(key({ metaKey: true }), "cmd+enter")).toBe(true);
    });
    it("returns true for Ctrl+Enter", () => {
      expect(shouldSend(key({ ctrlKey: true }), "cmd+enter")).toBe(true);
    });
    it("returns false for bare Enter", () => {
      expect(shouldSend(key(), "cmd+enter")).toBe(false);
    });
    it("returns false for Shift+Enter", () => {
      expect(shouldSend(key({ shiftKey: true, metaKey: true }), "cmd+enter")).toBe(false);
    });
    it("returns false for non-Enter key", () => {
      expect(shouldSend(key({ key: "a", metaKey: true }), "cmd+enter")).toBe(false);
    });
  });

  describe('shortcut = "enter"', () => {
    it("returns true for bare Enter", () => {
      expect(shouldSend(key(), "enter")).toBe(true);
    });
    it("returns false for Cmd+Enter", () => {
      expect(shouldSend(key({ metaKey: true }), "enter")).toBe(false);
    });
    it("returns false for Ctrl+Enter", () => {
      expect(shouldSend(key({ ctrlKey: true }), "enter")).toBe(false);
    });
    it("returns false for Shift+Enter", () => {
      expect(shouldSend(key({ shiftKey: true }), "enter")).toBe(false);
    });
  });
});

describe("sendShortcutLabel", () => {
  it('returns "↵" for enter', () => {
    expect(sendShortcutLabel("enter")).toBe("↵");
  });
  it('returns "⌘↵" for cmd+enter', () => {
    expect(sendShortcutLabel("cmd+enter")).toBe("⌘↵");
  });
});

describe("sendShortcutHint", () => {
  it('returns "Enter to send" for enter', () => {
    expect(sendShortcutHint("enter")).toBe("Enter to send");
  });
  it('returns "⌘+Enter to send" for cmd+enter', () => {
    expect(sendShortcutHint("cmd+enter")).toBe("⌘+Enter to send");
  });
});
