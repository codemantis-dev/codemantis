import { describe, it, expect, beforeEach } from "vitest";
import { useChatSearchStore } from "./chatSearchStore";

describe("chatSearchStore", () => {
  beforeEach(() => {
    useChatSearchStore.getState().reset();
  });

  it("starts closed with empty query and zero matches", () => {
    const s = useChatSearchStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.query).toBe("");
    expect(s.currentIndex).toBe(0);
    expect(s.totalMatches).toBe(0);
  });

  it("open() flips isOpen to true", () => {
    useChatSearchStore.getState().open();
    expect(useChatSearchStore.getState().isOpen).toBe(true);
  });

  it("close() resets state fully", () => {
    const store = useChatSearchStore.getState();
    store.open();
    store.setQuery("hello");
    store.setTotalMatches(5);
    store.next();
    store.close();
    const after = useChatSearchStore.getState();
    expect(after.isOpen).toBe(false);
    expect(after.query).toBe("");
    expect(after.currentIndex).toBe(0);
    expect(after.totalMatches).toBe(0);
  });

  it("setQuery() updates query and resets currentIndex", () => {
    const store = useChatSearchStore.getState();
    store.setTotalMatches(10);
    store.next();
    store.next();
    expect(useChatSearchStore.getState().currentIndex).toBe(2);
    store.setQuery("foo");
    expect(useChatSearchStore.getState().query).toBe("foo");
    expect(useChatSearchStore.getState().currentIndex).toBe(0);
  });

  it("next() wraps from last to first", () => {
    const store = useChatSearchStore.getState();
    store.setTotalMatches(3);
    store.next();
    store.next();
    expect(useChatSearchStore.getState().currentIndex).toBe(2);
    store.next();
    expect(useChatSearchStore.getState().currentIndex).toBe(0);
  });

  it("prev() wraps from first to last", () => {
    const store = useChatSearchStore.getState();
    store.setTotalMatches(3);
    expect(useChatSearchStore.getState().currentIndex).toBe(0);
    store.prev();
    expect(useChatSearchStore.getState().currentIndex).toBe(2);
  });

  it("next/prev are no-ops when no matches", () => {
    const store = useChatSearchStore.getState();
    store.setTotalMatches(0);
    store.next();
    store.prev();
    expect(useChatSearchStore.getState().currentIndex).toBe(0);
  });

  it("setTotalMatches() clamps currentIndex when total shrinks", () => {
    const store = useChatSearchStore.getState();
    store.setTotalMatches(10);
    store.next();
    store.next();
    store.next();
    expect(useChatSearchStore.getState().currentIndex).toBe(3);
    store.setTotalMatches(2);
    expect(useChatSearchStore.getState().currentIndex).toBe(1);
  });

  it("setTotalMatches(0) resets currentIndex to 0", () => {
    const store = useChatSearchStore.getState();
    store.setTotalMatches(5);
    store.next();
    store.next();
    store.setTotalMatches(0);
    const after = useChatSearchStore.getState();
    expect(after.totalMatches).toBe(0);
    expect(after.currentIndex).toBe(0);
  });

  it("setTotalMatches keeps currentIndex when within bounds", () => {
    const store = useChatSearchStore.getState();
    store.setTotalMatches(10);
    store.next();
    store.setTotalMatches(5);
    expect(useChatSearchStore.getState().currentIndex).toBe(1);
  });
});
