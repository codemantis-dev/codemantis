import { create } from "zustand";
import type { TerminalInstance, DevServerDetection } from "../types/terminal";

interface TerminalState {
  sessionTerminals: Map<string, TerminalInstance[]>;
  activeTerminalId: Map<string, string | null>;
  detectedDevServers: Map<string, DevServerDetection[]>;

  addTerminal: (sessionId: string, terminal: TerminalInstance) => void;
  removeTerminal: (sessionId: string, terminalId: string) => void;
  setActiveTerminal: (sessionId: string, terminalId: string | null) => void;
  getTerminals: (sessionId: string) => TerminalInstance[];
  getActiveTerminalId: (sessionId: string) => string | null;
  addDetectedDevServer: (detection: DevServerDetection) => void;
  removeDetectedDevServersForTerminal: (terminalId: string) => void;
  clearSession: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessionTerminals: new Map(),
  activeTerminalId: new Map(),
  detectedDevServers: new Map(),

  addTerminal: (sessionId, terminal) =>
    set((state) => {
      const sessionTerminals = new Map(state.sessionTerminals);
      const terminals = [...(sessionTerminals.get(sessionId) ?? []), terminal];
      sessionTerminals.set(sessionId, terminals);
      const activeTerminalId = new Map(state.activeTerminalId);
      activeTerminalId.set(sessionId, terminal.id);
      return { sessionTerminals, activeTerminalId };
    }),

  removeTerminal: (sessionId, terminalId) =>
    set((state) => {
      const sessionTerminals = new Map(state.sessionTerminals);
      const terminals = (sessionTerminals.get(sessionId) ?? []).filter(
        (t) => t.id !== terminalId
      );
      sessionTerminals.set(sessionId, terminals);

      const activeTerminalId = new Map(state.activeTerminalId);
      if (activeTerminalId.get(sessionId) === terminalId) {
        activeTerminalId.set(
          sessionId,
          terminals.length > 0 ? terminals[terminals.length - 1].id : null
        );
      }
      return { sessionTerminals, activeTerminalId };
    }),

  setActiveTerminal: (sessionId, terminalId) =>
    set((state) => {
      const activeTerminalId = new Map(state.activeTerminalId);
      activeTerminalId.set(sessionId, terminalId);
      return { activeTerminalId };
    }),

  getTerminals: (sessionId) =>
    get().sessionTerminals.get(sessionId) ?? [],

  getActiveTerminalId: (sessionId) =>
    get().activeTerminalId.get(sessionId) ?? null,

  addDetectedDevServer: (detection) =>
    set((state) => {
      const detectedDevServers = new Map(state.detectedDevServers);
      const existing = detectedDevServers.get(detection.terminalId) ?? [];
      // Deduplicate by port
      if (existing.some((d) => d.port === detection.port)) return state;
      detectedDevServers.set(detection.terminalId, [...existing, detection]);
      return { detectedDevServers };
    }),

  removeDetectedDevServersForTerminal: (terminalId) =>
    set((state) => {
      const detectedDevServers = new Map(state.detectedDevServers);
      detectedDevServers.delete(terminalId);
      return { detectedDevServers };
    }),

  clearSession: (sessionId) =>
    set((state) => {
      const sessionTerminals = new Map(state.sessionTerminals);
      // Clean up dev server entries for all terminals in this session
      const detectedDevServers = new Map(state.detectedDevServers);
      const terms = sessionTerminals.get(sessionId) ?? [];
      for (const t of terms) {
        detectedDevServers.delete(t.id);
      }
      sessionTerminals.delete(sessionId);
      const activeTerminalId = new Map(state.activeTerminalId);
      activeTerminalId.delete(sessionId);
      return { sessionTerminals, activeTerminalId, detectedDevServers };
    }),
}));
