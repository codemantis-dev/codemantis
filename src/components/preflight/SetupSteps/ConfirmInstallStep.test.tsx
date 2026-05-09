import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConfirmInstallStep from "./ConfirmInstallStep";

describe("ConfirmInstallStep", () => {
  it("displays the full command line so the user knows what will run", () => {
    render(
      <ConfirmInstallStep
        command="npm"
        args={["install", "-g", "pnpm"]}
        installerLogs={[]}
        onConfirm={async () => {}}
        onSuccess={() => {}}
      />,
    );
    expect(screen.getByText("npm install -g pnpm")).toBeInTheDocument();
  });

  it("does not run anything until the button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmInstallStep
        command="npm"
        args={["install"]}
        installerLogs={[]}
        onConfirm={onConfirm}
        onSuccess={() => {}}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders streamed log lines", () => {
    render(
      <ConfirmInstallStep
        command="npm"
        args={["install"]}
        installerLogs={["[stdout] line one", "[stderr] warning"]}
        onConfirm={async () => {}}
        onSuccess={() => {}}
      />,
    );
    const log = screen.getByTestId("installer-log");
    expect(log.textContent).toContain("line one");
    expect(log.textContent).toContain("warning");
  });

  it("calls onConfirm when the user clicks Run install", async () => {
    const onConfirm = vi.fn(async () => {});
    render(
      <ConfirmInstallStep
        command="npm"
        args={["install"]}
        installerLogs={[]}
        onConfirm={onConfirm}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run install/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it("auto-advances after a brief Done state", async () => {
    const onSuccess = vi.fn();
    render(
      <ConfirmInstallStep
        command="x"
        args={[]}
        installerLogs={[]}
        onConfirm={async () => {}}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled(), { timeout: 1500 });
  });
});
