import { create } from "zustand";
import { saveTaskBoardState, loadTaskBoardState, closeSpecwriterSession } from "../lib/tauri-commands";
import type {
  CompactionRunInfo,
  CoverageAuditReport,
  InputAnalysis,
  SpecConversation,
  SpecCreationEntry,
  SpecCreationLog,
  SpecMessage,
  SpecAttachment,
  SpecPatchOutcome,
  SpecPreviewTab,
  SpecWriterUIState,
  SpecDocumentInfo,
  StreamStats,
} from "../types/spec-writer";

/** Hard cap on persisted creation-log entries. Mirrors selfDriveStore's
 *  runLog cap so long runs don't bloat the persistence row. */
const CREATION_LOG_PERSIST_CAP = 100;

/** Shape persisted to the database (reuses existing task_plans table) */
interface PersistedSpecWriterState {
  conversation: SpecConversation | null;
  auditContent?: string | null;
  specContent?: string | null;
  draftText?: string | null;
  /** Persisted so the creation log survives app restart — gives the model
   *  programmatic memory of which sections were written even if the user
   *  closes/reopens the app between turns. */
  creationLog?: SpecCreationLog | null;
}

interface SpecWriterState {
  // Conversation (per project)
  conversations: Map<string, SpecConversation>;

  // UI state (per project)
  uiState: Map<string, SpecWriterUIState>;

  // Streaming state
  planningStreaming: Map<string, boolean>;

  // Current spec content being previewed (per project)
  currentSpecContent: Map<string, string>;

  // Saved specs list (per project, cached)
  savedSpecs: Map<string, SpecDocumentInfo[]>;

  // File request loading state (per project)
  fileRequestsPending: Map<string, boolean>;

  // Gathered project context for feature mode (per project)
  projectContext: Map<string, string>;

  // Current audit content being previewed (per project)
  currentAuditContent: Map<string, string>;

  // Draft input text (per project) — survives close/reopen + app restart
  draftText: Map<string, string>;

  // Draft attachments (per project) — survives close/reopen, NOT app restart
  draftAttachments: Map<string, SpecAttachment[]>;

  // Claude Code CLI session IDs for SpecWriter (per project, runtime-only)
  cliSessionIds: Map<string, string>;

  // Stage 3: Latest coverage-audit report per project (runtime-only).
  // Populated by useSpecConversation after each spec turn; read by CoveragePanel.
  coverageReports: Map<string, CoverageAuditReport>;

  // Outcome of the most recent AUDIT-PATCH splice per project (runtime-only).
  // Set whenever a recheck reply with the `<!-- AUDIT-PATCH -->` marker is
  // processed — whether the merge applied or was rejected fail-closed. Read by
  // the Coverage panel so the user can see — without scrolling chat — that
  // their "Patch spec & re-audit" click actually rewrote the spec.
  lastPatchOutcomes: Map<string, SpecPatchOutcome>;

  // Per-section streaming progress for the current run (persisted across
  // restarts via PersistedSpecWriterState.creationLog). Populated by the
  // heading detector in flushStreamBuffer in both spec-conversation hooks.
  // Used to (1) prepend a recap to the next non-recheck user turn after a
  // compaction event, giving the model programmatic memory of what it
  // already wrote, and (2) render the "Creation log" section in the
  // Coverage panel with a "RESUME HERE" pill on the open entry.
  creationLogs: Map<string, SpecCreationLog>;

  // Stage 3: Latest input-analyzer report per project (runtime-only).
  // Populated by useSpecConversation when input docs are first analyzed.
  inputAnalysisReports: Map<string, InputAnalysis>;

  // Stage 4: Stream stats for the most recent SpecWriter turn (runtime-only).
  // Populated on done/cancelled/errored/stalled so the Coverage panel can
  // surface silent truncation.
  streamStats: Map<string, StreamStats>;

  // Compaction tracking: whether the Claude Code CLI auto-compacted this
  // SpecWriter session during the current user-initiated run (runtime-only).
  // Set on compact_complete events; cleared at the start of each new user turn.
  compactionInfo: Map<string, CompactionRunInfo>;

