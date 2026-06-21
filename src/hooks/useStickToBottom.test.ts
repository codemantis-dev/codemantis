import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useStickToBottom } from "./useStickToBottom";

interface Msg {
  role: string;
}

/** A jsdom div with controllable scroll geometry. */
function makeScrollEl(scrollHeight: number, clientHeight: number, scrollTop = 0): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  el.scrollTop = scrollTop;
  // jsdom has no layout engine — stub scrollTo to record the target.
  el.scrollTo = ((opts?: ScrollToOptions) => {
    if (opts && typeof opts.top === "number") el.scrollTop = opts.top;
  }) as typeof el.scrollTo;
  return el;
}

describe("useStickToBottom", () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = makeScrollEl(1000, 300, 0);
  });

  function render(initial: { messages: Msg[]; streamingContent: string; isBusy: boolean }) {
    return renderHook(
      ({ messages, streamingContent, isBusy }) => {
        const scrollRef = useRef<HTMLDivElement | null>(el);
        return useStickToBottom({ scrollRef, messages, streamingContent, isBusy });
      },
      { initialProps: initial },
    );
  }

  it("pins to the bottom when a new assistant message arrives while at bottom", () => {
    const { rerender } = render({ messages: [{ role: "user" }], streamingContent: "", isBusy: false });
    el.scrollTop = 0;
    rerender({ messages: [{ role: "user" }, { role: "assistant" }], streamingContent: "x", isBusy: true });
    expect(el.scrollTop).toBe(el.scrollHeight);
  });

  it("force-scrolls to the bottom when the local user sends a message (even if scrolled up)", () => {
    const { result, rerender } = render({ messages: [{ role: "assistant" }], streamingContent: "", isBusy: false });
    // Simulate the user scrolling up.
    el.scrollTop = 0;
    act(() => result.current.onScroll());
    rerender({ messages: [{ role: "assistant" }, { role: "user" }], streamingContent: "", isBusy: false });
    expect(el.scrollTop).toBe(el.scrollHeight);
  });

  it("shows the scroll button when the user scrolls up, hides it via scrollToBottom", () => {
    const { result } = render({ messages: [{ role: "assistant" }], streamingContent: "", isBusy: false });
    el.scrollTop = 0; // far from bottom
    act(() => result.current.onScroll());
    expect(result.current.showScrollButton).toBe(true);
    act(() => result.current.scrollToBottom());
    expect(result.current.showScrollButton).toBe(false);
  });
});
