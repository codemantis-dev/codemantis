import { create } from "zustand";
import type { ActivityEntry } from "../types/activity";
import type { SettingsTab } from "../components/modals/settings/constants";

export type RightTab = "activity" | "terminal" | "files" | "changelog" | "assistant";
export type ProjectPickerTab = "templates" | "open" | "recent";
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
  showApprovalModal: boolean;
  showQuestionModal: boolean;
  showSettingsModal: boolean;
  showMcpModal: boolean;
  showProjectPicker: boolean;
  projectPickerTab: ProjectPickerTab;
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
  activityFeedScope: ActivityFeedScope;
  imagePreview: ImagePreview | null;
  helpSessionId: string | null;
  helpPanelOpen: boolean;
  helpSessionReady: boolean;
  helpError: string | null;
  helpShowWelcome: boolean;

  setSelectedActivityEntry: (entry: ActivityEntry | null) => void;
  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelMinWidth: (width: number) => void;
  setRightTab: (tab: RightTab) => void;
  setShowApprovalModal: (show: boolean) => void;
  setShowQuestionModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowMcpModal: (show: boolean) => void;
  setShowProjectPicker: (show: boolean) => void;
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
  toggleActivityFeedScope: () => void;
  setImagePreview: (preview: ImagePreview | null) => void;
  setHelpSessionId: (id: string | null) => void;
  setHelpPanelOpen: (open: boolean) => void;
  setHelpSessionReady: (ready: boolean) => void;
  setHelpError: (error: string | null) => void;
  toggleHelpPanel: () => void;
  setHelpShowWelcome: (show: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 220,
  rightPanelWidth: 420,
  rightPanelMinWidth: 200,
  rightTab: "activity",
  showApprovalModal: false,
  showQuestionModal: false,
  showSettingsModal: false,
  showMcpModal: false,
  showProjectPicker: false,
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
  activityFeedScope: "session",
  imagePreview: null,
  helpSessionId: null,
  helpPanelOpen: false,
  helpSessionReady: false,
  helpError: null,
  helpShowWelcome: true,

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
  setRightTab: (tab) => set({ rightTab: tab }),
  setShowApprovalModal: (show) => set({ showApprovalModal: show }),
  setShowQuestionModal: (show) => set({ showQuestionModal: show }),
  setShowSettingsModal: (show) => set({ showSettingsModal: show }),
  setShowMcpModal: (show) => set({ showMcpModal: show }),
  setShowProjectPicker: (show) => set({ showProjectPicker: show }),
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
  setShowPlanCompleteModal: (show) => set({ showPlanCompleteModal: show, ...(!show ? { planCompleteSessionId: null } : {}) }),
  setPlanCompleteSessionId: (id) => set({ planCompleteSessionId: id }),
  toggleActivityFeedScope: () => set((s) => ({ activityFeedScope: s.activityFeedScope === "session" ? "project" : "session" })),
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
}));