  // Active preview tab per project (runtime-only). Lives in the store rather
  // than component state so it survives project switches without losing the
  // user's view (or stranding the user on a tab whose content has just been
  // swapped for a different project's content).
  specPreviewTab: Map<string, SpecPreviewTab>;

  // Whether a Verification Audit generation is in flight per project
  // (runtime-only). Becomes true the instant the user clicks Generate Audit
  // so the Verification… tab can render before any content has streamed in;
  // cleared on done/cancel/error.
  auditPending: Map<string, boolean>;

  // Actions - Conversation
  initConversation: (projectPath: string, provider: string, model: string, mode: SpecConversation['mode'], templateCatalog?: string) => void;
  addMessage: (projectPath: string, message: SpecMessage) => void;
  updateLastAssistantMessage: (projectPath: string, content: string) => void;
  setConversationStatus: (projectPath: string, status: SpecConversation['status']) => void;
  setPlanningStreaming: (projectPath: string, streaming: boolean) => void;
  setMessageOptions: (projectPath: string, options: string[]) => void;
  setMessageDisplayContent: (projectPath: string, displayContent: string) => void;
  updateConversationProvider: (projectPath: string, provider: string, model: string) => void;
  setContextLoaded: (projectPath: string, loaded: boolean) => void;
  setConversationMode: (projectPath: string, mode: SpecConversation['mode']) => void;
  clearConversation: (projectPath: string) => void;

  // Actions - File requests
  setFileRequestsPending: (projectPath: string, pending: boolean) => void;

  // Actions - Project context
  setProjectContext: (projectPath: string, context: string) => void;

  // Actions - Spec content
  setCurrentSpecContent: (projectPath: string, content: string | null) => void;

  // Actions - Manual spec promotion
  promoteMessageToSpec: (projectPath: string, messageId: string) => void;

  // Actions - Audit content
  setCurrentAuditContent: (projectPath: string, content: string | null) => void;

  // Actions - Saved specs
  setSavedSpecs: (projectPath: string, specs: SpecDocumentInfo[]) => void;

  // Actions - UI state
  toggleSlideOver: (projectPath: string) => void;
  setSlideOverOpen: (projectPath: string, open: boolean) => void;
  setChatWidth: (projectPath: string, width: number) => void;
  setSelectedSavedSpec: (projectPath: string, filename: string | null) => void;

  // Actions - Draft
  setDraftText: (projectPath: string, text: string) => void;
  setDraftAttachments: (projectPath: string, attachments: SpecAttachment[]) => void;
  clearDraft: (projectPath: string) => void;

  // Actions - CLI session
  setCliSessionId: (projectPath: string, sessionId: string | null) => void;
  getCliSessionId: (projectPath: string) => string | undefined;

  // Actions - Coverage audit (Stage 3)
  setCoverageReport: (projectPath: string, report: CoverageAuditReport | null) => void;
  setInputAnalysisReport: (projectPath: string, report: InputAnalysis | null) => void;

  // Actions - Patch outcome (post-AUDIT-PATCH splice)
  setLastPatchOutcome: (projectPath: string, outcome: SpecPatchOutcome | null) => void;

  // Actions - Creation log (heading-by-heading streaming progress)
  appendCreationEntry: (projectPath: string, entry: SpecCreationEntry) => void;
  /** Close the entry at index `idx` with a final `closedAt` + `bytes`. No-op
   *  if the index is out of range or the entry is already closed. */
  markCreationEntryClosed: (projectPath: string, idx: number, closedAt: string, bytes: number) => void;
  /** Stamp the log's `compactedAt` field — subsequent appendCreationEntry
   *  calls then carry `postCompaction: true`. */
  markPostCompactionFromNow: (projectPath: string, at: string) => void;
  /** Clear the entire log for this project (used on user-initiated turns). */
  clearCreationLog: (projectPath: string) => void;

  // Actions - Stream stats (Stage 4)
  setStreamStats: (projectPath: string, stats: StreamStats | null) => void;

  // Actions - Compaction tracking
  setCompactionInfo: (projectPath: string, info: CompactionRunInfo | null) => void;

  // Actions - Spec preview tab
  setSpecPreviewTab: (projectPath: string, tab: SpecPreviewTab) => void;

  // Actions - Audit pending
  setAuditPending: (projectPath: string, pending: boolean) => void;

