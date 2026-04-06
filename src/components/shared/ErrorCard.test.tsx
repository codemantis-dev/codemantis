import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorCard from "./ErrorCard";

describe("ErrorCard", () => {
  it("renders title and message", () => {
    render(<ErrorCard title="Connection failed" message="Unable to reach the server" />);
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
    expect(screen.getByText("Unable to reach the server")).toBeInTheDocument();
  });

  it("renders remediation when provided", () => {
    render(
      <ErrorCard
        title="Auth error"
        message="Token expired"
        remediation="Re-authenticate to refresh your token"
      />,
    );
    expect(screen.getByText("How to fix:")).toBeInTheDocument();
    expect(screen.getByText("Re-authenticate to refresh your token")).toBeInTheDocument();
  });

  it("toggles technical details expansion", () => {
    render(
      <ErrorCard
        title="Parse error"
        message="Invalid JSON"
        rawError="SyntaxError: Unexpected token < at position 0"
      />,
    );
    // Details should be collapsed initially
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    expect(screen.queryByText("SyntaxError: Unexpected token < at position 0")).not.toBeInTheDocument();

    // Expand
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("SyntaxError: Unexpected token < at position 0")).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.queryByText("SyntaxError: Unexpected token < at position 0")).not.toBeInTheDocument();
  });

  it("renders compact variant", () => {
    const { container } = render(
      <ErrorCard title="Minor warning" message="Something went wrong" compact />,
    );
    expect(screen.getByText("Minor warning")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    // Compact variant uses borderLeftWidth 3px on the outer div
    const outerDiv = container.firstChild as HTMLElement;
    expect(outerDiv.style.borderLeftWidth).toBe("3px");
  });

  it("dismiss button calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(
      <ErrorCard title="Error" message="msg" onDismiss={onDismiss} />,
    );
    const dismissBtn = screen.getByLabelText("Dismiss");
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
