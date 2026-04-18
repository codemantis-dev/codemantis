/**
 * Centralized store reset for tests.
 * Call resetAllStores() in beforeEach to prevent state leaks between tests.
 */
import { useSessionStore } from "../../stores/sessionStore";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSelfDriveStore } from "../../stores/selfDriveStore";
import { useSuperBroStore } from "../../stores/superBroStore";
import { useUiStore } from "../../stores/uiStore";
import { useFileViewerStore } from "../../stores/fileViewerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useGuideStore } from "../../stores/guideStore";
import { useChangelogStore } from "../../stores/changelogStore";
import { useActivityStore } from "../../stores/activityStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { usePreviewStore } from "../../stores/previewStore";
import { useMcpStore } from "../../stores/mcpStore";
import { useOpenRouterStore } from "../../stores/openRouterStore";
import { useToastStore } from "../../stores/toastStore";
import { useAttachmentStore } from "../../stores/attachmentStore";

export function resetAllStores(): void {
  useSessionStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    sessionStats: new Map(),
    sessionModes: new Map(),
    sessionBusy: new Map(),
    sessionEffort: new Map(),
    sessionRetry: new Map(),
    lastEventTimestamp: new Map(),
    contextToastFired: new Map(),
    sessionActivity: new Map(),
    sessionCompacting: new Map(),
    busySince: new Map(),
    rateLimitUtilization: new Map(),
    sessionCapabilities: new Map(),
    activeSubAgents: new Map(),
    sessionThinking: new Map(),
    tabOrder: [],
    activeProjectPath: null,
    projectOrder: [],
    projectActiveSession: new Map(),
  });

  useSpecWriterStore.setState({
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
  });

  useAssistantStore.setState({
    projectAssistants: new Map(),
    activeAssistantId: new Map(),
    messages: new Map(),
    streaming: new Map(),
    busy: new Map(),
    sessionCost: new Map(),
    attachments: new Map(),
    cliSessionIds: new Map(),
  });

  useSelfDriveStore.setState({
    status: "idle",
    projectPath: null,
    sessionId: null,
    guide: null,
    needsSessionAttach: false,
    postRestartFreshResumeNeeded: false,
    currentSessionIndex: null,
    currentPhase: null,
    previousSessionMode: null,
    fixAttempt: 0,
    maxFixAttempts: 3,
    previousFixPrompts: [],
    lowConfidenceCount: 0,
    runLog: [],
    startedAt: null,
    sessionStartedAt: null,
    pauseReason: null,
    activeBlocker: null,
    blockerHistory: [],
    recentPauseSummaries: [],
    config: {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      maxFixAttempts: 3,
      runTests: true,
      runBuildCheck: true,
      autoCommit: false,
    },
  });

  useSuperBroStore.setState({
    enabledProjects: new Map(),
    projectMessages: new Map(),
    projectThinking: new Map(),
    projectCheckResult: new Map(),
    projectObservations: new Map(),
    isPaused: false,
    messageHistory: [],
    log: [],
  });

  useUiStore.setState({
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
  });

  useFileViewerStore.setState({
    projectOpenFiles: new Map(),
    projectActiveFile: new Map(),
    projectEditedContents: new Map(),
    projectDirtyFiles: new Map(),
  });

  useSettingsStore.setState({
    loaded: false,
  });

  useGuideStore.setState({
    guide: null,
    loading: false,
  });

  useChangelogStore.setState({
    sessionEntries: new Map(),
    generating: new Map(),
    projectEntries: new Map(),
  });

  useActivityStore.setState({
    sessionEntries: new Map(),
    sessionQuestions: new Map(),
    alwaysAllowedTools: new Map(),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
  });

  useTerminalStore.setState({
    sessionTerminals: new Map(),
    activeTerminalId: new Map(),
    detectedDevServers: new Map(),
  });

  usePreviewStore.setState({
    devServer: new Map(),
    previewOpen: new Map(),
    consoleLogs: new Map(),
    consoleDrawerOpen: false,
    viewportPreset: "desktop",
    unreadErrors: new Map(),
    previewUrlPrompt: null,
  });

  useMcpStore.setState({
    servers: [],
    loading: false,
    error: null,
  });

  useOpenRouterStore.setState({
    models: [],
    loading: false,
    lastFetched: null,
    error: null,
  });

  useToastStore.setState({
    toasts: [],
  });

  useAttachmentStore.setState({
    attachments: new Map(),
  });
}
