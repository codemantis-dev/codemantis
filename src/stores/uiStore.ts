import { create } from "zustand";

export type RightTab = "activity" | "terminal" | "files" | "changelog" | "assistant";

interface UiState {
  sidebarWidth: number;
  rightPanelWidth: number;
  rightTab: RightTab;
  showApprovalModal: boolean;
  showQuestionModal: boolean;
  showSettingsModal: boolean;
  showProjectPicker: boolean;
  showCliOverlay: boolean;
  claudeBinaryPath: string | null;
  showProjectLog: boolean;
  showClaudeHistory: boolean;
  draftInput: string | null;
  fileTreeRefreshTrigger: number;

  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setRightTab: (tab: RightTab) => void;
  setShowApprovalModal: (show: boolean) => void;
  setShowQuestionModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowProjectPicker: (show: boolean) => void;
  setShowCliOverlay: (show: boolean) => void;
  setClaudeBinaryPath: (path: string | null) => void;
  setShowProjectLog: (show: boolean) => void;
  setShowClaudeHistory: (show: boolean) => void;
  setDraftInput: (text: string | null) => void;
  triggerFileTreeRefresh: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 220,
  rightPanelWidth: 420,
  rightTab: "activity",
  showApprovalModal: false,
  showQuestionModal: false,
  showSettingsModal: false,
  showProjectPicker: false,
  showCliOverlay: false,
  claudeBinaryPath: null,
  showProjectLog: false,
  showClaudeHistory: false,
  draftInput: null,
  fileTreeRefreshTrigger: 0,

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.max(140, width) }),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.max(200, width) }),
  setRightTab: (tab) => set({ rightTab: tab }),
  setShowApprovalModal: (show) => set({ showApprovalModal: show }),
  setShowQuestionModal: (show) => set({ showQuestionModal: show }),
  setShowSettingsModal: (show) => set({ showSettingsModal: show }),
  setShowProjectPicker: (show) => set({ showProjectPicker: show }),
  setShowCliOverlay: (show) => set({ showCliOverlay: show }),
  setClaudeBinaryPath: (path) => set({ claudeBinaryPath: path }),
  setShowProjectLog: (show) => set({ showProjectLog: show, ...(show ? { showClaudeHistory: false } : {}) }),
  setShowClaudeHistory: (show) => set({ showClaudeHistory: show, ...(show ? { showProjectLog: false } : {}) }),
  setDraftInput: (text) => set({ draftInput: text }),
  triggerFileTreeRefresh: () => set((s) => ({ fileTreeRefreshTrigger: s.fileTreeRefreshTrigger + 1 })),
}));
