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

interface SuperBroStoreState {
  // Per-project enabled state (project path → enabled)
  enabledProjects: Map<string, boolean>;
  currentMessage: SuperBroMessage | null;
  isThinking: boolean;
  isPaused: boolean;
  // Per-project observations (project path → observations)
  projectObservations: Map<string, Observation[]>;
  messageHistory: SuperBroMessage[];

  // Actions
  setMessage: (message: SuperBroMessage) => void;
  dismissCurrentMessage: () => void;
  setThinking: (thinking: boolean) => void;
  pause: () => void;
  resume: () => void;
  toggle: (projectPath: string) => void;
  isEnabled: (projectPath: string) => boolean;

  // Observation management
  addObservation: (projectPath: string, observation: Observation) => void;
  getObservations: (projectPath: string) => Observation[];
  loadObservations: (projectPath: string) => Promise<void>;
  removeObservation: (id: string, projectPath: string) => void;
}

const MAX_HISTORY = 20;
const MAX_OBSERVATIONS = 50;

export const useSuperBroStore = create<SuperBroStoreState>((set, get) => ({
  enabledProjects: new Map(),
  currentMessage: null,
  isThinking: false,
  isPaused: false,
  projectObservations: new Map(),
  messageHistory: [],

  setMessage: (message) =>
    set((state) => {
      const history = [message, ...state.messageHistory].slice(0, MAX_HISTORY);
      return { currentMessage: message, messageHistory: history, isThinking: false };
    }),

  dismissCurrentMessage: () =>
    set((state) => {
      if (state.currentMessage) {
        return {
          currentMessage: null,
        };
      }
      return {};
    }),

  setThinking: (thinking) => set({ isThinking: thinking }),

  pause: () => set({ isPaused: true }),

  resume: () => set({ isPaused: false }),

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

  addObservation: (projectPath, observation) => {
    set((state) => {
      const obs = new Map(state.projectObservations);
      const existing = obs.get(projectPath) ?? [];
      const updated = [observation, ...existing].slice(0, MAX_OBSERVATIONS);
      obs.set(projectPath, updated);
      return { projectObservations: obs };
    });

    // Persist to SQLite
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
      console.error("Failed to load observations:", e);
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
