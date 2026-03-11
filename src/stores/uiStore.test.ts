import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    useUiStore.setState({
      sidebarWidth: 220,
      rightPanelWidth: 360,
      rightTab: "activity",
      showApprovalModal: false,
      showSettingsModal: false,
      showProjectPicker: false,
    });
  });

  it("has correct defaults", () => {
    const state = useUiStore.getState();
    expect(state.sidebarWidth).toBe(220);
    expect(state.rightPanelWidth).toBe(360);
    expect(state.rightTab).toBe("activity");
    expect(state.showApprovalModal).toBe(false);
    expect(state.showSettingsModal).toBe(false);
    expect(state.showProjectPicker).toBe(false);
  });

  it("setSidebarWidth clamps to min 140", () => {
    useUiStore.getState().setSidebarWidth(50);
    expect(useUiStore.getState().sidebarWidth).toBe(140);
  });

  it("setSidebarWidth has no upper limit", () => {
    useUiStore.getState().setSidebarWidth(800);
    expect(useUiStore.getState().sidebarWidth).toBe(800);
  });

  it("setSidebarWidth accepts values in range", () => {
    useUiStore.getState().setSidebarWidth(250);
    expect(useUiStore.getState().sidebarWidth).toBe(250);
  });

  it("setRightPanelWidth clamps to min 200", () => {
    useUiStore.getState().setRightPanelWidth(100);
    expect(useUiStore.getState().rightPanelWidth).toBe(200);
  });

  it("setRightPanelWidth has no upper limit", () => {
    useUiStore.getState().setRightPanelWidth(1200);
    expect(useUiStore.getState().rightPanelWidth).toBe(1200);
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

  it("setRightTab switches tab", () => {
    useUiStore.getState().setRightTab("terminal");
    expect(useUiStore.getState().rightTab).toBe("terminal");
    useUiStore.getState().setRightTab("activity");
    expect(useUiStore.getState().rightTab).toBe("activity");
  });

  it("setShowSettingsModal toggles settings", () => {
    useUiStore.getState().setShowSettingsModal(true);
    expect(useUiStore.getState().showSettingsModal).toBe(true);
  });

  it("setShowProjectPicker toggles picker", () => {
    useUiStore.getState().setShowProjectPicker(true);
    expect(useUiStore.getState().showProjectPicker).toBe(true);
  });

  it("showMcpModal defaults to false", () => {
    expect(useUiStore.getState().showMcpModal).toBe(false);
  });

  it("setShowMcpModal toggles MCP modal", () => {
    useUiStore.getState().setShowMcpModal(true);
    expect(useUiStore.getState().showMcpModal).toBe(true);
    useUiStore.getState().setShowMcpModal(false);
    expect(useUiStore.getState().showMcpModal).toBe(false);
  });

  it("projectPickerTab defaults to templates", () => {
    expect(useUiStore.getState().projectPickerTab).toBe("templates");
  });

  it("setProjectPickerTab changes the active tab", () => {
    useUiStore.getState().setProjectPickerTab("open");
    expect(useUiStore.getState().projectPickerTab).toBe("open");
    useUiStore.getState().setProjectPickerTab("recent");
    expect(useUiStore.getState().projectPickerTab).toBe("recent");
  });

  it("openProjectPicker sets both showProjectPicker and tab", () => {
    useUiStore.getState().openProjectPicker("templates");
    expect(useUiStore.getState().showProjectPicker).toBe(true);
    expect(useUiStore.getState().projectPickerTab).toBe("templates");
  });

  it("openProjectPicker can open on different tabs", () => {
    useUiStore.getState().openProjectPicker("open");
    expect(useUiStore.getState().showProjectPicker).toBe(true);
    expect(useUiStore.getState().projectPickerTab).toBe("open");

    useUiStore.getState().setShowProjectPicker(false);
    useUiStore.getState().openProjectPicker("recent");
    expect(useUiStore.getState().showProjectPicker).toBe(true);
    expect(useUiStore.getState().projectPickerTab).toBe("recent");
  });
});
