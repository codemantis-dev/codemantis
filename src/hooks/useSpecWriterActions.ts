import { useEffect, useRef, useCallback, useState } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSessionStore } from "../stores/sessionStore";
import { showToast } from "../stores/toastStore";
import { useGuideStore } from "../stores/guideStore";
import { useUiStore } from "../stores/uiStore";
import { useSelfDriveStatusForActiveProject } from "../stores/selfDriveStore";
import { useClaudeSession } from "./useClaudeSession";
import { useSpecConversationRouter } from "./useSpecConversationRouter";
import { useSavedSpecs } from "./useSavedSpecs";
import {
  listSpecDocuments,
  gatherSpecContext,
  saveTaskBoardState,
  addVerificationWorkflowToClaudeMd,
} from "../lib/tauri-commands";
import { parseSessionPlan, diagnoseSessionPlanFailure } from "../lib/parse-session-plan";
import type { ParsedSessionPlan } from "../lib/parse-session-plan";
import { isGuideStarted } from "../lib/guide-helpers";

export interface SpecWriterActionsReturn {
  // Save dialog state
  showSaveDialog: boolean;
  saveDialogType: "spec" | "audit";
  lastSavedFile: string | null;
  isEditing: boolean;
  pendingGuideLoad: { filename: string; parsed: ParsedSessionPlan } | null;

  // Context state
  contextLoading: boolean;
  contextError: string | null;

  // Derived state
  hasGuide: boolean;

  // Handlers
  handleClose: () => void;
  handleCancelContext: () => void;
  handleSpecEdit: (newContent: string) => void;
  handleCloseSpec: () => void;
  handleReset: () => void;
  handleWriteSpec: () => void;
  handleGenerateAudit: () => void;
  handleUseGuide: () => void;
  handleRecognizeGuide: () => Promise<void>;
  handleLoadGuideFromSavedSpec: () => Promise<void>;
  handleConfirmGuideReplace: () => Promise<void>;
  handleSaved: (filename: string) => void;
  handleAddToClaudeMd: () => Promise<void>;
  handleOptionAction: (option: string) => boolean;
  openSaveSpecDialog: () => void;
  openSaveAuditDialog: () => void;
  handleSuggestFeatures: () => void;
  handlePromoteToSpec: (messageId: string) => void;
  handleSendToChat: () => Promise<void>;
  handleImplement: () => Promise<void>;
  handleLoadSpec: (content: string, filename: string) => void;
  handleToggleEdit: () => void;
  setContextError: (error: string | null) => void;
  setPendingGuideLoad: (v: { filename: string; parsed: ParsedSessionPlan } | null) => void;
  setShowSaveDialog: (v: boolean) => void;

  // Spec conversation router
  sendSpecMessage: (
    projectPath: string,
    content: string,
  ) => Promise<void>;
  writeSpec: (projectPath: string) => void;
  cancelStream: (projectPath: string) => void;
  /** Stage 3: Coverage panel "Run another recheck" button. */
  requestRecheck: (projectPath: string) => boolean;
}

