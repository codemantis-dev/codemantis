import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import AppErrorBoundary from "./AppErrorBoundary";

function Boom({ when }: { when: boolean }) {
  if (when) throw new Error("kaboom");
  return <div>healthy child</div>;
}

describe("AppErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error is thrown", () => {
    render(
      <AppErrorBoundary>
        <Boom when={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("healthy child")).toBeInTheDocument();
  });

  it("renders the recovery UI when a child throws", () => {
    render(
      <AppErrorBoundary>
        <Boom when={true} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try to recover/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload window/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy details/i })).toBeInTheDocument();
  });

  it("logs the error and component stack to console.error", () => {
    render(
      <AppErrorBoundary>
        <Boom when={true} />
      </AppErrorBoundary>,
    );
    const calls = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some((m: string) => m.includes("[AppErrorBoundary] Uncaught render error"))).toBe(true);
    expect(calls.some((m: string) => m.includes("[AppErrorBoundary] Component stack"))).toBe(true);
  });

  it("clears the error and re-renders children when 'Try to recover' is clicked", () => {
    const { rerender } = render(
      <AppErrorBoundary>
        <Boom when={true} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Swap to a non-throwing child before resetting, otherwise the boundary
    // would catch immediately on the next render.
    rerender(
      <AppErrorBoundary>
        <Boom when={false} />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /try to recover/i }));

    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.getByText("healthy child")).toBeInTheDocument();
  });

  it("copies error details to clipboard and shows a 'Copied' confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <AppErrorBoundary>
        <Boom when={true} />
      </AppErrorBoundary>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy details/i }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toContain("Message: kaboom");
    expect(payload).toContain("Stack:");
    expect(payload).toContain("Component stack:");

    expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
  });
});
