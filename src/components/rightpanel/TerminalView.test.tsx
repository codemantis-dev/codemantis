import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import TerminalView from "./TerminalView";

// Mock xterm and addons
const mockOpen = vi.fn();
const mockDispose = vi.fn();
const mockLoadAddon = vi.fn();
const mockOnData = vi.fn();
const mockWrite = vi.fn();
const mockFocus = vi.fn();

vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    open = mockOpen;
    dispose = mockDispose;
    loadAddon = mockLoadAddon;
    onData = mockOnData;
    write = mockWrite;
    focus = mockFocus;
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
  }
  return { Terminal: MockTerminal };
});

vi.mock("@xterm/addon-fit", () => {
  class MockFitAddon {
    fit = vi.fn();
  }
  return { FitAddon: MockFitAddon };
});

vi.mock("@xterm/addon-web-links", () => {
  class MockWebLinksAddon {
    constructor(_handler?: unknown) {
      // accept handler argument
    }
  }
  return { WebLinksAddon: MockWebLinksAddon };
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../../lib/tauri-commands", () => ({
  listenTerminalOutput: vi.fn().mockResolvedValue(() => {}),
  sendTerminalInput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../hooks/useTerminal", () => ({
  useTerminal: () => ({
    resizeTerminal: vi.fn(),
    createTerminal: vi.fn(),
    closeTerminal: vi.fn(),
  }),
}));

vi.mock("../../lib/editor-themes", () => ({
  getXtermTheme: () => ({
    background: "#1e1e1e",
    foreground: "#d4d4d4",
  }),
}));

// Provide a minimal import.meta.env
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

describe("TerminalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a container div", () => {
    const { container } = render(
      <TerminalView terminalId="t1" isVisible={true} />
    );
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });

  it("initializes xterm Terminal on mount", () => {
    render(<TerminalView terminalId="t1" isVisible={true} />);
    // Terminal constructor was called (open is called in the useEffect)
    expect(mockOpen).toHaveBeenCalled();
    expect(mockLoadAddon).toHaveBeenCalledTimes(2); // FitAddon + WebLinksAddon
  });

  it("hides container when isVisible is false", () => {
    const { container } = render(
      <TerminalView terminalId="t1" isVisible={false} />
    );
    expect((container.firstChild as HTMLElement).style.display).toBe("none");
  });

  it("shows container when isVisible is true", () => {
    const { container } = render(
      <TerminalView terminalId="t1" isVisible={true} />
    );
    expect((container.firstChild as HTMLElement).style.display).toBe("block");
  });

  it("disposes terminal on unmount", () => {
    const { unmount } = render(
      <TerminalView terminalId="t1" isVisible={true} />
    );
    unmount();
    expect(mockDispose).toHaveBeenCalled();
  });
});
