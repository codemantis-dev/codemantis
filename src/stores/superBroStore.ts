import { create } from "zustand";
import type {
  SuperBroMessage,
  Observation,
} from "../types/super-bro";
import {
  saveObservation as saveObservationCmd,
  loadObservations as loadObservationsCmd,
  deleteObservation as deleteObservationCmd,
} from "../lib/tauri-commands";

export interface SuperBroLogEntry {
  timestamp: string;
  type: "trigger" | "api_call" | "response" | "all_good" | "error" | "skip";
  message: string;
}

interface SuperBroStoreState {
  // All per-project state (keyed by project path)
  enabledProjects: Map<string, boolean>;
  projectMessages: Map<string, SuperBroMessage | null>;
  projectThinking: Map<string, boolean>;
  projectCheckResult: Map<string, "all_good" | null>;
  projectObservations: Map<string, Observation[]>;

  // Global state
  isPaused: boolean;
  messageHistory: SuperBroMessage[];
  /** Rolling diagnostic log (last 50 entries) */
  log: SuperBroLogEntry[];

  // Actions (per-project)
  setMessage: (projectPath: string, message: SuperBroMessage) => void;
  dismissMessage: (projectPath: string) => void;
  setThinking: (projectPath: string, thinking: boolean) => void;
  setAllGood: (projectPath: string) => void;
  clearCheckResult: (projectPath: string) => void;
  toggle: (projectPath: string) => void;
  isEnabled: (projectPath: string) => boolean;

  // Global actions
  pause: () => void;
  resume: () => void;
  addLog: (type: SuperBroLogEntry["type"], message: string) => void;

  // Observation management
  addObservation: (projectPath: string, observation: Observation) => void;
  getObservations: (projectPath: string) => Observation[];
  loadObservations: (projectPath: string) => Promise<void>;
  removeObservation: (id: string, projectPath: string) => void;
}

const MAX_HISTORY = 20;
const MAX_OBSERVATIONS = 50;
const MAX_LOG = 50;

export const useSuperBroStore = create<SuperBroStoreState>((set, get) => ({
  enabledProjects: new Map(),
  projectMessages: new Map(),
  projectThinking: new Map(),
  projectCheckResult: new Map(),
  projectObservations: new Map(),
  isPaused: false,
  messageHistory: [],
  log: [],

  setMessage: (projectPath, message) =>
    set((state) => {
      const msgs = new Map(state.projectMessages);
      msgs.set(projectPath, message);
      const thinking = new Map(state.projectThinking);
      thinking.set(projectPath, false);
      const checks = new Map(state.projectCheckResult);
      checks.set(projectPath, null);
      const history = [message, ...state.messageHistory].slice(0, MAX_HISTORY);
      return { projectMessages: msgs, projectThinking: thinking, projectCheckResult: checks, messageHistory: history };
    }),

  dismissMessage: (projectPath) =>
    set((state) => {
      const msgs = new Map(state.projectMessages);
      if (msgs.get(projectPath)) {
        msgs.set(projectPath, null);
        return { projectMessages: msgs };
      }
      return {};
    }),

  setThinking: (projectPath, thinking) =>
    set((state) => {
      const t = new Map(state.projectThinking);
      t.set(projectPath, thinking);
      const checks = new Map(state.projectCheckResult);
      checks.set(projectPath, null);
      return { projectThinking: t, projectCheckResult: checks };
    }),

  setAllGood: (projectPath) =>
    set((state) => {
      const t = new Map(state.projectThinking);
      t.set(projectPath, false);
      const checks = new Map(state.projectCheckResult);
      checks.set(projectPath, "all_good");
      return { projectThinking: t, projectCheckResult: checks };
    }),

  clearCheckResult: (projectPath) =>
    set((state) => {
      const checks = new Map(state.projectCheckResult);
      checks.set(projectPath, null);
      return { projectCheckResult: checks };
    }),

  toggle: (projectPath) =>
    set((state) => {
      const enabled = new Map(state.enabledProjects);
      const current = enabled.get(projectPath) ?? true;
      enabled.set(projectPath, !current);
      return { enabledProjects: enabled };
    }),

  isEnabled: (projectPath) => {
    return get().enabledProjects.get(projectPath) ?? true;
  },

  pause: () => set({ isPaused: true }),
  resume: () => set({ isPaused: false }),

  addLog: (type, message) =>
    set((state) => ({
      log: [
        { timestamp: new Date().toISOString(), type, message },
        ...state.log,
      ].slice(0, MAX_LOG),
    })),

  addObservation: (projectPath, observation) => {
    set((state) => {
      const obs = new Map(state.projectObservations);
      const existing = obs.get(projectPath) ?? [];
      const updated = [observation, ...existing].slice(0, MAX_OBSERVATIONS);
      obs.set(projectPath, updated);
      return { projectObservations: obs };
    });

    saveObservationCmd(
      observation.id,
      projectPath,
      observation.text,
      observation.category,
      observation.createdAt,
      observation.lastReferencedAt,
    ).catch((e) => console.error("Failed to persist observation:", e));
  },

  getObservations: (projectPath) => {
    return get().projectObservations.get(projectPath) ?? [];
  },

  loadObservations: async (projectPath) => {
    try {
      const rows = await loadObservationsCmd(projectPath);
      const observations: Observation[] = rows.map((r) => ({
        id: r.id,
        text: r.text,
        category: r.category as Observation["category"],
        createdAt: r.createdAt,
        lastReferencedAt: r.lastReferencedAt,
      }));
      set((state) => {
        const obs = new Map(state.projectObservations);
        obs.set(projectPath, observations);
        return { projectObservations: obs };
      });
    } catch (e) {
      console.warn("[super-bro] Failed to load observations:", e);
    }
  },

  removeObservation: (id, projectPath) => {
    set((state) => {
      const obs = new Map(state.projectObservations);
      const existing = obs.get(projectPath) ?? [];
      obs.set(
        projectPath,
        existing.filter((o) => o.id !== id),
      );
      return { projectObservations: obs };
    });

    deleteObservationCmd(id).catch((e) =>
      console.error("Failed to delete observation:", e),
    );
  },
}));
