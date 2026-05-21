import { create } from "zustand";
import type { ActivityEntry } from "../types/activity";
import type { SettingsTab } from "../components/modals/settings/constants";
import { useSessionStore } from "./sessionStore";

export type RightTab = "activity" | "terminal" | "files" | "changelog" | "assistant" | "guide";
export type ProjectPickerTab = "templates" | "open" | "recent" | "clone" | "resume";
export type ActivityFeedScope = "session" | "project";

export interface ImagePreview {
  filePath: string;
  fileName: string;
  blobUrl: string;
  fileSize: number;
}

interface UiState {
  sidebarWidth: number;
  rightPanelWidth: number;
  rightPanelMinWidth: number;
  rightTab: RightTab;
  sessionRightTab: Map<string, RightTab>;
  showApprovalModal: boolean;
  showQuestionModal: boolean;
  showSettingsModal: boolean;
  showMcpModal: boolean;
  showProjectPicker: boolean;
  projectPickerTab: ProjectPickerTab;
  /**
   * Phase 2 §5: which agent the next "create session" call should target.
   * Persists for the lifetime of the UI store (not across launches) so a
   * user who picks Codex once doesn't have to re-pick on every session.
   */
  selectedAgentId: import("../types/agent-events").AgentId;
  /**
   * Phase 2 §6.1: per-Codex-session sandbox+approval policy, keyed by
   * session id. Missing entries default to the spec §2.3 "Auto" preset
   * (workspace-write × on-request). The backend is authoritative; this
   * is the optimistic UI mirror used by `PolicyPill`.
   */
  codexPolicies: Record<string, import("../lib/tauri-commands").CodexSessionPolicy>;
  showCliOverlay: boolean;
  cliOverlayInitialInput: string | null;
  cliOverlaySessionId: string | null;
  cliOverlayProjectPath: string | null;
  claudeBinaryPath: string | null;
  showProjectLog: boolean;
  showClaudeHistory: boolean;
  draftInput: string | null;
  selectedActivityEntry: ActivityEntry | null;
  fileTreeRefreshTrigger: number;
  pendingInputInsert: string | null;
  initialSettingsTab: SettingsTab | null;
  showPlanCompleteModal: boolean;
  planCompleteSessionId: string | null;
  planCompleteFilePath: string | null;
  planCompleteContent: string | null;
  /**
   * Persists across modal-close events so the user can reopen the Plan
   * Approval modal via the InputArea banner after dismissing it.
   * Cleared only by `clearPendingPlan` (implement / explicit dismiss).
   */
  pendingPlanSessionId: string | null;
  activityFeedScope: ActivityFeedScope;
  showReasoningPanel: boolean;
  imagePreview: ImagePreview | null;
  helpSessionId: string | null;
  helpPanelOpen: boolean;
  helpSessionReady: boolean;
  helpError: string | null;
  helpShowWelcome: boolean;
  showUpdateModal: boolean;
  updateVersion: string | null;
  updateNotes: string | null;
  updateAvailable: boolean;
  availableVersion: string | null;
  availableNotes: string | null;

