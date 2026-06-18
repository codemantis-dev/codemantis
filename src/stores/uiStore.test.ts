import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./uiStore";
import { useSessionStore } from "./sessionStore";

describe("uiStore", () => {
  beforeEach(() => {
    useUiStore.setState({
      sidebarWidth: 220,
      rightPanelWidth: 360,
      rightTab: "activity",
      sessionRightTab: new Map(),
      showApprovalModal: false,
      showSettingsModal: false,
      showProjectPicker: false,
    });
    useSessionStore.setState({ activeSessionId: null });
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

  it("setRightPanelMinWidth bumps rightPanelWidth up when the new min exceeds current width", () => {
    // Regression for "Guide tab hidden when project opens with a populated
    // guide". When RightPanel measures its tab bar and sees it needs 530px,
    // setRightPanelMinWidth(530) must also push the stored width up so the
    // panel actually renders wide enough to show the Guide tab.
    useUiStore.setState({ rightPanelWidth: 420, rightPanelMinWidth: 200 });
    useUiStore.getState().setRightPanelMinWidth(530);
    const state = useUiStore.getState();
    expect(state.rightPanelMinWidth).toBe(530);
    expect(state.rightPanelWidth).toBe(530);
  });

  it("setRightPanelMinWidth does NOT shrink rightPanelWidth when the new min is lower", () => {
    // If the user has already dragged the panel wider than the current
    // minimum, shrinking the minimum must NOT shrink their chosen width.
    useUiStore.setState({ rightPanelWidth: 700, rightPanelMinWidth: 530 });
    useUiStore.getState().setRightPanelMinWidth(300);
    const state = useUiStore.getState();
    expect(state.rightPanelMinWidth).toBe(300);
    expect(state.rightPanelWidth).toBe(700);
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

  it("showMissionControl defaults to false", () => {
    expect(useUiStore.getState().showMissionControl).toBe(false);
  });

  it("setShowMissionControl sets the Mission Control overlay flag", () => {
    useUiStore.getState().setShowMissionControl(true);
    expect(useUiStore.getState().showMissionControl).toBe(true);
    useUiStore.getState().setShowMissionControl(false);
    expect(useUiStore.getState().showMissionControl).toBe(false);
  });

  it("toggleMissionControl flips the Mission Control overlay flag", () => {
    expect(useUiStore.getState().showMissionControl).toBe(false);
    useUiStore.getState().toggleMissionControl();
    expect(useUiStore.getState().showMissionControl).toBe(true);
    useUiStore.getState().toggleMissionControl();
    expect(useUiStore.getState().showMissionControl).toBe(false);
  });

  it("showActivityOverview defaults to false", () => {
    expect(useUiStore.getState().showActivityOverview).toBe(false);
  });

  it("setShowActivityOverview toggles the Activity Overview lay-over", () => {
    useUiStore.getState().setShowActivityOverview(true);
    expect(useUiStore.getState().showActivityOverview).toBe(true);
    useUiStore.getState().setShowActivityOverview(false);
    expect(useUiStore.getState().showActivityOverview).toBe(false);
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

  describe("per-session right tab", () => {
    it("setRightTab persists tab for the active session", () => {
      useSessionStore.setState({ activeSessionId: "s1" });
      useUiStore.getState().setRightTab("terminal");
      expect(useUiStore.getState().rightTab).toBe("terminal");
      expect(useUiStore.getState().sessionRightTab.get("s1")).toBe("terminal");
    });

    it("setRightTab does not persist when no active session", () => {
      useSessionStore.setState({ activeSessionId: null });
      useUiStore.getState().setRightTab("files");
      expect(useUiStore.getState().rightTab).toBe("files");
      expect(useUiStore.getState().sessionRightTab.size).toBe(0);
    });

    it("setRightTab updates the map entry when tab changes again", () => {
      useSessionStore.setState({ activeSessionId: "s1" });
      useUiStore.getState().setRightTab("terminal");
      useUiStore.getState().setRightTab("assistant");
      expect(useUiStore.getState().sessionRightTab.get("s1")).toBe("assistant");
    });

    it("setRightTab tracks different sessions independently", () => {
      useSessionStore.setState({ activeSessionId: "s1" });
      useUiStore.getState().setRightTab("terminal");

      useSessionStore.setState({ activeSessionId: "s2" });
      useUiStore.getState().setRightTab("files");

      expect(useUiStore.getState().sessionRightTab.get("s1")).toBe("terminal");
      expect(useUiStore.getState().sessionRightTab.get("s2")).toBe("files");
    });

    it("restoreSessionRightTab saves outgoing and restores incoming", () => {
      useUiStore.setState({
        rightTab: "terminal",
        sessionRightTab: new Map([["s2", "files"]]),
      });
      useUiStore.getState().restoreSessionRightTab("s1", "s2");
      expect(useUiStore.getState().sessionRightTab.get("s1")).toBe("terminal");
      expect(useUiStore.getState().rightTab).toBe("files");
    });

    it("restoreSessionRightTab defaults to current tab for first visit", () => {
      useUiStore.setState({ rightTab: "changelog", sessionRightTab: new Map() });
      useUiStore.getState().restoreSessionRightTab("s1", "s3");
      expect(useUiStore.getState().rightTab).toBe("changelog");
      expect(useUiStore.getState().sessionRightTab.get("s1")).toBe("changelog");
    });

    it("restoreSessionRightTab handles null outgoing", () => {
      useUiStore.setState({
        rightTab: "activity",
        sessionRightTab: new Map([["s1", "assistant"]]),
      });
      useUiStore.getState().restoreSessionRightTab(null, "s1");
      expect(useUiStore.getState().rightTab).toBe("assistant");
    });

    it("restoreSessionRightTab handles null incoming", () => {
      useUiStore.setState({ rightTab: "terminal", sessionRightTab: new Map() });
      useUiStore.getState().restoreSessionRightTab("s1", null);
      expect(useUiStore.getState().rightTab).toBe("terminal");
      expect(useUiStore.getState().sessionRightTab.get("s1")).toBe("terminal");
    });

    it("restoreSessionRightTab handles both null", () => {
      useUiStore.setState({ rightTab: "files", sessionRightTab: new Map() });
      useUiStore.getState().restoreSessionRightTab(null, null);
      expect(useUiStore.getState().rightTab).toBe("files");
      expect(useUiStore.getState().sessionRightTab.size).toBe(0);
    });
  });

  describe("planCompleteFilePath", () => {
    it("sets and gets planCompleteFilePath", () => {
      useUiStore.getState().setPlanCompleteFilePath("/path/to/plan.md");
      expect(useUiStore.getState().planCompleteFilePath).toBe("/path/to/plan.md");
    });

    it("preserves planCompleteFilePath when modal is closed (banner-reopen support)", () => {
      useUiStore.setState({
        showPlanCompleteModal: true,
        planCompleteSessionId: "s1",
        planCompleteFilePath: "/path/to/plan.md",
        planCompleteContent: "plan body",
        pendingPlanSessionId: "s1",
      });
      useUiStore.getState().setShowPlanCompleteModal(false);
      // Plan state must survive modal close so the InputArea banner can
      // reopen the modal with the same data.
      expect(useUiStore.getState().showPlanCompleteModal).toBe(false);
      expect(useUiStore.getState().planCompleteFilePath).toBe("/path/to/plan.md");
      expect(useUiStore.getState().planCompleteSessionId).toBe("s1");
      expect(useUiStore.getState().planCompleteContent).toBe("plan body");
      expect(useUiStore.getState().pendingPlanSessionId).toBe("s1");
    });

    it("preserves planCompleteFilePath when modal is opened", () => {
      useUiStore.setState({
        planCompleteFilePath: "/path/to/plan.md",
      });
      useUiStore.getState().setShowPlanCompleteModal(true);
      expect(useUiStore.getState().planCompleteFilePath).toBe("/path/to/plan.md");
    });
  });

  describe("pendingPlanSessionId", () => {
    it("sets and gets pendingPlanSessionId", () => {
      useUiStore.getState().setPendingPlanSessionId("s1");
      expect(useUiStore.getState().pendingPlanSessionId).toBe("s1");
    });

    it("setPendingPlanSessionId(null) clears the field", () => {
      useUiStore.setState({ pendingPlanSessionId: "s1" });
      useUiStore.getState().setPendingPlanSessionId(null);
      expect(useUiStore.getState().pendingPlanSessionId).toBeNull();
    });
  });

  describe("clearPendingPlan", () => {
    it("clears every pending-plan field AND closes the modal", () => {
      useUiStore.setState({
        showPlanCompleteModal: true,
        planCompleteSessionId: "s1",
        planCompleteFilePath: "/plan.md",
        planCompleteContent: "body",
        pendingPlanSessionId: "s1",
      });
      useUiStore.getState().clearPendingPlan();
      const s = useUiStore.getState();
      expect(s.showPlanCompleteModal).toBe(false);
      expect(s.planCompleteSessionId).toBeNull();
      expect(s.planCompleteFilePath).toBeNull();
      expect(s.planCompleteContent).toBeNull();
      expect(s.pendingPlanSessionId).toBeNull();
    });

    it("is a no-op when nothing is pending", () => {
      useUiStore.getState().clearPendingPlan();
      const s = useUiStore.getState();
      expect(s.showPlanCompleteModal).toBe(false);
      expect(s.pendingPlanSessionId).toBeNull();
    });
  });

  describe("cliOverlayCodexMode", () => {
    it("defaults to null", () => {
      expect(useUiStore.getState().cliOverlayCodexMode).toBeNull();
    });

    it("setCliOverlayCodexMode stores the dispatch kind", () => {
      useUiStore.getState().setCliOverlayCodexMode("resume-tui");
      expect(useUiStore.getState().cliOverlayCodexMode).toBe("resume-tui");
      useUiStore.getState().setCliOverlayCodexMode("subcommand");
      expect(useUiStore.getState().cliOverlayCodexMode).toBe("subcommand");
    });

    it("is reset to null when the overlay is hidden", () => {
      useUiStore.setState({ cliOverlayCodexMode: "resume-tui" });
      useUiStore.getState().setShowCliOverlay(false);
      expect(useUiStore.getState().cliOverlayCodexMode).toBeNull();
    });

    it("is preserved while the overlay is shown", () => {
      useUiStore.getState().setCliOverlayCodexMode("resume-tui");
      useUiStore.getState().setShowCliOverlay(true);
      expect(useUiStore.getState().cliOverlayCodexMode).toBe("resume-tui");
    });
  });
});
