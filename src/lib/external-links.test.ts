import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { ExternalLink, markdownLinkComponents } from "./external-links";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("../hooks/useFileViewer", () => ({
  openFileInViewer: vi.fn(() => Promise.resolve()),
}));

import { openUrl } from "@tauri-apps/plugin-opener";
import { openFileInViewer } from "../hooks/useFileViewer";

const mockOpenUrl = vi.mocked(openUrl);
const mockOpenFileInViewer = vi.mocked(openFileInViewer);

describe("ExternalLink", () => {
  beforeEach(() => {
    mockOpenUrl.mockClear();
    mockOpenFileInViewer.mockClear();
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

  it("opens a relative file path in the File Viewer, not the browser", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "plans/foo.md" }, "plans/foo.md"),
    );
    fireEvent.click(container.querySelector("a")!);
    expect(mockOpenFileInViewer).toHaveBeenCalledWith("plans/foo.md");
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("opens an absolute file path in the File Viewer", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "/Users/x/foo.md" }, "foo.md"),
    );
    fireEvent.click(container.querySelector("a")!);
    expect(mockOpenFileInViewer).toHaveBeenCalledWith("/Users/x/foo.md");
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("does not route web URLs to the File Viewer", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "https://example.com" }, "link"),
    );
    fireEvent.click(container.querySelector("a")!);
    expect(mockOpenFileInViewer).not.toHaveBeenCalled();
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("ignores pure in-page anchors", () => {
    const { container } = render(
      createElement(ExternalLink, { href: "#section" }, "jump"),
    );
    fireEvent.click(container.querySelector("a")!);
    expect(mockOpenFileInViewer).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("logs error when opening a file path rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockOpenFileInViewer.mockRejectedValueOnce(new Error("nope"));

    const { container } = render(
      createElement(ExternalLink, { href: "plans/foo.md" }, "link"),
    );
    fireEvent.click(container.querySelector("a")!);

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to open file:",
        expect.any(Error),
      );
    });
    consoleSpy.mockRestore();
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
