import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExternalLinkGuard } from "./useExternalLinkGuard";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import { openUrl } from "@tauri-apps/plugin-opener";

const mockOpenUrl = vi.mocked(openUrl);

/** Helper: create an `<a>` inside a container, click it, and return the event. */
function clickLink(href: string, attrs?: Record<string, string>): MouseEvent {
  const a = document.createElement("a");
  a.href = href;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  }
  document.body.appendChild(a);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(event);
  document.body.removeChild(a);
  return event;
}

describe("useExternalLinkGuard", () => {
  beforeEach(() => {
    mockOpenUrl.mockClear();
  });

  afterEach(() => {
    // Ensure no leaked listeners between tests
  });

  it("intercepts https links and calls openUrl", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    act(() => {
      clickLink("https://example.com");
    });

    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/");
    unmount();
  });

  it("intercepts http links and calls openUrl", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    act(() => {
      clickLink("http://example.com");
    });

    expect(mockOpenUrl).toHaveBeenCalledWith("http://example.com/");
    unmount();
  });

  it("intercepts mailto links and calls openUrl", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    act(() => {
      clickLink("mailto:test@example.com");
    });

    expect(mockOpenUrl).toHaveBeenCalledWith("mailto:test@example.com");
    unmount();
  });

  it("does NOT intercept anchor (#) links", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    act(() => {
      clickLink("#section");
    });

    expect(mockOpenUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("does NOT intercept localhost URLs", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    act(() => {
      clickLink("http://localhost:3000");
    });

    expect(mockOpenUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("does NOT intercept 127.0.0.1 URLs", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    act(() => {
      clickLink("http://127.0.0.1:8080/api");
    });

    expect(mockOpenUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("does NOT intercept links with data-internal-link", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    act(() => {
      clickLink("https://example.com", { "data-internal-link": "" });
    });

    expect(mockOpenUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("skips already-prevented events (e.g. from ExternalLink component)", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    const a = document.createElement("a");
    a.href = "https://example.com";
    document.body.appendChild(a);

    act(() => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      event.preventDefault(); // simulate Layer 1 already handled it
      a.dispatchEvent(event);
    });

    expect(mockOpenUrl).not.toHaveBeenCalled();
    document.body.removeChild(a);
    unmount();
  });

  it("cleans up listener on unmount", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());
    unmount();

    act(() => {
      clickLink("https://example.com");
    });

    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("works when clicking a child element inside an anchor", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    const a = document.createElement("a");
    a.href = "https://example.com";
    const span = document.createElement("span");
    span.textContent = "Click me";
    a.appendChild(span);
    document.body.appendChild(a);

    act(() => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      span.dispatchEvent(event);
    });

    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/");
    document.body.removeChild(a);
    unmount();
  });

  it("does NOT intercept clicks on non-anchor elements", () => {
    const { unmount } = renderHook(() => useExternalLinkGuard());

    const div = document.createElement("div");
    document.body.appendChild(div);

    act(() => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      div.dispatchEvent(event);
    });

    expect(mockOpenUrl).not.toHaveBeenCalled();
    document.body.removeChild(div);
    unmount();
  });
});