  setSelectedActivityEntry: (entry: ActivityEntry | null) => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelMinWidth: (width: number) => void;
  setRightTab: (tab: RightTab) => void;
  restoreSessionRightTab: (outgoingId: string | null, incomingId: string | null) => void;
  setShowApprovalModal: (show: boolean) => void;
  setShowQuestionModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowMcpModal: (show: boolean) => void;
  setShowProjectPicker: (show: boolean) => void;
  setSelectedAgentId: (id: import("../types/agent-events").AgentId) => void;
  /** Local-only update; IPC commit happens via tauri-commands.setCodexPolicy. */
  updateCodexPolicyLocal: (
    sessionId: string,
    policy: import("../lib/tauri-commands").CodexSessionPolicy,
  ) => void;
  setProjectPickerTab: (tab: ProjectPickerTab) => void;
  openProjectPicker: (tab: ProjectPickerTab) => void;
  setShowCliOverlay: (show: boolean) => void;
  setCliOverlayInitialInput: (input: string | null) => void;
  setCliOverlaySessionId: (id: string | null) => void;
  setCliOverlayProjectPath: (path: string | null) => void;
  setClaudeBinaryPath: (path: string | null) => void;
  setShowProjectLog: (show: boolean) => void;
  setShowClaudeHistory: (show: boolean) => void;
  setDraftInput: (text: string | null) => void;
  triggerFileTreeRefresh: () => void;
  setPendingInputInsert: (text: string | null) => void;
  openSettingsToTab: (tab: SettingsTab) => void;
  setShowPlanCompleteModal: (show: boolean) => void;
  setPlanCompleteSessionId: (id: string | null) => void;
  setPlanCompleteFilePath: (path: string | null) => void;
  setPlanCompleteContent: (content: string | null) => void;
  setPendingPlanSessionId: (id: string | null) => void;
  /** Closes the modal AND clears all pending plan state. */
  clearPendingPlan: () => void;
  toggleActivityFeedScope: () => void;
  toggleReasoningPanel: () => void;
  setImagePreview: (preview: ImagePreview | null) => void;
  setHelpSessionId: (id: string | null) => void;
  setHelpPanelOpen: (open: boolean) => void;
  setHelpSessionReady: (ready: boolean) => void;
  setHelpError: (error: string | null) => void;
  toggleHelpPanel: () => void;
  setHelpShowWelcome: (show: boolean) => void;
  setUpdateAvailable: (version: string, notes: string | null) => void;
  clearUpdateAvailable: () => void;
  openUpdateModal: (version: string, notes: string | null) => void;
  closeUpdateModal: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 220,
  rightPanelWidth: 420,
  rightPanelMinWidth: 200,
  rightTab: "activity",
  sessionRightTab: new Map(),
  showApprovalModal: false,
  showQuestionModal: false,
  showSettingsModal: false,
  showMcpModal: false,
  showProjectPicker: false,
  selectedAgentId: "claude_code",
  codexPolicies: {},
  projectPickerTab: "templates",
  showCliOverlay: false,
  cliOverlayInitialInput: null,
  cliOverlaySessionId: null,
  cliOverlayProjectPath: null,
  claudeBinaryPath: null,
  showProjectLog: false,
  showClaudeHistory: false,
  draftInput: null,
  selectedActivityEntry: null,
  fileTreeRefreshTrigger: 0,
  pendingInputInsert: null,
  initialSettingsTab: null,
  showPlanCompleteModal: false,
  planCompleteSessionId: null,
  planCompleteFilePath: null,
  planCompleteContent: null,
  pendingPlanSessionId: null,
  activityFeedScope: "session",
  showReasoningPanel: false,
  imagePreview: null,
  helpSessionId: null,
  helpPanelOpen: false,
  helpSessionReady: false,
  helpError: null,
  helpShowWelcome: true,
  showUpdateModal: false,
  updateVersion: null,
  updateNotes: null,
  updateAvailable: false,
  availableVersion: null,
  availableNotes: null,

