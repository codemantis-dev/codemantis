import { create } from "zustand";

interface ChatSearchState {
  isOpen: boolean;
  query: string;
  currentIndex: number;
  totalMatches: number;

  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  setTotalMatches: (total: number) => void;
  next: () => void;
  prev: () => void;
  reset: () => void;
}

const INITIAL_STATE = {
  isOpen: false,
  query: "",
  currentIndex: 0,
  totalMatches: 0,
};

export const useChatSearchStore = create<ChatSearchState>((set, get) => ({
  ...INITIAL_STATE,

  open: () => set({ isOpen: true }),

  close: () => set({ ...INITIAL_STATE }),

  setQuery: (query) => set({ query, currentIndex: 0 }),

  setTotalMatches: (total) => {
    const { currentIndex } = get();
    const clamped = total === 0 ? 0 : Math.min(currentIndex, total - 1);
    set({ totalMatches: total, currentIndex: clamped });
  },

  next: () => {
    const { totalMatches, currentIndex } = get();
    if (totalMatches === 0) return;
    set({ currentIndex: (currentIndex + 1) % totalMatches });
  },

  prev: () => {
    const { totalMatches, currentIndex } = get();
    if (totalMatches === 0) return;
    set({ currentIndex: (currentIndex - 1 + totalMatches) % totalMatches });
  },

  reset: () => set({ ...INITIAL_STATE }),
}));
