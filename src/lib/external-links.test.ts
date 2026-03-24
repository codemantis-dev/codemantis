import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { ExternalLink, markdownLinkComponents } from "./external-links";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import { openUrl } from "@tauri-apps/plugin-opener";

const mockOpenUrl = vi.mocked(openUrl);

describe("ExternalLink", () => {
  beforeEach(() => {
    mockOpenUrl.mockClear();
  });

  it("renders an anchor element with the correct href", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "https://example.com" }, "Click me"),
    );
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.getAttribute("href")).toBe("https://example.com");
    expect(a!.textContent).toBe("Click me");
  });

  it("sets rel='noopener noreferrer'", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "https://example.com" }, "link"),
    );
    const a = container.querySelector("a")!;
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("calls openUrl and prevents default on click", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "https://example.com" }, "link"),
    );
    const a = container.querySelector("a")!;
    fireEvent.click(a);
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("does not call openUrl when href is missing", () => {
    const { container } = render(
      createElement(ExternalLink, {}, "no href"),
    );
    const a = container.querySelector("a")!;
    fireEvent.click(a);
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("works with mailto links", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "mailto:test@example.com" }, "email"),
    );
    const a = container.querySelector("a")!;
    fireEvent.click(a);
    expect(mockOpenUrl).toHaveBeenCalledWith("mailto:test@example.com");
  });

  it("strips the node prop without passing it to the DOM", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "https://x.com", node: {} } as never, "link"),
    );
    const a = container.querySelector("a")!;
    expect(a.getAttribute("node")).toBeNull();
  });

  it("logs error when openUrl rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockOpenUrl.mockRejectedValueOnce(new Error("fail"));

    const { container } = render(
      createElement(ExternalLink, { href: "https://example.com" }, "link"),
    );
    fireEvent.click(container.querySelector("a")!);

    // Wait for the rejection handler
    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to open external URL:",
        expect.any(Error),
      );
    });
    consoleSpy.mockRestore();
  });
});

describe("markdownLinkComponents", () => {
  it("exports an object with `a` set to ExternalLink", () => {
    expect(markdownLinkComponents).toHaveProperty("a", ExternalLink);
  });
});
