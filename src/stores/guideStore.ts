import { create } from "zustand";
import type {
  ImplementationGuide,
  GuideSession,
} from "../types/implementation-guide";
import type { ParsedSessionPlan } from "../lib/parse-session-plan";
import {
  saveGuide as saveGuideCmd,
  loadGuide as loadGuideCmd,
  updateGuideData,
  deleteGuide as deleteGuideCmd,
} from "../lib/tauri-commands";

// ── Debounce helper ──────────────────────────────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 300;

function debouncedPersist(fn: () => Promise<void>): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    fn().catch((e) => console.warn("[guideStore] persist failed:", e));
  }, PERSIST_DEBOUNCE_MS);
}

// ── Store ────────────────────────────────────────────────────────────

interface GuideState {
  guide: ImplementationGuide | null;
  loading: boolean;

  loadGuideForProject: (projectPath: string) => Promise<void>;
  createGuide: (
    projectPath: string,
    specFilename: string,
    auditFilename: string | null,
    parsedPlan: ParsedSessionPlan,
  ) => Promise<boolean>;
  updateSessionStatus: (
    sessionIndex: number,
    status: "pending" | "active" | "done",
  ) => void;
  toggleVerifyCheck: (sessionIndex: number, checkId: string) => void;
  markPromptSent: (sessionIndex: number) => void;
  markVerifyRequested: (sessionIndex: number) => void;
  markSessionComplete: (sessionIndex: number) => boolean;
  unloadGuide: () => void;
  dismissGuide: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useGuideStore = create<GuideState>((set, get) => ({
  guide: null,
  loading: false,

  loadGuideForProject: async (projectPath: string) => {
    set({ loading: true });
    try {
      const payload = await loadGuideCmd(projectPath);
      if (payload) {
        const guide: ImplementationGuide = JSON.parse(payload.dataJson);
        // Ensure the persisted id is in sync
        guide.id = payload.id;
        set({ guide, loading: false });
      } else {
        set({ guide: null, loading: false });
      }
    } catch (e) {
      console.warn("[guideStore] Failed to load guide:", e);
      set({ guide: null, loading: false });
    }
  },

  createGuide: async (projectPath, specFilename, auditFilename, parsedPlan) => {
    // Replace any AI-hallucinated spec filename references with the actual filename
    const fixSpecReference = (prompt: string): string =>
      prompt.replace(/docs\/specs\/[\w-]+\.md/g, `docs/specs/${specFilename}`);

    const sessions: GuideSession[] = parsedPlan.sessions.map((s, i) => ({
      index: s.index,
      name: s.name,
      scope: s.scope,
      readSections: s.readSections,
      files: s.files,
      prompt: fixSpecReference(s.prompt),
      verifyChecks: s.verifyChecks.map((c, ci) => ({
        id: `verify-${s.index}-${ci}`,
        label: c.label,
        checked: false,
        kind: c.kind,
      })),
      verificationPrompt: s.verificationPrompt
        ? fixSpecReference(s.verificationPrompt)
        : null,
      crossSystemActions: s.crossSystemActions,
      status: i === 0 ? "active" : "pending",
      promptSent: false,
      verifyRequested: false,
    }));

    const guide: ImplementationGuide = {
      id: "", // will be set by backend
      projectPath,
      specFilename,
      auditFilename,
      title: parsedPlan.title,
      sessions,
      createdAt: new Date().toISOString(),
      status: "active",
    };

    try {
      const id = await saveGuideCmd(projectPath, JSON.stringify(guide));
      guide.id = id;
      set({ guide });
      return true;
    } catch (e) {
      console.warn("[guideStore] Failed to create guide:", e);
      return false;
    }
  },

  updateSessionStatus: (sessionIndex, status) => {
    const { guide } = get();
    if (!guide) return;

    const sessions = guide.sessions.map((s) =>
      s.index === sessionIndex ? { ...s, status } : s,
    );
    const updated = { ...guide, sessions };
    set({ guide: updated });
    debouncedPersist(() => get().persist());
  },

  markPromptSent: (sessionIndex) => {
    const { guide } = get();
    if (!guide) return;
    const sessions = guide.sessions.map((s) =>
      s.index === sessionIndex ? { ...s, promptSent: true } : s,
    );
    set({ guide: { ...guide, sessions } });
    debouncedPersist(() => get().persist());
  },

  markVerifyRequested: (sessionIndex) => {
    const { guide } = get();
    if (!guide) return;
    const sessions = guide.sessions.map((s) =>
      s.index === sessionIndex ? { ...s, verifyRequested: true } : s,
    );
    set({ guide: { ...guide, sessions } });
    debouncedPersist(() => get().persist());
  },

  toggleVerifyCheck: (sessionIndex, checkId) => {
    const { guide } = get();
    if (!guide) return;

    const sessions = guide.sessions.map((s) => {
      if (s.index !== sessionIndex) return s;
      const verifyChecks = s.verifyChecks.map((c) =>
        c.id === checkId ? { ...c, checked: !c.checked } : c,
      );
      return { ...s, verifyChecks };
    });
    const updated = { ...guide, sessions };
    set({ guide: updated });
    debouncedPersist(() => get().persist());
  },

  markSessionComplete: (sessionIndex) => {
    const { guide } = get();
    if (!guide) return false;

    const session = guide.sessions.find((s) => s.index === sessionIndex);
    if (!session) return false;

    // All verify checks must be checked (unless there are no checks)
    const allChecked =
      session.verifyChecks.length === 0 ||
      session.verifyChecks.every((c) => c.checked);
    if (!allChecked) return false;

    const sessions = guide.sessions.map((s) => {
      if (s.index === sessionIndex) return { ...s, status: "done" as const };
      // Activate the next pending session
      if (s.status === "pending" && s.index === sessionIndex + 1) {
        return { ...s, status: "active" as const };
      }
      return s;
    });

    const allDone = sessions.every((s) => s.status === "done");
    const updated: ImplementationGuide = {
      ...guide,
      sessions,
      status: allDone ? "completed" : "active",
    };
    set({ guide: updated });
    debouncedPersist(() => get().persist());
    return true;
  },

  unloadGuide: () => {
    set({ guide: null });
  },

  dismissGuide: async () => {
    const { guide } = get();
    if (!guide) return;
    try {
      await deleteGuideCmd(guide.id);
    } catch (e) {
      console.warn("[guideStore] Failed to delete guide:", e);
    }
    set({ guide: null });
  },

  persist: async () => {
    const { guide } = get();
    if (!guide || !guide.id) return;
    try {
      await updateGuideData(guide.id, JSON.stringify(guide));
    } catch (e) {
      console.warn("[guideStore] Failed to persist guide:", e);
    }
  },
}));