  // Actions - Turn completion (batched update to avoid intermediate re-renders)
  completeTurn: (projectPath: string, updates: {
    finalContent: string;
    isSpec: boolean;
    isAudit: boolean;
    displayContent?: string;
    options?: string[];
    isReadyToWrite?: boolean;
  }) => void;

  // Actions - Lifecycle
  discardAndStartNew: (projectPath: string) => Promise<void>;

  // Persistence
  persistState: (projectPath: string) => void;
  loadState: (projectPath: string) => Promise<boolean>;

  // Helpers
  getActiveConversation: (projectPath: string) => SpecConversation | undefined;
  getUIState: (projectPath: string) => SpecWriterUIState;
}

const DEFAULT_UI_STATE: SpecWriterUIState = {
  is_open: false,
  chat_width: 40,
  current_spec_content: null,
  selected_saved_spec: null,
};

export const useSpecWriterStore = create<SpecWriterState>((set, get) => ({
  conversations: new Map(),
  uiState: new Map(),
  planningStreaming: new Map(),
  currentSpecContent: new Map(),
  currentAuditContent: new Map(),
  savedSpecs: new Map(),
  fileRequestsPending: new Map(),
  projectContext: new Map(),
  draftText: new Map(),
  draftAttachments: new Map(),
  cliSessionIds: new Map(),
  coverageReports: new Map(),
  lastPatchOutcomes: new Map(),
  creationLogs: new Map(),
  inputAnalysisReports: new Map(),
  streamStats: new Map(),
  compactionInfo: new Map(),
  specPreviewTab: new Map(),
  auditPending: new Map(),

  // Conversation
  initConversation: (projectPath, provider, model, mode, templateCatalog) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      conversations.set(projectPath, {
        id: `spec-${Date.now()}`,
        project_path: projectPath,
        messages: [],
        ai_provider: provider,
        ai_model: model,
        status: 'gathering',
        mode,
        context_loaded: false,
        templateCatalog,
      });
      return { conversations };
    }),

  addMessage: (projectPath, message) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, {
          ...conv,
          messages: [...conv.messages, message],
        });
      }
      return { conversations };
    }),

  updateLastAssistantMessage: (projectPath, content) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv && conv.messages.length > 0) {
        const messages = [...conv.messages];
        const lastIdx = messages.length - 1;
        if (messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = { ...messages[lastIdx], content };
        }
        conversations.set(projectPath, { ...conv, messages });
      }
      return { conversations };
    }),

  setConversationStatus: (projectPath, status) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, status });
      }
      return { conversations };
    }),

  setPlanningStreaming: (projectPath, streaming) =>
    set((state) => {
      const planningStreaming = new Map(state.planningStreaming);
      planningStreaming.set(projectPath, streaming);
      return { planningStreaming };
    }),

  setMessageOptions: (projectPath, options) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv && conv.messages.length > 0) {
        const messages = [...conv.messages];
        const lastIdx = messages.length - 1;
        if (messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = { ...messages[lastIdx], parsedOptions: options };
        }
        conversations.set(projectPath, { ...conv, messages });
      }
      return { conversations };
    }),

  setMessageDisplayContent: (projectPath, displayContent) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv && conv.messages.length > 0) {
        const messages = [...conv.messages];
        const lastIdx = messages.length - 1;
        if (messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = { ...messages[lastIdx], displayContent };
        }
        conversations.set(projectPath, { ...conv, messages });
      }
      return { conversations };
    }),

  updateConversationProvider: (projectPath, provider, model) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, ai_provider: provider, ai_model: model });
      }
      return { conversations };
    }),

  setContextLoaded: (projectPath, loaded) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, context_loaded: loaded });
      }
      return { conversations };
    }),

  setConversationMode: (projectPath, mode) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, mode });
      }
      return { conversations };
    }),

  clearConversation: (projectPath) => {
    const cliId = get().cliSessionIds.get(projectPath);
    if (cliId) {
      closeSpecwriterSession(cliId).catch(console.warn);
    }
    set((state) => {
      const conversations = new Map(state.conversations);
      const currentSpecContent = new Map(state.currentSpecContent);
      const currentAuditContent = new Map(state.currentAuditContent);
      const cliSessionIds = new Map(state.cliSessionIds);
      const draftText = new Map(state.draftText);
      const draftAttachments = new Map(state.draftAttachments);
      const coverageReports = new Map(state.coverageReports);
      const lastPatchOutcomes = new Map(state.lastPatchOutcomes);
      const creationLogs = new Map(state.creationLogs);
      const inputAnalysisReports = new Map(state.inputAnalysisReports);
      const streamStats = new Map(state.streamStats);
      const compactionInfo = new Map(state.compactionInfo);
      conversations.delete(projectPath);
      currentSpecContent.delete(projectPath);
      currentAuditContent.delete(projectPath);
      cliSessionIds.delete(projectPath);
      draftText.delete(projectPath);
      draftAttachments.delete(projectPath);
      coverageReports.delete(projectPath);
      lastPatchOutcomes.delete(projectPath);
      creationLogs.delete(projectPath);
      inputAnalysisReports.delete(projectPath);
      streamStats.delete(projectPath);
      compactionInfo.delete(projectPath);
      return { conversations, currentSpecContent, currentAuditContent, cliSessionIds, draftText, draftAttachments, coverageReports, lastPatchOutcomes, creationLogs, inputAnalysisReports, streamStats, compactionInfo };
    });
  },

  // File requests
  setFileRequestsPending: (projectPath, pending) =>
    set((state) => {
      const fileRequestsPending = new Map(state.fileRequestsPending);
      fileRequestsPending.set(projectPath, pending);
      return { fileRequestsPending };
    }),

  // Project context
  setProjectContext: (projectPath, context) =>
    set((state) => {
      const projectContext = new Map(state.projectContext);
      projectContext.set(projectPath, context);
      return { projectContext };
    }),

  // Spec content
  setCurrentSpecContent: (projectPath, content) =>
    set((state) => {
      const currentSpecContent = new Map(state.currentSpecContent);
      if (content === null) {
        currentSpecContent.delete(projectPath);
      } else {
        currentSpecContent.set(projectPath, content);
      }
      return { currentSpecContent };
    }),

  // Audit content
  setCurrentAuditContent: (projectPath, content) =>
    set((state) => {
      const currentAuditContent = new Map(state.currentAuditContent);
      if (content === null) {
        currentAuditContent.delete(projectPath);
      } else {
        currentAuditContent.set(projectPath, content);
      }
      return { currentAuditContent };
    }),

  // Manual spec promotion — atomically sets content, message type, status, and offers audit
  promoteMessageToSpec: (projectPath, messageId) => {
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (!conv) return {};

      const messages = [...conv.messages];
      const msgIdx = messages.findIndex((m) => m.id === messageId);
      if (msgIdx < 0 || messages[msgIdx].role !== 'assistant') return {};

      const content = messages[msgIdx].content;
      messages[msgIdx] = { ...messages[msgIdx], message_type: 'spec_document' as const };
      conversations.set(projectPath, { ...conv, messages, status: 'done' });

      const currentSpecContent = new Map(state.currentSpecContent);
      currentSpecContent.set(projectPath, content);

      return { conversations, currentSpecContent };
    });

    // Post-promotion: offer audit generation if none exists
    const state = get();
    const existingAudit = state.currentAuditContent.get(projectPath);
    if (!existingAudit) {
      state.addMessage(projectPath, {
        id: `msg-audit-offer-${Date.now()}`,
        role: "system",
        content: "Spec promoted! **Generate a Verification Audit?** This is a companion document that Claude Code uses to self-check its implementation \u2014 it opens every file, reads the actual code, and verifies it matches the spec.\n\nThis is the single most important step for implementation quality.",
        message_type: "conversation",
        timestamp: new Date().toISOString(),
        parsedOptions: [
          "\u{1F4CB} Yes, generate the Verification Audit",
          "Not now \u2014 I'll generate it later",
        ],
      });
    }
  },

  // Saved specs
  setSavedSpecs: (projectPath, specs) =>
    set((state) => {
      const savedSpecs = new Map(state.savedSpecs);
      savedSpecs.set(projectPath, specs);
      return { savedSpecs };
    }),

  // UI state
  toggleSlideOver: (projectPath) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, is_open: !current.is_open });
      return { uiState };
    }),

  setSlideOverOpen: (projectPath, open) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, is_open: open });
      return { uiState };
    }),

  setChatWidth: (projectPath, width) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, chat_width: width });
      return { uiState };
    }),

  setSelectedSavedSpec: (projectPath, filename) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, selected_saved_spec: filename });
      return { uiState };
    }),

  // Draft
  setDraftText: (projectPath, text) =>
    set((state) => {
      const draftText = new Map(state.draftText);
      if (text === "") {
        draftText.delete(projectPath);
      } else {
        draftText.set(projectPath, text);
      }
      return { draftText };
    }),

  setDraftAttachments: (projectPath, attachments) =>
    set((state) => {
      const draftAttachments = new Map(state.draftAttachments);
      if (attachments.length === 0) {
        draftAttachments.delete(projectPath);
      } else {
        draftAttachments.set(projectPath, attachments);
      }
      return { draftAttachments };
    }),

  clearDraft: (projectPath) =>
    set((state) => {
      const draftText = new Map(state.draftText);
      const draftAttachments = new Map(state.draftAttachments);
      draftText.delete(projectPath);
      draftAttachments.delete(projectPath);
      return { draftText, draftAttachments };
    }),

  // CLI session
  setCliSessionId: (projectPath, sessionId) =>
    set((state) => {
      const cliSessionIds = new Map(state.cliSessionIds);
      if (sessionId === null) {
        cliSessionIds.delete(projectPath);
      } else {
        cliSessionIds.set(projectPath, sessionId);
      }
      return { cliSessionIds };
    }),

  getCliSessionId: (projectPath) => get().cliSessionIds.get(projectPath),

  // Coverage audit (Stage 3)
  setCoverageReport: (projectPath, report) =>
    set((state) => {
      const coverageReports = new Map(state.coverageReports);
      if (report === null) {
        coverageReports.delete(projectPath);
      } else {
        coverageReports.set(projectPath, report);
      }
      return { coverageReports };
    }),

  setInputAnalysisReport: (projectPath, report) =>
    set((state) => {
      const inputAnalysisReports = new Map(state.inputAnalysisReports);
      if (report === null) {
        inputAnalysisReports.delete(projectPath);
      } else {
        inputAnalysisReports.set(projectPath, report);
      }
      return { inputAnalysisReports };
    }),

  setLastPatchOutcome: (projectPath, outcome) =>
    set((state) => {
      const lastPatchOutcomes = new Map(state.lastPatchOutcomes);
      if (outcome === null) {
        lastPatchOutcomes.delete(projectPath);
      } else {
        lastPatchOutcomes.set(projectPath, outcome);
      }
      return { lastPatchOutcomes };
    }),

  appendCreationEntry: (projectPath, entry) =>
    set((state) => {
      const creationLogs = new Map(state.creationLogs);
      const existing = creationLogs.get(projectPath) ?? {
        entries: [],
        compactedAt: null,
      };
      const nextEntries = [...existing.entries, entry];
      // Soft cap to keep the persisted payload bounded; drop the oldest
      // entries first (the "RESUME HERE" pointer is always the latest).
      const trimmed =
        nextEntries.length > CREATION_LOG_PERSIST_CAP
          ? nextEntries.slice(nextEntries.length - CREATION_LOG_PERSIST_CAP)
          : nextEntries;
      creationLogs.set(projectPath, {
        entries: trimmed,
        compactedAt: existing.compactedAt,
      });
      return { creationLogs };
    }),

  markCreationEntryClosed: (projectPath, idx, closedAt, bytes) =>
    set((state) => {
      const creationLogs = new Map(state.creationLogs);
      const existing = creationLogs.get(projectPath);
      if (!existing) return { creationLogs };
      if (idx < 0 || idx >= existing.entries.length) return { creationLogs };
      const target = existing.entries[idx];
      if (target.closedAt !== null) return { creationLogs };
      const nextEntries = [...existing.entries];
      nextEntries[idx] = { ...target, closedAt, bytes };
      creationLogs.set(projectPath, {
        entries: nextEntries,
        compactedAt: existing.compactedAt,
      });
      return { creationLogs };
    }),

  markPostCompactionFromNow: (projectPath, at) =>
    set((state) => {
      const creationLogs = new Map(state.creationLogs);
      const existing = creationLogs.get(projectPath) ?? {
        entries: [],
        compactedAt: null,
      };
      creationLogs.set(projectPath, {
        entries: existing.entries,
        compactedAt: at,
      });
      return { creationLogs };
    }),

  clearCreationLog: (projectPath) =>
    set((state) => {
      const creationLogs = new Map(state.creationLogs);
      creationLogs.delete(projectPath);
      return { creationLogs };
    }),

  // Stream stats (Stage 4)
  setStreamStats: (projectPath, stats) =>
    set((state) => {
      const streamStats = new Map(state.streamStats);
      if (stats === null) {
        streamStats.delete(projectPath);
      } else {
        streamStats.set(projectPath, stats);
      }
      return { streamStats };
    }),

  // Compaction tracking
  setCompactionInfo: (projectPath, info) =>
    set((state) => {
      const compactionInfo = new Map(state.compactionInfo);
      if (info === null) {
        compactionInfo.delete(projectPath);
      } else {
        compactionInfo.set(projectPath, info);
      }
      return { compactionInfo };
    }),

  // Spec preview tab — survives project switches because it's stored here
  // rather than in component state.
  setSpecPreviewTab: (projectPath, tab) =>
    set((state) => {
      const specPreviewTab = new Map(state.specPreviewTab);
      specPreviewTab.set(projectPath, tab);
      return { specPreviewTab };
    }),

  // Audit pending — true between Generate Audit click and stream terminal event.
  setAuditPending: (projectPath, pending) =>
    set((state) => {
      const auditPending = new Map(state.auditPending);
      if (pending) {
        auditPending.set(projectPath, true);
      } else {
        auditPending.delete(projectPath);
      }
      return { auditPending };
    }),

  // Turn completion — single batched update to avoid intermediate re-renders from useShallow
  completeTurn: (projectPath, updates) =>
    set((state) => {
      const planningStreaming = new Map(state.planningStreaming);
      planningStreaming.set(projectPath, false);

      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (!conv) return { planningStreaming };

      const messages = [...conv.messages];
      const lastIdx = messages.length - 1;

      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        let updated = { ...messages[lastIdx], content: updates.finalContent };
        if (updates.displayContent !== undefined) {
          updated = { ...updated, displayContent: updates.displayContent };
        }
        if (updates.options !== undefined) {
          updated = { ...updated, parsedOptions: updates.options };
        }
        if (updates.isSpec) {
          updated = { ...updated, message_type: 'spec_document' as const };
        }
        messages[lastIdx] = updated;
      }

      let status = conv.status;
      if (updates.isSpec) {
        status = 'done';
      } else if (updates.isReadyToWrite) {
        status = 'ready_to_write';
      }
      conversations.set(projectPath, { ...conv, messages, status });

      const currentSpecContent = new Map(state.currentSpecContent);
      if (updates.isSpec) {
        currentSpecContent.set(projectPath, updates.finalContent);
      }

      const currentAuditContent = new Map(state.currentAuditContent);
      if (updates.isAudit) {
        currentAuditContent.set(projectPath, updates.finalContent);
      }

      return { planningStreaming, conversations, currentSpecContent, currentAuditContent };
    }),

  // Lifecycle
  discardAndStartNew: async (projectPath) => {
    const cliId = get().cliSessionIds.get(projectPath);
    if (cliId) {
      await closeSpecwriterSession(cliId).catch(console.warn);
    }
    set((s) => {
      const conversations = new Map(s.conversations);
      const currentSpecContent = new Map(s.currentSpecContent);
      const currentAuditContent = new Map(s.currentAuditContent);
      const cliSessionIds = new Map(s.cliSessionIds);
      const draftText = new Map(s.draftText);
      const draftAttachments = new Map(s.draftAttachments);
      const coverageReports = new Map(s.coverageReports);
      const lastPatchOutcomes = new Map(s.lastPatchOutcomes);
      const inputAnalysisReports = new Map(s.inputAnalysisReports);
      const streamStats = new Map(s.streamStats);
      const compactionInfo = new Map(s.compactionInfo);
      conversations.delete(projectPath);
      currentSpecContent.delete(projectPath);
      currentAuditContent.delete(projectPath);
      cliSessionIds.delete(projectPath);
      draftText.delete(projectPath);
      draftAttachments.delete(projectPath);
      coverageReports.delete(projectPath);
      lastPatchOutcomes.delete(projectPath);
      inputAnalysisReports.delete(projectPath);
      streamStats.delete(projectPath);
      compactionInfo.delete(projectPath);
      return { conversations, currentSpecContent, currentAuditContent, cliSessionIds, draftText, draftAttachments, coverageReports, lastPatchOutcomes, inputAnalysisReports, streamStats, compactionInfo };
    });
  },

  // Persistence (reuses task_plans table via existing commands)
  persistState: (projectPath) => {
    const state = get();
    const conversation = state.conversations.get(projectPath) ?? null;
    if (!conversation) return;
    const auditContent = state.currentAuditContent.get(projectPath) ?? null;
    const specContent = state.currentSpecContent.get(projectPath) ?? null;
    const draftText = state.draftText.get(projectPath) ?? null;
    const creationLog = state.creationLogs.get(projectPath) ?? null;
    const persisted: PersistedSpecWriterState = {
      conversation,
      auditContent,
      specContent,
      draftText,
      creationLog,
    };
    saveTaskBoardState(projectPath, JSON.stringify(persisted)).catch((e) =>
      console.error("[specWriterStore] Failed to persist state:", e)
    );
  },

  loadState: async (projectPath) => {
    try {
      const json = await loadTaskBoardState(projectPath);
      if (!json) return false;
      const persisted = JSON.parse(json);
      const conversation = persisted.conversation ?? null;
      if (!conversation) return false;

      // Validate this is a SpecWriter conversation, not old TaskBoard data.
      // SpecWriter conversations have mode ('new_application'|'feature') and
      // status ('gathering'|'ready_to_write'|'writing'|'done').
      const validModes = ['new_application', 'feature'];
      const validStatuses = ['gathering', 'ready_to_write', 'writing', 'done'];
      if (!validModes.includes(conversation.mode) || !validStatuses.includes(conversation.status)) {
        console.warn("[specWriterStore] Discarding incompatible persisted state (old TaskBoard data)");
        return false;
      }

      // Determine spec content: prefer explicit field, fall back to extraction from messages
      let specContent: string | null = persisted.specContent ?? null;
      if (!specContent && conversation.messages) {
        for (let i = conversation.messages.length - 1; i >= 0; i--) {
          const msg = conversation.messages[i];
          if (msg.role === 'assistant' && msg.message_type === 'spec_document') {
            specContent = msg.content;
            break;
          }
        }
      }

      set((state) => {
        const conversations = new Map(state.conversations);
        conversations.set(projectPath, conversation);
        // Restore spec content if available
        const currentSpecContent = new Map(state.currentSpecContent);
        if (specContent) {
          currentSpecContent.set(projectPath, specContent);
        }
        // Restore audit content if persisted
        const currentAuditContent = new Map(state.currentAuditContent);
        if (persisted.auditContent) {
          currentAuditContent.set(projectPath, persisted.auditContent);
        }
        // Restore draft text if persisted
        const draftText = new Map(state.draftText);
        if (persisted.draftText) {
          draftText.set(projectPath, persisted.draftText);
        }
        // Restore creation log if persisted — gives the model programmatic
        // memory across app restarts. Older persisted payloads predate this
        // field; treat absent/null as "no log."
        const creationLogs = new Map(state.creationLogs);
        if (
          persisted.creationLog &&
          typeof persisted.creationLog === 'object' &&
          Array.isArray((persisted.creationLog as SpecCreationLog).entries)
        ) {
          creationLogs.set(projectPath, persisted.creationLog);
        }
        return { conversations, currentSpecContent, currentAuditContent, draftText, creationLogs };
      });
      return true;
    } catch (e) {
      console.error("[specWriterStore] Failed to load state:", e);
      return false;
    }
  },

  // Helpers
  getActiveConversation: (projectPath) => get().conversations.get(projectPath),
  getUIState: (projectPath) =>
    get().uiState.get(projectPath) ?? DEFAULT_UI_STATE,
}));
