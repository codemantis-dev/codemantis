import { create } from "zustand";

export type RightTab = "activity" | "terminal" | "files";

interface UiState {
  sidebarWidth: number;
  rightPanelWidth: number;
  rightTab: RightTab;
  showApprovalModal: boolean;
  showSettingsModal: boolean;
  showProjectPicker: boolean;

  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setRightTab: (tab: RightTab) => void;
  setShowApprovalModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowProjectPicker: (show: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 220,
  rightPanelWidth: 360,
  rightTab: "activity",
  showApprovalModal: false,
  showSettingsModal: false,
  showProjectPicker: false,

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.max(180, Math.min(320, width)) }),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.max(280, Math.min(500, width)) }),
  setRightTab: (tab) => set({ rightTab: tab }),
  setShowApprovalModal: (show) => set({ showApprovalModal: show }),
  setShowSettingsModal: (show) => set({ showSettingsModal: show }),
  setShowProjectPicker: (show) => set({ showProjectPicker: show }),
}));
