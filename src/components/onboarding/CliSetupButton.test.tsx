import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CliSetupButton from "./CliSetupButton";
import { installOrUpdateCli, listenCliSetupProgress } from "../../lib/tauri-commands";

vi.mock("../../lib/tauri-commands", () => ({
  installOrUpdateCli: vi.fn(),
  listenCliSetupProgress: vi.fn().mockResolvedValue(() => {}),
}));

describe("CliSetupButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listenCliSetupProgress).mockResolvedValue(() => {});
  });

  it("renders an Install label for the install kind", () => {
    render(<CliSetupButton agent="claude_code" kind="install" onDone={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Install Claude Code/ })
    ).toBeInTheDocument();
  });

  it("renders an Update label for the update kind", () => {
    render(<CliSetupButton agent="claude_code" kind="update" onDone={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Update Claude Code/ })
    ).toBeInTheDocument();
  });

  it("labels Codex correctly", () => {
    render(<CliSetupButton agent="codex" kind="install" onDone={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Install OpenAI Codex/ })
    ).toBeInTheDocument();
  });

  it("invokes install_or_update_cli and calls onDone on success", async () => {
    vi.mocked(installOrUpdateCli).mockResolvedValue({
      success: true,
      exitCode: 0,
      message: "Claude Code installed successfully. Re-checking…",
    });
    const onDone = vi.fn();
    render(<CliSetupButton agent="claude_code" kind="install" onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /Install Claude Code/ }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(installOrUpdateCli).toHaveBeenCalledWith("claude_code", undefined);
    expect(listenCliSetupProgress).toHaveBeenCalled();
  });

  it("forwards an explicit channel", async () => {
    vi.mocked(installOrUpdateCli).mockResolvedValue({
      success: true,
      exitCode: 0,
      message: "ok",
    });
    render(
      <CliSetupButton agent="claude_code" kind="update" onDone={vi.fn()} channel="stable" />
    );
    fireEvent.click(screen.getByRole("button", { name: /Update Claude Code/ }));
    await waitFor(() =>
      expect(installOrUpdateCli).toHaveBeenCalledWith("claude_code", "stable")
    );
  });

  it("shows an error and does NOT call onDone when the install fails", async () => {
    vi.mocked(installOrUpdateCli).mockResolvedValue({
      success: false,
      exitCode: 1,
      message: "Install failed (exit 1)",
    });
    const onDone = vi.fn();
    render(<CliSetupButton agent="claude_code" kind="install" onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /Install Claude Code/ }));

    await waitFor(() =>
      expect(
        screen.getByText(/Couldn't install Claude Code automatically/)
      ).toBeInTheDocument()
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it("surfaces a thrown error", async () => {
    vi.mocked(installOrUpdateCli).mockRejectedValue(new Error("boom"));
    const onDone = vi.fn();
    render(<CliSetupButton agent="claude_code" kind="install" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /Install Claude Code/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/Couldn't install Claude Code automatically/)
      ).toBeInTheDocument()
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it("hides npm behind the advanced disclosure, revealing it on toggle", () => {
    render(<CliSetupButton agent="claude_code" kind="update" onDone={vi.fn()} />);
    expect(
      screen.queryByText("npm install -g @anthropic-ai/claude-code@latest")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show details / advanced"));
    // The npm-free native installer is presented first, npm as the fallback.
    expect(
      screen.getByText("curl -fsSL https://claude.ai/install.sh | bash")
    ).toBeInTheDocument();
    expect(
      screen.getByText("npm install -g @anthropic-ai/claude-code@latest")
    ).toBeInTheDocument();
  });
});
