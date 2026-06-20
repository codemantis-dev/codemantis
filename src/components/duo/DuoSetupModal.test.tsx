import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DuoSetupModal from "./DuoSetupModal";
import { useDuoStore } from "../../stores/duoStore";
import { useCliModelCacheStore } from "../../stores/cliModelCacheStore";
import { resetAllStores } from "../../test/helpers/store-reset";

describe("DuoSetupModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAllStores();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <DuoSetupModal open={false} projectPath="/p" onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Start until a task is entered, then starts the run", () => {
    const start = vi.spyOn(useDuoStore.getState(), "start").mockResolvedValue();
    const onClose = vi.fn();
    render(<DuoSetupModal open projectPath="/proj" onClose={onClose} />);

    const startBtn = screen.getByText("Start run");
    expect(startBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Add a logout button" },
    });
    expect(startBtn).not.toBeDisabled();

    fireEvent.click(startBtn);
    expect(start).toHaveBeenCalledTimes(1);
    const arg = start.mock.calls[0][0];
    expect(arg.task).toBe("Add a logout button");
    expect(arg.projectPath).toBe("/proj");
    expect(arg.primary.agentId).toBe("codex");
    expect(arg.duo.agentId).toBe("claude_code");
    expect(onClose).toHaveBeenCalled();
  });

  it("threads a chosen model from the dropdown into the run config", () => {
    const start = vi.spyOn(useDuoStore.getState(), "start").mockResolvedValue();
    render(<DuoSetupModal open projectPath="/proj" onClose={() => {}} />);
    // Mentor defaults to claude_code; its fallback list offers "sonnet".
    fireEvent.change(screen.getByLabelText("Mentor model"), { target: { value: "sonnet" } });
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "do it" } });
    fireEvent.click(screen.getByText("Start run"));
    expect(start.mock.calls[0][0].duo.model).toBe("sonnet");
  });

  it("offers effort levels from the selected model's capabilities", () => {
    useCliModelCacheStore.getState().setModels("codex", [
      { value: "gpt-5.5", displayName: "GPT-5.5", description: "", isDefault: true, supportsEffort: true, supportedEffortLevels: ["low", "high"] },
    ]);
    render(<DuoSetupModal open projectPath="/proj" onClose={() => {}} />);
    const effort = screen.getByLabelText("Primary effort") as HTMLSelectElement;
    expect(effort.disabled).toBe(false);
    expect(screen.getByRole("option", { name: "high" })).toBeInTheDocument();
  });
});