export function useSpecWriterActions(activeProjectPath: string | null): SpecWriterActionsReturn {
  const setSlideOverOpen = useSpecWriterStore((s) => s.setSlideOverOpen);
  const clearConversation = useSpecWriterStore((s) => s.clearConversation);
  const setCurrentSpecContent = useSpecWriterStore((s) => s.setCurrentSpecContent);
  const setCurrentAuditContent = useSpecWriterStore((s) => s.setCurrentAuditContent);
  const persistState = useSpecWriterStore((s) => s.persistState);
  const loadState = useSpecWriterStore((s) => s.loadState);
  const setSavedSpecs = useSpecWriterStore((s) => s.setSavedSpecs);
  const setContextLoaded = useSpecWriterStore((s) => s.setContextLoaded);
  const setProjectContext = useSpecWriterStore((s) => s.setProjectContext);
  const addMessage = useSpecWriterStore((s) => s.addMessage);
  const setSelectedSavedSpec = useSpecWriterStore((s) => s.setSelectedSavedSpec);
  const promoteMessageToSpec = useSpecWriterStore((s) => s.promoteMessageToSpec);

  const currentSpecContent = useSpecWriterStore((s) =>
    activeProjectPath ? s.currentSpecContent.get(activeProjectPath) ?? null : null
  );
  const isOpen = useSpecWriterStore((s) => {
    if (!activeProjectPath) return false;
    return s.uiState.get(activeProjectPath)?.is_open ?? false;
  });
  const conversation = useSpecWriterStore((s) =>
    activeProjectPath ? s.conversations.get(activeProjectPath) : undefined
  );
  const isStreaming = useSpecWriterStore((s) =>
    activeProjectPath ? s.planningStreaming.get(activeProjectPath) ?? false : false
  );
  const selectedSavedSpec = useSpecWriterStore((s) => {
    if (!activeProjectPath) return null;
    return s.uiState.get(activeProjectPath)?.selected_saved_spec ?? null;
  });

  const guideSpecFilename = useGuideStore((s) => s.guide?.specFilename ?? null);
  const currentGuide = useGuideStore((s) => s.guide);
  const selfDriveStatus = useSelfDriveStatusForActiveProject();

  const { sendMessage: sendChatMessage } = useClaudeSession();
  const { sendMessage: sendSpecMessage, writeSpec, generateAudit, cancelStream, requestRecheck } =
    useSpecConversationRouter();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogType, setSaveDialogType] = useState<"spec" | "audit">("spec");
  const [lastSavedFile, setLastSavedFile] = useState<string | null>(null);
  const [, setLastSavedAuditFile] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingGuideLoad, setPendingGuideLoad] = useState<{
    filename: string;
    parsed: ParsedSessionPlan;
  } | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const hasGuide = !!lastSavedFile && guideSpecFilename === lastSavedFile;
  const initCheckedRef = useRef<string | null>(null);
  const contextAbortRef = useRef(false);
  const prevStatusRef = useRef(conversation?.status);

  const { refreshSavedSpecs } = useSavedSpecs(activeProjectPath);

  // One-time project init: load persisted state and gather context
  useEffect(() => {
    if (!activeProjectPath) return;
    if (initCheckedRef.current === activeProjectPath) return;
    initCheckedRef.current = activeProjectPath;

    loadState(activeProjectPath);

    contextAbortRef.current = false;
    setContextLoading(true);
    setContextError(null);
    gatherSpecContext(activeProjectPath)
      .then((context) => {
        if (contextAbortRef.current) return;
        setProjectContext(activeProjectPath, context);
        setContextLoaded(activeProjectPath, true);
        setContextLoading(false);
      })
      .catch((e) => {
        if (contextAbortRef.current) return;
        console.error("[SpecWriter] Context gathering failed:", e);
        setContextError(String(e));
        setContextLoading(false);
      });

    listSpecDocuments(activeProjectPath)
      .then((specs) => {
        setSavedSpecs(activeProjectPath, specs);
      })
      .catch(() => {});
  }, [activeProjectPath, loadState, setContextLoaded, setSavedSpecs, setProjectContext]);

  // Refresh saved specs each time the panel opens
  useEffect(() => {
    if (!isOpen || !activeProjectPath) return;
    listSpecDocuments(activeProjectPath)
      .then((specs) => {
        setSavedSpecs(activeProjectPath, specs);
      })
      .catch(() => {});
  }, [isOpen, activeProjectPath, setSavedSpecs]);

  // Abort context gathering if panel closes
  useEffect(() => {
    if (!isOpen) {
      contextAbortRef.current = true;
      setContextLoading(false);
    }
  }, [isOpen]);

  // Auto-exit edit mode when streaming starts
  useEffect(() => {
    if (isStreaming) setIsEditing(false);
  }, [isStreaming]);

  // Clear stale saved-file state when a new spec finishes generating
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = conversation?.status;
    if (conversation?.status === "done" && prev === "writing") {
      setLastSavedFile(null);
      setLastSavedAuditFile(null);
    }
  }, [conversation?.status]);

  const handleClose = useCallback(() => {
    if (activeProjectPath) {
      persistState(activeProjectPath);
      setSlideOverOpen(activeProjectPath, false);
    }
  }, [activeProjectPath, setSlideOverOpen, persistState]);

  // Escape key closes
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  const handleCancelContext = useCallback(() => {
    contextAbortRef.current = true;
    setContextLoading(false);
    if (activeProjectPath) {
      setContextLoaded(activeProjectPath, false);
    }
  }, [activeProjectPath, setContextLoaded]);

  const handleSpecEdit = useCallback(
    (newContent: string) => {
      if (activeProjectPath) {
        setCurrentSpecContent(activeProjectPath, newContent);
      }
    },
    [activeProjectPath, setCurrentSpecContent]
  );

  const handleCloseSpec = useCallback(() => {
    if (activeProjectPath) {
      setCurrentSpecContent(activeProjectPath, null);
      setCurrentAuditContent(activeProjectPath, null);
      setSelectedSavedSpec(activeProjectPath, null);
      setIsEditing(false);
    }
  }, [activeProjectPath, setCurrentSpecContent, setCurrentAuditContent, setSelectedSavedSpec]);

  const handleReset = useCallback(() => {
    if (activeProjectPath) {
      clearConversation(activeProjectPath);
      setCurrentSpecContent(activeProjectPath, null);
      setCurrentAuditContent(activeProjectPath, null);
      setLastSavedFile(null);
      setLastSavedAuditFile(null);
      setIsEditing(false);
      saveTaskBoardState(activeProjectPath, JSON.stringify({ conversation: null })).catch(() => {});
    }
  }, [activeProjectPath, clearConversation, setCurrentSpecContent, setCurrentAuditContent]);

  const handleWriteSpec = useCallback(() => {
    if (activeProjectPath) writeSpec(activeProjectPath);
  }, [activeProjectPath, writeSpec]);

  const handleGenerateAudit = useCallback(() => {
    if (activeProjectPath) generateAudit(activeProjectPath);
  }, [activeProjectPath, generateAudit]);

  const handleUseGuide = useCallback(() => {
    useUiStore.getState().setRightTab("guide");
    handleClose();
  }, [handleClose]);

  const handleRecognizeGuide = useCallback(async () => {
    if (!currentSpecContent || !activeProjectPath || !lastSavedFile) return;
    const parsed = parseSessionPlan(currentSpecContent);
    if (parsed) {
      const created = await useGuideStore.getState().createGuide(
        activeProjectPath,
        lastSavedFile,
        null,
        parsed
      );
      if (created) {
        showToast(
          `Implementation Guide created \u2014 ${parsed.sessions.length} sessions to complete`,
          "info"
        );
        useUiStore.getState().setRightTab("guide");
      } else {
        showToast("Guide already exists for this spec", "info");
      }
    } else {
      showToast(diagnoseSessionPlanFailure(currentSpecContent), "error");
    }
  }, [currentSpecContent, activeProjectPath, lastSavedFile]);

  const handleLoadGuideFromSavedSpec = useCallback(async () => {
    if (!currentSpecContent || !activeProjectPath || !selectedSavedSpec) return;

    const parsed = parseSessionPlan(currentSpecContent);
    if (!parsed) {
      showToast(diagnoseSessionPlanFailure(currentSpecContent), "error");
      return;
    }

    if (!currentGuide) {
      const created = await useGuideStore.getState().createGuide(
        activeProjectPath,
        selectedSavedSpec,
        null,
        parsed
      );
      if (created) {
        showToast(
          `Implementation Guide created \u2014 ${parsed.sessions.length} sessions`,
          "info"
        );
        useUiStore.getState().setRightTab("guide");
      }
      return;
    }

    const started =
      isGuideStarted(currentGuide) ||
      selfDriveStatus === "running" ||
      selfDriveStatus === "paused";

    if (started && currentGuide.status !== "completed") {
      showToast(
        `Cannot load \u2014 current guide for "${currentGuide.title}" is in progress`,
        "error"
      );
      return;
    }

    setPendingGuideLoad({ filename: selectedSavedSpec, parsed });
  }, [currentSpecContent, activeProjectPath, selectedSavedSpec, currentGuide, selfDriveStatus]);

  const handleConfirmGuideReplace = useCallback(async () => {
    if (!activeProjectPath || !pendingGuideLoad) return;
    setPendingGuideLoad(null);

    const created = await useGuideStore.getState().createGuide(
      activeProjectPath,
      pendingGuideLoad.filename,
      null,
      pendingGuideLoad.parsed
    );
    if (created) {
      showToast(
        `Implementation Guide created \u2014 ${pendingGuideLoad.parsed.sessions.length} sessions`,
        "info"
      );
      useUiStore.getState().setRightTab("guide");
    }
  }, [activeProjectPath, pendingGuideLoad]);

  const handleSpecSaved = useCallback(
    (filename: string) => {
      setShowSaveDialog(false);
      setLastSavedFile(filename);
      refreshSavedSpecs();
    },
    [refreshSavedSpecs]
  );

  const handleAuditSaved = useCallback(
    (filename: string) => {
      setShowSaveDialog(false);
      setLastSavedAuditFile(filename);
      refreshSavedSpecs();

      if (!activeProjectPath) return;
      const store = useSpecWriterStore.getState();
      const specFilename = filename.replace(".audit.md", ".md");

      store.addMessage(activeProjectPath, {
        id: `msg-audit-saved-${Date.now()}`,
        role: "system",
        content: `**Verification Audit saved to** \`docs/specs/${filename}\`\n\n**How to use it:**\n1. Tell Claude Code: "Read docs/specs/${specFilename} and implement it"\n2. After Claude Code says it's done, tell it:\n   "Read docs/specs/${filename} and verify your work. Open every file mentioned, read the actual code, and report PASS/FAIL for each item."\n3. Claude Code will find gaps and fix them.\n\n**Copy this prompt for after implementation:**\n\n\`\`\`\nRead docs/specs/${filename} and verify your implementation.\nFor every VERIFY directive, open the actual file and read the code.\nReport PASS, FAIL, or MISSING for each item. Fix all failures.\n\`\`\``,
        message_type: "conversation",
        timestamp: new Date().toISOString(),
      });

      store.addMessage(activeProjectPath, {
        id: `msg-claudemd-offer-${Date.now()}`,
        role: "system",
        content: `**Add verification workflow to CLAUDE.md?**\nThis adds an instruction to your project's CLAUDE.md so Claude Code automatically runs the verification audit after implementing a spec. Claude Code reads CLAUDE.md at the start of every session.`,
        message_type: "conversation",
        timestamp: new Date().toISOString(),
        parsedOptions: ["\u{1F4DD} Yes, add to CLAUDE.md", "No, skip this"],
      });
    },
    [activeProjectPath, refreshSavedSpecs]
  );

  const handleSaved = useCallback(
    (filename: string) => {
      if (saveDialogType === "audit") {
        handleAuditSaved(filename);
      } else {
        handleSpecSaved(filename);
      }
    },
    [saveDialogType, handleSpecSaved, handleAuditSaved]
  );

  const handleAddToClaudeMd = useCallback(async () => {
    if (!activeProjectPath) return;
    try {
      const result = await addVerificationWorkflowToClaudeMd(activeProjectPath);
      if (result === "already_exists") {
        showToast("Verification workflow already in CLAUDE.md", "info");
      } else {
        showToast("Added verification workflow to CLAUDE.md", "success");
      }
    } catch (e) {
      showToast(`Failed to update CLAUDE.md: ${e}`, "error");
    }
  }, [activeProjectPath]);

  const handleOptionAction = useCallback(
    (option: string): boolean => {
      if (!activeProjectPath) return false;
      if (option === "\u{1F4CB} Yes, generate the Verification Audit") {
        generateAudit(activeProjectPath);
        return true;
      }
      if (option === "Not now \u2014 I'll generate it later") {
        return true;
      }
      if (option === "\u{1F4DD} Yes, add to CLAUDE.md") {
        handleAddToClaudeMd();
        return true;
      }
      if (option === "No, skip this") {
        return true;
      }
      return false;
    },
    [activeProjectPath, generateAudit, handleAddToClaudeMd]
  );

  const openSaveSpecDialog = useCallback(() => {
    setSaveDialogType("spec");
    setShowSaveDialog(true);
  }, []);

  const openSaveAuditDialog = useCallback(() => {
    setSaveDialogType("audit");
    setShowSaveDialog(true);
  }, []);

  const handleSuggestFeatures = useCallback(() => {
    if (activeProjectPath) {
      sendSpecMessage(
        activeProjectPath,
        "Based on what you see in this project, what features or improvements would you suggest?"
      );
    }
  }, [activeProjectPath, sendSpecMessage]);

  const handlePromoteToSpec = useCallback(
    (messageId: string) => {
      if (activeProjectPath) {
        promoteMessageToSpec(activeProjectPath, messageId);
        showToast("Message promoted to spec preview", "success");
      }
    },
    [activeProjectPath, promoteMessageToSpec]
  );

  const handleSendToChat = useCallback(async () => {
    if (!lastSavedFile || !activeSessionId) {
      showToast("No active chat session", "error");
      return;
    }
    await sendChatMessage(activeSessionId, `Read docs/specs/${lastSavedFile} for implementation`);
    showToast("Sent spec reference to chat", "success");
    handleClose();
  }, [lastSavedFile, activeSessionId, sendChatMessage, handleClose]);

  const handleImplement = useCallback(async () => {
    if (!lastSavedFile || !activeSessionId) {
      showToast("No active chat session", "error");
      return;
    }
    await sendChatMessage(
      activeSessionId,
      `Please implement the feature described in docs/specs/${lastSavedFile}. Follow the specification and implementation checklist.`
    );
    showToast("Implementation request sent", "success");
    handleClose();
  }, [lastSavedFile, activeSessionId, sendChatMessage, handleClose]);

  const handleLoadSpec = useCallback(
    (content: string, filename: string) => {
      if (!activeProjectPath) return;
      setCurrentSpecContent(activeProjectPath, content);
      addMessage(activeProjectPath, {
        id: `msg-load-${Date.now()}`,
        role: "system",
        content: `Loaded existing spec "${filename}" for revision:\n\n${content}`,
        message_type: "context_summary",
        timestamp: new Date().toISOString(),
      });
    },
    [activeProjectPath, setCurrentSpecContent, addMessage]
  );

  const handleToggleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
  }, []);

  return {
    showSaveDialog,
    saveDialogType,
    lastSavedFile,
    isEditing,
    pendingGuideLoad,
    contextLoading,
    contextError,
    hasGuide,
    handleClose,
    handleCancelContext,
    handleSpecEdit,
    handleCloseSpec,
    handleReset,
    handleWriteSpec,
    handleGenerateAudit,
    handleUseGuide,
    handleRecognizeGuide,
    handleLoadGuideFromSavedSpec,
    handleConfirmGuideReplace,
    handleSaved,
    handleAddToClaudeMd,
    handleOptionAction,
    openSaveSpecDialog,
    openSaveAuditDialog,
    handleSuggestFeatures,
    handlePromoteToSpec,
    handleSendToChat,
    handleImplement,
    handleLoadSpec,
    handleToggleEdit,
    setContextError,
    setPendingGuideLoad,
    setShowSaveDialog,
    sendSpecMessage,
    writeSpec,
    cancelStream,
    requestRecheck,
  };
}
