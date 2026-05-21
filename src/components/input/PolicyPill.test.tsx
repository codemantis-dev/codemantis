import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import PolicyPill from "./PolicyPill";
import type { CodexSessionPolicy } from "../../lib/tauri-commands";

vi.mock("../../lib/tauri-commands", () => ({
  setCodexPolicy: vi.fn(() => Promise.resolve()),
}));

const defaultPolicy: CodexSessionPolicy = {
  sandbox: "workspace-write",
  approval: "on-request",
  network_access: false,
};

describe("PolicyPill", () => {
  it("renders the active sandbox · approval pair in the trigger", () => {
    render(
      <PolicyPill sessionId="s1" value={defaultPolicy} onChange={vi.fn()} />,
    );
    const trigger = screen.getByTestId("policy-pill-trigger");
    expect(trigger).toHaveTextContent("workspace-write");
    expect(trigger).toHaveTextContent("on-request");
  });

  it("opens the popover on click and closes on outside click", () => {
    render(
      <div>
        <div data-testid="outside">click me</div>
        <PolicyPill sessionId="s1" value={defaultPolicy} onChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByTestId("policy-pill-trigger"));
    expect(screen.getByTestId("policy-pill-popover")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("policy-pill-popover")).not.toBeInTheDocument();
  });

  it("commits a sandbox change and calls onChange optimistically", async () => {
    const commit = vi.fn(() => Promise.resolve());
    const onChange = vi.fn();
    render(
      <PolicyPill
        sessionId="s1"
        value={defaultPolicy}
        onChange={onChange}
        commit={commit}
      />,
    );
    fireEvent.click(screen.getByTestId("policy-pill-trigger"));
    fireEvent.click(screen.getByLabelText(/Read-only/));
    expect(onChange).toHaveBeenCalledWith({
      ...defaultPolicy,
      sandbox: "read-only",
    });
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith("s1", {
        ...defaultPolicy,
        sandbox: "read-only",
      });
    });
  });

  it("commits an approval-policy change", async () => {
    const commit = vi.fn(() => Promise.resolve());
    const onChange = vi.fn();
    render(
      <PolicyPill
        sessionId="s1"
        value={defaultPolicy}
        onChange={onChange}
        commit={commit}
      />,
    );
    fireEvent.click(screen.getByTestId("policy-pill-trigger"));
    fireEvent.click(screen.getByLabelText(/Never/));
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith("s1", {
        ...defaultPolicy,
        approval: "never",
      });
    });
  });

  it("reverts on commit failure", async () => {
    const commit = vi.fn(() => Promise.reject(new Error("backend down")));
    const onChange = vi.fn();
    render(
      <PolicyPill
        sessionId="s1"
        value={defaultPolicy}
        onChange={onChange}
        commit={commit}
      />,
    );
    fireEvent.click(screen.getByTestId("policy-pill-trigger"));
    fireEvent.click(screen.getByLabelText(/Read-only/));
    // Optimistic: read-only fires first.
    expect(onChange).toHaveBeenNthCalledWith(1, {
      ...defaultPolicy,
      sandbox: "read-only",
    });
    // Revert: original value fires second.
    await waitFor(() => {
      expect(onChange).toHaveBeenNthCalledWith(2, defaultPolicy);
    });
  });

  it("shows network-access status as read-only indicator", () => {
    const policyWithNet: CodexSessionPolicy = {
      ...defaultPolicy,
      network_access: true,
    };
    render(
      <PolicyPill
        sessionId="s1"
        value={policyWithNet}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("policy-pill-trigger"));
    expect(screen.getByText(/Allowed/)).toBeInTheDocument();
    expect(screen.getByText(/^on$/)).toBeInTheDocument();
  });

  it("network-access off renders the configuration hint", () => {
    render(
      <PolicyPill sessionId="s1" value={defaultPolicy} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("policy-pill-trigger"));
    expect(screen.getByText(/Disabled — edit/)).toBeInTheDocument();
    expect(screen.getByText(/^off$/)).toBeInTheDocument();
  });

  it("reflects all three sandbox options + selected state", () => {
    render(
      <PolicyPill sessionId="s1" value={defaultPolicy} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("policy-pill-trigger"));
    const readOnly = screen.getByLabelText(/Read-only/) as HTMLInputElement;
    const workspace = screen.getByLabelText(/Workspace-write/) as HTMLInputElement;
    const danger = screen.getByLabelText(/Danger: full access/) as HTMLInputElement;
    expect(readOnly.checked).toBe(false);
    expect(workspace.checked).toBe(true);
    expect(danger.checked).toBe(false);
  });
});
