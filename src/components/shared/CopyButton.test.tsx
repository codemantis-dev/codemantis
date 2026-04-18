import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import CopyButton from "./CopyButton";

// Mock the toast store so we can assert it fires only when requested.
const mockShowToast = vi.fn();
vi.mock("../../stores/toastStore", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

describe("CopyButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls navigator.clipboard.writeText with the lazy text on click", () => {
    const getText = vi.fn(() => "snapshot-at-click-time");
    render(<CopyButton getText={getText} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(getText).toHaveBeenCalledOnce();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("snapshot-at-click-time");
  });

  it("flashes 'Copied' in the tooltip for 1.5s then reverts", async () => {
    render(<CopyButton getText={() => "x"} label="Copy X" />);
    const btn = screen.getByRole("button", { name: "Copy X" });

    // Idle tooltip
    expect(btn.getAttribute("title")).toBe("Copy X");

    await act(async () => {
      fireEvent.click(btn);
      // Let the writeText promise resolve before the timer advances.
      await Promise.resolve();
    });

    expect(btn.getAttribute("title")).toBe("Copied");

    // Advance past the 1500ms reset.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(btn.getAttribute("title")).toBe("Copy X");
  });

  it("fires showToast only when showToast prop is true", async () => {
    render(<CopyButton getText={() => "hello"} showToast={true} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await Promise.resolve();
    });
    expect(mockShowToast).toHaveBeenCalledWith("Copied", "success", 1500);
  });

  it("does not fire showToast by default", async () => {
    render(<CopyButton getText={() => "hello"} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await Promise.resolve();
    });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("swallows clipboard errors instead of throwing", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<CopyButton getText={() => "nope"} />);
    // This must not throw, and title must NOT flip to "Copied".
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("button").getAttribute("title")).toBe("Copy");
  });
});
