import { create } from "zustand";
import type { TerminalInstance } from "../types/terminal";

interface TerminalState {
  sessionTerminals: Map<string, TerminalInstance[]>;
  activeTerminalId: Map<string, string | null>;

  addTerminal: (sessionId: string, terminal: TerminalInstance) => void;
  removeTerminal: (sessionId: string, terminalId: string) => void;
  setActiveTerminal: (sessionId: string, terminalId: string | null) => void;
  getTerminals: (sessionId: string) => TerminalInstance[];
  getActiveTerminalId: (sessionId: string) => string | null;
  clearSession: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessionTerminals: new Map(),
  activeTerminalId: new Map(),

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

  clearSession: (sessionId) =>
    set((state) => {
      const sessionTerminals = new Map(state.sessionTerminals);
      sessionTerminals.delete(sessionId);
      const activeTerminalId = new Map(state.activeTerminalId);
      activeTerminalId.delete(sessionId);
      return { sessionTerminals, activeTerminalId };
    }),
}));
