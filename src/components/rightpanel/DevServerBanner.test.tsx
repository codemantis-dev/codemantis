import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DevServerBanner from "./DevServerBanner";
import { useSessionStore } from "../../stores/sessionStore";
import { useTerminalStore } from "../../stores/terminalStore";

// Mock openUrl
const mockOpenUrl = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

describe("DevServerBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no dev servers detected", () => {
    useSessionStore.setState({
      sessions: new Map([
        ["s1", { id: "s1", name: "Session 1", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 0 }],
      ]),
      activeProjectPath: "/tmp",
      tabOrder: ["s1"],
    });
    useTerminalStore.setState({
      sessionTerminals: new Map(),
      detectedDevServers: new Map(),
    });

    const { container } = render(<DevServerBanner currentSessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders detected dev servers from other sessions", () => {
    useSessionStore.setState({
      sessions: new Map([
        ["s1", { id: "s1", name: "Current", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 0 }],
        ["s2", { id: "s2", name: "Other Session", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 1 }],
      ]),
      activeProjectPath: "/tmp",
      tabOrder: ["s1", "s2"],
    });
    useTerminalStore.setState({
      sessionTerminals: new Map([
        ["s2", [{ id: "t1", sessionId: "s2", name: "term1", sortOrder: 0, createdAt: "", isRunning: true }]],
      ]),
      detectedDevServers: new Map([
        ["t1", [{ terminalId: "t1", sessionId: "s2", port: 3000, url: "http://localhost:3000" }]],
      ]),
    });

    render(<DevServerBanner currentSessionId="s1" />);
    expect(screen.getByText("Other Session")).toBeInTheDocument();
    expect(screen.getByText(":3000")).toBeInTheDocument();
  });

  it("opens URL when port button clicked", () => {
    useSessionStore.setState({
      sessions: new Map([
        ["s1", { id: "s1", name: "Current", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 0 }],
        ["s2", { id: "s2", name: "Other", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 1 }],
      ]),
      activeProjectPath: "/tmp",
      tabOrder: ["s1", "s2"],
    });
    useTerminalStore.setState({
      sessionTerminals: new Map([
        ["s2", [{ id: "t1", sessionId: "s2", name: "term1", sortOrder: 0, createdAt: "", isRunning: true }]],
      ]),
      detectedDevServers: new Map([
        ["t1", [{ terminalId: "t1", sessionId: "s2", port: 8080, url: "http://localhost:8080" }]],
      ]),
    });

    render(<DevServerBanner currentSessionId="s1" />);
    fireEvent.click(screen.getByText(":8080"));
    expect(mockOpenUrl).toHaveBeenCalledWith("http://localhost:8080");
  });

  it("does not show current session dev servers", () => {
    useSessionStore.setState({
      sessions: new Map([
        ["s1", { id: "s1", name: "Current", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 0 }],
      ]),
      activeProjectPath: "/tmp",
      tabOrder: ["s1"],
    });
    useTerminalStore.setState({
      sessionTerminals: new Map([
        ["s1", [{ id: "t1", sessionId: "s1", name: "term1", sortOrder: 0, createdAt: "", isRunning: true }]],
      ]),
      detectedDevServers: new Map([
        ["t1", [{ terminalId: "t1", sessionId: "s1", port: 3000, url: "http://localhost:3000" }]],
      ]),
    });

    const { container } = render(<DevServerBanner currentSessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });
});
