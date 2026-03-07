import { create } from "zustand";

interface UiState {
  sidebarWidth: number;
  rightPanelWidth: number;
  rightTab: "activity";
  showApprovalModal: boolean;

  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setShowApprovalModal: (show: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 220,
  rightPanelWidth: 360,
  rightTab: "activity",
  showApprovalModal: false,

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.max(180, Math.min(320, width)) }),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.max(280, Math.min(500, width)) }),
  setShowApprovalModal: (show) => set({ showApprovalModal: show }),
}));
