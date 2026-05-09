import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PasteAndVerifyStep from "./PasteAndVerifyStep";

const stripeRegex = "^sk_(test|live)_[A-Za-z0-9]{8,}$";

describe("PasteAndVerifyStep", () => {
  it("disables Verify until the input is non-empty", () => {
    render(
      <PasteAndVerifyStep
        onVerify={async () => ({ ok: true })}
        onSuccess={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Verify/ })).toBeDisabled();
  });

  it("enables Verify once the user types", () => {
    render(
      <PasteAndVerifyStep
        onVerify={async () => ({ ok: true })}
        onSuccess={() => {}}
      />,
    );
    const input = screen.getByPlaceholderText(/Paste the value/);
    fireEvent.change(input, { target: { value: "anything" } });
    expect(screen.getByRole("button", { name: /Verify/ })).not.toBeDisabled();
  });

  it("disables Verify when value-validation regex says invalid", () => {
    render(
      <PasteAndVerifyStep
        validation={{ kind: "regex", pattern: stripeRegex }}
        onVerify={async () => ({ ok: true })}
        onSuccess={() => {}}
      />,
    );
    const input = screen.getByPlaceholderText(/Paste the value/);
    fireEvent.change(input, { target: { value: "not-a-stripe-key" } });
    expect(screen.getByRole("button", { name: /Verify/ })).toBeDisabled();
  });

  it("enables Verify when value matches the regex", () => {
    render(
      <PasteAndVerifyStep
        validation={{ kind: "regex", pattern: stripeRegex }}
        onVerify={async () => ({ ok: true })}
        onSuccess={() => {}}
      />,
    );
    const input = screen.getByPlaceholderText(/Paste the value/);
    fireEvent.change(input, { target: { value: "sk_test_abcdefgh" } });
    expect(screen.getByRole("button", { name: /Verify/ })).not.toBeDisabled();
  });

  it("on success: calls onSuccess after a short pause", async () => {
    const onSuccess = vi.fn();
    render(
      <PasteAndVerifyStep
        onVerify={async () => ({ ok: true, message: "Stored" })}
        onSuccess={onSuccess}
      />,
    );
    const input = screen.getByPlaceholderText(/Paste the value/);
    fireEvent.change(input, { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));
    await waitFor(() => expect(screen.getByText(/Stored/)).toBeInTheDocument());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled(), { timeout: 1500 });
  });

  it("on failure: surfaces the error and does NOT advance", async () => {
    const onSuccess = vi.fn();
    render(
      <PasteAndVerifyStep
        onVerify={async () => ({ ok: false, error: "API rejected the key" })}
        onSuccess={onSuccess}
      />,
    );
    const input = screen.getByPlaceholderText(/Paste the value/);
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));
    await waitFor(() =>
      expect(screen.getByText(/API rejected the key/)).toBeInTheDocument(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("shows the catalog regex hint when the value fails validation", () => {
    render(
      <PasteAndVerifyStep
        validation={{
          kind: "regex",
          pattern: stripeRegex,
          hint: "Stripe keys start with sk_",
        }}
        onVerify={async () => ({ ok: true })}
        onSuccess={() => {}}
      />,
    );
    const input = screen.getByPlaceholderText(/Paste the value/);
    fireEvent.change(input, { target: { value: "garbage" } });
    expect(screen.getByText(/Stripe keys start with sk_/)).toBeInTheDocument();
  });
});

