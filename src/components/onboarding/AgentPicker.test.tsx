import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import AgentPicker from "./AgentPicker";

vi.mock("../../lib/tauri-commands", () => ({
  checkClaudeStatus: vi.fn(() => Promise.resolve({ installed: true })),
}));

describe("AgentPicker", () => {
  it("collapses to a static label when only one binary is installed", () => {
    render(
      <AgentPicker
        value="claude_code"
        onChange={vi.fn()}
        installed={{ claude_code: true, codex: false }}
      />,
    );
    expect(screen.getByTestId("agent-picker-collapsed")).toBeInTheDocument();
    expect(screen.getByText(/Claude Code/i)).toBeInTheDocument();
    expect(screen.getByText(/Add OpenAI Codex/i)).toBeInTheDocument();
  });

  it("shows a radio group when both agents are installed", () => {
    render(
      <AgentPicker
        value="claude_code"
        onChange={vi.fn()}
        installed={{ claude_code: true, codex: true }}
      />,
    );
    expect(screen.getByTestId("agent-picker")).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
  });

  it("renders nothing when no agent is installed (welcome handles install)", () => {
    const { container } = render(
      <AgentPicker
        value="claude_code"
        onChange={vi.fn()}
        installed={{ claude_code: false, codex: false }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("respects `hidden` prop regardless of install status", () => {
    const { container } = render(
      <AgentPicker
        value="claude_code"
        onChange={vi.fn()}
        installed={{ claude_code: true, codex: true }}
        hidden
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("fires onChange with the selected agent id", () => {
    const onChange = vi.fn();
    render(
      <AgentPicker
        value="claude_code"
        onChange={onChange}
        installed={{ claude_code: true, codex: true }}
      />,
    );
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[1]); // Codex
    expect(onChange).toHaveBeenCalledWith("codex");
  });

  it("highlights the active agent with accent styling", () => {
    render(
      <AgentPicker
        value="codex"
        onChange={vi.fn()}
        installed={{ claude_code: true, codex: true }}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).toBeChecked();
  });

  it("collapsed mode shows Codex when Claude is missing", () => {
    render(
      <AgentPicker
        value="codex"
        onChange={vi.fn()}
        installed={{ claude_code: false, codex: true }}
      />,
    );
    expect(screen.getByTestId("agent-picker-collapsed")).toBeInTheDocument();
    expect(screen.getByText(/OpenAI Codex/i)).toBeInTheDocument();
    expect(screen.getByText(/Add Claude Code/i)).toBeInTheDocument();
  });
});
