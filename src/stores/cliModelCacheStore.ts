import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AgentId, CliModelInfo } from "../types/agent-events";

/**
 * Per-agent cache of the most recently seen `model/list` payload, populated
 * as a side-effect of any session emitting CapabilitiesDiscovered.
 *
 * Persisted across launches (localStorage): capabilities are LIVE data we
 * learned from a real session, and remembering them lets pre-spawn consumers
 * (the Duo setup modal's model + effort dropdowns, SpecWriter, Settings) offer
 * a previously-seen agent's models/effort levels immediately on the next
 * launch instead of going blank until that agent runs again. The live
 * `model/list` of any new session still overrides the cache, so it self-heals
 * across CLI upgrades — we never hardcode or invent values, only remember.
 *
 * Motivation: the chat ModelSelector reads `sessionStore.sessionCapabilities`
 * keyed by the *active session id*. That's the right scope for the chat
 * input — capabilities can drift per-session if the user switches CLIs or
 * the CLI is upgraded mid-run. But other consumers (SpecWriter's model
 * dropdown, Settings preview, future planners) need a model list *before*
 * they spawn any session of their own. This store gives them a "last
 * known good" view that any prior session in the run has already paid the
 * spawn cost to produce.
 *
 * Wired by `lib/event-handlers/chat.ts` `capabilities_discovered` case.
 * Cache-miss consumers should fall back to a static manifest (see
 * `lib/codex-models.ts::CODEX_FALLBACK_MODELS`), not block on a fresh
 * spawn — that defeats the point of having a cache at all.
 */
interface CliModelCacheState {
  /** Last-known model list per agent. */
  models: Partial<Record<AgentId, CliModelInfo[]>>;
  /** Wall-clock ms when each agent's cache was populated; useful for
   *  staleness UI ("last refreshed N minutes ago") if we ever add it. */
  populatedAt: Partial<Record<AgentId, number>>;

  /** Record a `model/list` payload. No-op if `models` is empty so a
   *  transport hiccup doesn't blow away a previously cached good list. */
  setModels: (agent: AgentId, models: CliModelInfo[]) => void;

  /** Look up cached models for an agent. Returns `undefined` if the
   *  cache has never been populated for this agent in the current run. */
  getModels: (agent: AgentId) => CliModelInfo[] | undefined;

  /** Drop cache for one agent, or all agents if no arg. Used by tests
   *  via `resetAllStores()`; production code shouldn't need this. */
  clear: (agent?: AgentId) => void;
}

export const useCliModelCacheStore = create<CliModelCacheState>()(
  persist(
    (set, get) => ({
  models: {},
  populatedAt: {},

  setModels: (agent, models) => {
    if (!models || models.length === 0) {
      // Refuse to overwrite a populated cache with an empty list. An empty
      // models[] can mean "transport failure, CLI didn't answer model/list"
      // — preserving the previous good list is strictly better UX than
      // silently emptying the dropdown.
      return;
    }
    set((state) => ({
      models: { ...state.models, [agent]: models },
      populatedAt: { ...state.populatedAt, [agent]: Date.now() },
    }));
  },

  getModels: (agent) => get().models[agent],

  clear: (agent) => {
    if (agent) {
      set((state) => {
        const models = { ...state.models };
        const populatedAt = { ...state.populatedAt };
        delete models[agent];
        delete populatedAt[agent];
        return { models, populatedAt };
      });
    } else {
      set({ models: {}, populatedAt: {} });
    }
  },
    }),
    {
      name: "cm-cli-model-cache",
      storage: createJSONStorage(() => localStorage),
      // Persist only the data; methods come from the initializer each load.
      partialize: (s) => ({ models: s.models, populatedAt: s.populatedAt }),
      version: 1,
    },
  ),
);
