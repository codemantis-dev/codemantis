import { create } from "zustand";
import type { OpenRouterModelResult } from "../lib/tauri-commands";
import { fetchOpenRouterModels } from "../lib/tauri-commands";
import type { OpenRouterModel } from "../types/assistant-provider";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface OpenRouterState {
  models: OpenRouterModel[];
  loading: boolean;
  lastFetched: number | null;
  error: string | null;

  fetchModels: (apiKey: string) => Promise<void>;
  getModel: (modelId: string) => OpenRouterModel | undefined;
  hasModel: (modelId: string) => boolean;
  getFreeModels: () => OpenRouterModel[];
  modelSupportsImages: (modelId: string) => boolean;
  modelSupportsFiles: (modelId: string) => boolean;
  modelSupportsAttachments: (modelId: string) => boolean;
  clearModels: () => void;
}

function toOpenRouterModel(r: OpenRouterModelResult): OpenRouterModel {
  return {
    id: r.id,
    name: r.name,
    isFree: r.isFree,
    inputModalities: r.inputModalities,
    outputModalities: r.outputModalities,
    contextLength: r.contextLength,
    pricing: { input: r.pricingInput, output: r.pricingOutput },
  };
}

export const useOpenRouterStore = create<OpenRouterState>((set, get) => ({
  models: [],
  loading: false,
  lastFetched: null,
  error: null,

  fetchModels: async (apiKey: string) => {
    const state = get();
    // Skip if recently fetched and models exist
    if (state.lastFetched && Date.now() - state.lastFetched < CACHE_TTL_MS && state.models.length > 0) {
      return;
    }
    if (state.loading) return;

    set({ loading: true, error: null });
    try {
      const results = await fetchOpenRouterModels(apiKey);
      const models = results.map(toOpenRouterModel);
      set({ models, loading: false, lastFetched: Date.now(), error: null });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  getModel: (modelId: string) => {
    return get().models.find((m) => m.id === modelId);
  },

  hasModel: (modelId: string) => {
    return get().models.some((m) => m.id === modelId);
  },

  getFreeModels: () => {
    return get().models.filter((m) => m.isFree);
  },

  modelSupportsImages: (modelId: string) => {
    const model = get().models.find((m) => m.id === modelId);
    if (!model) return true; // Unknown model — permissive default
    return model.inputModalities.includes("image");
  },

  modelSupportsFiles: (modelId: string) => {
    const model = get().models.find((m) => m.id === modelId);
    if (!model) return true;
    return model.inputModalities.includes("file");
  },

  modelSupportsAttachments: (modelId: string) => {
    const model = get().models.find((m) => m.id === modelId);
    if (!model) return true;
    return model.inputModalities.some((m) => m === "image" || m === "file");
  },

  clearModels: () => {
    set({ models: [], lastFetched: null, error: null });
  },
}));
