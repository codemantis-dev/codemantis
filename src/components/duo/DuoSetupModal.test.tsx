import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DuoSetupModal from "./DuoSetupModal";
import { useDuoStore } from "../../stores/duoStore";
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

  it("threads chosen models into the run config", () => {
    const start = vi.spyOn(useDuoStore.getState(), "start").mockResolvedValue();
    render(<DuoSetupModal open projectPath="/proj" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Mentor model"), { target: { value: "claude-opus-4-8" } });
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "do it" } });
    fireEvent.click(screen.getByText("Start run"));
    expect(start.mock.calls[0][0].duo.model).toBe("claude-opus-4-8");
  });
});
