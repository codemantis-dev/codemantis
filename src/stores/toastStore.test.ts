import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useToastStore, showToast } from "./toastStore";

function resetStore(): void {
  useToastStore.setState({ toasts: [] });
}

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no toasts", () => {
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("addToast adds a toast with correct properties", () => {
    useToastStore.getState().addToast("Test message", "info");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Test message");
    expect(toasts[0].type).toBe("info");
    expect(toasts[0].id).toMatch(/^toast-/);
  });

  it("addToast uses default duration for info type", () => {
    useToastStore.getState().addToast("Info toast", "info");
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].duration).toBe(5000);
  });

  it("addToast uses default duration for error type", () => {
    useToastStore.getState().addToast("Error toast", "error");
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].duration).toBe(8000);
  });

  it("addToast uses default duration for success type", () => {
    useToastStore.getState().addToast("Success toast", "success");
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].duration).toBe(5000);
  });

  it("addToast respects custom duration", () => {
    useToastStore.getState().addToast("Custom", "info", 3000);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].duration).toBe(3000);
  });

  it("removeToast removes the correct toast", () => {
    useToastStore.getState().addToast("First", "info");
    useToastStore.getState().addToast("Second", "error");
    const firstId = useToastStore.getState().toasts[0].id;

    useToastStore.getState().removeToast(firstId);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Second");
  });

  it("auto-removes toast after its duration", () => {
    useToastStore.getState().addToast("Timed", "info", 2000);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(2000);

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("multiple toasts are tracked independently", () => {
    useToastStore.getState().addToast("Short", "info", 1000);
    useToastStore.getState().addToast("Long", "info", 5000);
    expect(useToastStore.getState().toasts).toHaveLength(2);

    vi.advanceTimersByTime(1000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toBe("Long");

    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("showToast convenience function adds a toast", () => {
    showToast("Convenience toast");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Convenience toast");
    expect(toasts[0].type).toBe("info"); // default type
  });

  it("showToast respects type and duration parameters", () => {
    showToast("Error toast", "error", 10000);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].duration).toBe(10000);
  });

  it("each toast gets a unique id", () => {
    useToastStore.getState().addToast("A", "info");
    useToastStore.getState().addToast("B", "info");
    const [a, b] = useToastStore.getState().toasts;
    expect(a.id).not.toBe(b.id);
  });
});
