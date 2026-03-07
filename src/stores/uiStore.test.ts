import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    useUiStore.setState({
      sidebarWidth: 220,
      rightPanelWidth: 360,
      rightTab: "activity",
      showApprovalModal: false,
    });
  });

  it("has correct defaults", () => {
    const state = useUiStore.getState();
    expect(state.sidebarWidth).toBe(220);
    expect(state.rightPanelWidth).toBe(360);
    expect(state.rightTab).toBe("activity");
    expect(state.showApprovalModal).toBe(false);
  });

  it("setSidebarWidth clamps to min 180", () => {
    useUiStore.getState().setSidebarWidth(100);
    expect(useUiStore.getState().sidebarWidth).toBe(180);
  });

  it("setSidebarWidth clamps to max 320", () => {
    useUiStore.getState().setSidebarWidth(500);
    expect(useUiStore.getState().sidebarWidth).toBe(320);
  });

  it("setSidebarWidth accepts values in range", () => {
    useUiStore.getState().setSidebarWidth(250);
    expect(useUiStore.getState().sidebarWidth).toBe(250);
  });

  it("setRightPanelWidth clamps to min 280", () => {
    useUiStore.getState().setRightPanelWidth(100);
    expect(useUiStore.getState().rightPanelWidth).toBe(280);
  });

  it("setRightPanelWidth clamps to max 500", () => {
    useUiStore.getState().setRightPanelWidth(600);
    expect(useUiStore.getState().rightPanelWidth).toBe(500);
  });

  it("setRightPanelWidth accepts values in range", () => {
    useUiStore.getState().setRightPanelWidth(400);
    expect(useUiStore.getState().rightPanelWidth).toBe(400);
  });

  it("setShowApprovalModal toggles modal", () => {
    useUiStore.getState().setShowApprovalModal(true);
    expect(useUiStore.getState().showApprovalModal).toBe(true);

    useUiStore.getState().setShowApprovalModal(false);
    expect(useUiStore.getState().showApprovalModal).toBe(false);
  });
});
