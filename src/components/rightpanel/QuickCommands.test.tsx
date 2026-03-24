import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickCommands from "./QuickCommands";
import { useSettingsStore } from "../../stores/settingsStore";

// Mock tauri-commands
const mockSendTerminalInput = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/tauri-commands", () => ({
  sendTerminalInput: (...args: unknown[]) => mockSendTerminalInput(...args),
}));

describe("QuickCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when terminalId is null", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        quickCommands: [{ label: "Build", command: "npm run build" }],
      },
    });
    const { container } = render(<QuickCommands terminalId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when quickCommands is empty", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        quickCommands: [],
      },
    });
    const { container } = render(<QuickCommands terminalId="t1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders quick command buttons", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        quickCommands: [
          { label: "Build", command: "npm run build" },
          { label: "Test", command: "npm test" },
        ],
      },
    });
    render(<QuickCommands terminalId="t1" />);
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("sends command with carriage return when button clicked", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        quickCommands: [{ label: "Build", command: "npm run build" }],
      },
    });
    render(<QuickCommands terminalId="t1" />);
    fireEvent.click(screen.getByText("Build"));
    expect(mockSendTerminalInput).toHaveBeenCalledWith("t1", "npm run build\r");
  });

  it("shows command as title attribute", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        quickCommands: [{ label: "Lint", command: "pnpm lint" }],
      },
    });
    render(<QuickCommands terminalId="t1" />);
    expect(screen.getByTitle("pnpm lint")).toBeInTheDocument();
  });
});