  setSelectedActivityEntry: (entry) => set({ selectedActivityEntry: entry }),
  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.max(140, width) }),
  setRightPanelWidth: (width) =>
    set((s) => ({ rightPanelWidth: Math.max(s.rightPanelMinWidth, width) })),
  setRightPanelMinWidth: (width) =>
    set((s) => ({
      rightPanelMinWidth: width,
      rightPanelWidth: Math.max(width, s.rightPanelWidth),
    })),
  setRightTab: (tab) =>
    set((s) => {
      const sessionRightTab = new Map(s.sessionRightTab);
      const activeSessionId = useSessionStore.getState().activeSessionId;
      if (activeSessionId) {
        sessionRightTab.set(activeSessionId, tab);
      }
      return { rightTab: tab, sessionRightTab };
    }),
  restoreSessionRightTab: (outgoingId, incomingId) =>
    set((s) => {
      const sessionRightTab = new Map(s.sessionRightTab);
      if (outgoingId) {
        sessionRightTab.set(outgoingId, s.rightTab);
      }
      const restored = incomingId
        ? sessionRightTab.get(incomingId) ?? s.rightTab
        : s.rightTab;
      return { rightTab: restored, sessionRightTab };
    }),
  setShowApprovalModal: (show) => set({ showApprovalModal: show }),
  setShowQuestionModal: (show) => set({ showQuestionModal: show }),
  setShowSettingsModal: (show) => set({ showSettingsModal: show }),
  setShowMcpModal: (show) => set({ showMcpModal: show }),
  setShowProjectPicker: (show) => set({ showProjectPicker: show }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  updateCodexPolicyLocal: (sessionId, policy) =>
    set((state) => ({
      codexPolicies: { ...state.codexPolicies, [sessionId]: policy },
    })),
  setProjectPickerTab: (tab) => set({ projectPickerTab: tab }),
  openProjectPicker: (tab) => set({ showProjectPicker: true, projectPickerTab: tab }),
  setShowCliOverlay: (show) => set({ showCliOverlay: show, ...(!show ? { cliOverlaySessionId: null, cliOverlayProjectPath: null } : {}) }),
  setCliOverlayInitialInput: (input) => set({ cliOverlayInitialInput: input }),
  setCliOverlaySessionId: (id) => set({ cliOverlaySessionId: id }),
  setCliOverlayProjectPath: (path) => set({ cliOverlayProjectPath: path }),
  setClaudeBinaryPath: (path) => set({ claudeBinaryPath: path }),
  setShowProjectLog: (show) => set({ showProjectLog: show, ...(show ? { showClaudeHistory: false } : {}) }),
  setShowClaudeHistory: (show) => set({ showClaudeHistory: show, ...(show ? { showProjectLog: false } : {}) }),
  setDraftInput: (text) => set({ draftInput: text }),
  triggerFileTreeRefresh: () => set((s) => ({ fileTreeRefreshTrigger: s.fileTreeRefreshTrigger + 1 })),
  setPendingInputInsert: (text) => set({ pendingInputInsert: text }),
  openSettingsToTab: (tab) => set({ showSettingsModal: true, initialSettingsTab: tab }),
  // Toggle visibility only — pending state (sessionId/filePath/content) is
  // preserved so the InputArea banner can reopen the modal with the same
  // plan. Use `clearPendingPlan` to discard the plan entirely.
  setShowPlanCompleteModal: (show) => set({ showPlanCompleteModal: show }),
  setPlanCompleteSessionId: (id) => set({ planCompleteSessionId: id }),
  setPlanCompleteFilePath: (path) => set({ planCompleteFilePath: path }),
  setPlanCompleteContent: (content) => set({ planCompleteContent: content }),
  setPendingPlanSessionId: (id) => set({ pendingPlanSessionId: id }),
  clearPendingPlan: () =>
    set({
      showPlanCompleteModal: false,
      planCompleteSessionId: null,
      planCompleteFilePath: null,
      planCompleteContent: null,
      pendingPlanSessionId: null,
    }),
  toggleActivityFeedScope: () => set((s) => ({ activityFeedScope: s.activityFeedScope === "session" ? "project" : "session" })),
  toggleReasoningPanel: () => set((s) => ({ showReasoningPanel: !s.showReasoningPanel })),
  setImagePreview: (preview) => set((s) => {
    // Revoke previous blob URL to avoid memory leaks
    if (s.imagePreview?.blobUrl) URL.revokeObjectURL(s.imagePreview.blobUrl);
    return { imagePreview: preview };
  }),
  setHelpSessionId: (id) => set({ helpSessionId: id }),
  setHelpPanelOpen: (open) => set({ helpPanelOpen: open }),
  setHelpSessionReady: (ready) => set({ helpSessionReady: ready }),
  setHelpError: (error) => set({ helpError: error }),
  toggleHelpPanel: () => set((s) => ({ helpPanelOpen: !s.helpPanelOpen })),
  setHelpShowWelcome: (show) => set({ helpShowWelcome: show }),
  setUpdateAvailable: (version, notes) => set({ updateAvailable: true, availableVersion: version, availableNotes: notes }),
  clearUpdateAvailable: () => set({ updateAvailable: false, availableVersion: null, availableNotes: null }),
  openUpdateModal: (version, notes) => set({ showUpdateModal: true, updateVersion: version, updateNotes: notes }),
  closeUpdateModal: () => set({ showUpdateModal: false }),
}));
