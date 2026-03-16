import { describe, it, expect, beforeEach } from "vitest";
import { useTerminalStore } from "./terminalStore";
import type { TerminalInstance, DevServerDetection } from "../types/terminal";

const SESSION_ID = "session-1";

function makeTerminal(id: string, sessionId: string = SESSION_ID): TerminalInstance {
  return {
    id,
    sessionId,
    name: `Terminal ${id}`,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    isRunning: true,
  };
}

function makeDetection(terminalId: string, port: number): DevServerDetection {
  return {
    terminalId,
    sessionId: SESSION_ID,
    port,
    url: `http://localhost:${port}`,
  };
}

function resetStore(): void {
  useTerminalStore.setState({
    sessionTerminals: new Map(),
    activeTerminalId: new Map(),
    detectedDevServers: new Map(),
  });
}

describe("terminalStore", () => {
  beforeEach(resetStore);

  it("starts with empty maps", () => {
    const state = useTerminalStore.getState();
    expect(state.sessionTerminals.size).toBe(0);
    expect(state.activeTerminalId.size).toBe(0);
    expect(state.detectedDevServers.size).toBe(0);
  });

  it("addTerminal adds terminal and sets it active", () => {
    const terminal = makeTerminal("t1");
    useTerminalStore.getState().addTerminal(SESSION_ID, terminal);

    const state = useTerminalStore.getState();
    expect(state.sessionTerminals.get(SESSION_ID)).toEqual([terminal]);
    expect(state.activeTerminalId.get(SESSION_ID)).toBe("t1");
  });

  it("addTerminal to same session appends", () => {
    const t1 = makeTerminal("t1");
    const t2 = makeTerminal("t2");
    useTerminalStore.getState().addTerminal(SESSION_ID, t1);
    useTerminalStore.getState().addTerminal(SESSION_ID, t2);

    const terminals = useTerminalStore.getState().sessionTerminals.get(SESSION_ID);
    expect(terminals).toHaveLength(2);
    // Latest addTerminal sets active
    expect(useTerminalStore.getState().activeTerminalId.get(SESSION_ID)).toBe("t2");
  });

  it("removeTerminal removes and selects last remaining", () => {
    const t1 = makeTerminal("t1");
    const t2 = makeTerminal("t2");
    useTerminalStore.getState().addTerminal(SESSION_ID, t1);
    useTerminalStore.getState().addTerminal(SESSION_ID, t2);

    useTerminalStore.getState().removeTerminal(SESSION_ID, "t2");

    const terminals = useTerminalStore.getState().sessionTerminals.get(SESSION_ID);
    expect(terminals).toHaveLength(1);
    expect(terminals![0].id).toBe("t1");
    expect(useTerminalStore.getState().activeTerminalId.get(SESSION_ID)).toBe("t1");
  });

  it("removeTerminal from empty session is safe", () => {
    expect(() =>
      useTerminalStore.getState().removeTerminal(SESSION_ID, "nonexistent"),
    ).not.toThrow();
  });

  it("setActiveTerminal updates active terminal", () => {
    const t1 = makeTerminal("t1");
    const t2 = makeTerminal("t2");
    useTerminalStore.getState().addTerminal(SESSION_ID, t1);
    useTerminalStore.getState().addTerminal(SESSION_ID, t2);

    useTerminalStore.getState().setActiveTerminal(SESSION_ID, "t1");
    expect(useTerminalStore.getState().activeTerminalId.get(SESSION_ID)).toBe("t1");
  });

  it("getTerminals returns [] for unknown session", () => {
    expect(useTerminalStore.getState().getTerminals("unknown")).toEqual([]);
  });

  it("addDetectedDevServer adds detection, deduplicates by port", () => {
    const detection1 = makeDetection("t1", 3000);
    const detection2 = makeDetection("t1", 3000); // duplicate port
    const detection3 = makeDetection("t1", 5173); // different port

    useTerminalStore.getState().addDetectedDevServer(detection1);
    useTerminalStore.getState().addDetectedDevServer(detection2);
    useTerminalStore.getState().addDetectedDevServer(detection3);

    const servers = useTerminalStore.getState().detectedDevServers.get("t1");
    expect(servers).toHaveLength(2);
    expect(servers!.map((s) => s.port)).toEqual([3000, 5173]);
  });

  it("removeDetectedDevServersForTerminal cleans up", () => {
    useTerminalStore.getState().addDetectedDevServer(makeDetection("t1", 3000));
    useTerminalStore.getState().addDetectedDevServer(makeDetection("t2", 5173));

    useTerminalStore.getState().removeDetectedDevServersForTerminal("t1");

    expect(useTerminalStore.getState().detectedDevServers.has("t1")).toBe(false);
    expect(useTerminalStore.getState().detectedDevServers.has("t2")).toBe(true);
  });

  it("clearSession removes terminals, active, and dev server detections", () => {
    const t1 = makeTerminal("t1");
    useTerminalStore.getState().addTerminal(SESSION_ID, t1);
    useTerminalStore.getState().addDetectedDevServer(makeDetection("t1", 3000));

    useTerminalStore.getState().clearSession(SESSION_ID);

    const state = useTerminalStore.getState();
    expect(state.sessionTerminals.has(SESSION_ID)).toBe(false);
    expect(state.activeTerminalId.has(SESSION_ID)).toBe(false);
    expect(state.detectedDevServers.has("t1")).toBe(false);
  });
});
