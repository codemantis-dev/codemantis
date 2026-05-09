import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockOpenUrl } = vi.hoisted(() => ({
  mockOpenUrl: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}));

import OpenUrlStep from "./OpenUrlStep";

beforeEach(() => {
  mockOpenUrl.mockReset();
  mockOpenUrl.mockResolvedValue(undefined);
});

describe("OpenUrlStep", () => {
  it("renders the URL beneath the button for transparency", () => {
    render(
      <OpenUrlStep
        url="https://stripe.com/login"
        label="Open Stripe"
        onContinue={() => {}}
      />,
    );
    expect(screen.getByText("https://stripe.com/login")).toBeInTheDocument();
  });

  it("uses the provided label on the button", () => {
    render(
      <OpenUrlStep
        url="https://example.com"
        label="Open Stripe"
        onContinue={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Open Stripe/ })).toBeInTheDocument();
  });

  it("falls back to a default label when none is given", () => {
    render(<OpenUrlStep url="https://example.com" onContinue={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Open in browser/ }),
    ).toBeInTheDocument();
  });

  it("opens the URL via Tauri and calls onContinue", async () => {
    const onContinue = vi.fn();
    render(
      <OpenUrlStep
        url="https://example.com"
        label="Go"
        onContinue={onContinue}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com"));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("still advances the stepper if the OS reports a failure (don't trap user)", async () => {
    mockOpenUrl.mockRejectedValueOnce(new Error("no browser"));
    const onContinue = vi.fn();
    render(<OpenUrlStep url="https://x" onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onContinue).toHaveBeenCalled());
  });
});
