import { useEffect, useState } from "react";
import { FileText, Trash2, Loader2, BookOpen, CheckCircle2, Rocket, Settings, Unlink } from "lucide-react";
import { isGuideStarted } from "../../lib/guide-helpers";
import { useGuideStore } from "../../stores/guideStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  useSelfDriveStore,
  useSelfDriveStatusForActiveProject,
  isSelfDriveOwningProject,
  toggleVerifyCheckForSession,
  markPromptSentForSession,
  markVerifyRequestedForSession,
  attemptMarkSessionComplete,
} from "../../stores/selfDriveStore";
import { showToast } from "../../stores/toastStore";
import { readSpecDocument } from "../../lib/tauri-commands";
import GuideSessionCard from "./GuideSessionCard";
import SelfDriveStatus from "./SelfDriveStatus";
import SelfDriveConfirmModal from "../modals/SelfDriveConfirmModal";

export default function GuidePanel() {
  const guide = useGuideStore((s) => s.guide);
  const loading = useGuideStore((s) => s.loading);
  const toggleVerifyCheck = useGuideStore((s) => s.toggleVerifyCheck);
  const markSessionComplete = useGuideStore((s) => s.markSessionComplete);
  const dismissGuide = useGuideStore((s) => s.dismissGuide);
  const unloadGuide = useGuideStore((s) => s.unloadGuide);
  const loadGuideForProject = useGuideStore((s) => s.loadGuideForProject);
  const markPromptSent = useGuideStore((s) => s.markPromptSent);
  const markVerifyRequested = useGuideStore((s) => s.markVerifyRequested);

  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const selfDriveStatus = useSelfDriveStatusForActiveProject();
  const selfDriveStart = useSelfDriveStore((s) => s.start);
  const settings = useSettingsStore((s) => s.settings);

  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [showUnloadConfirm, setShowUnloadConfirm] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Load guide when project changes
  useEffect(() => {
    if (activeProjectPath) {
      loadGuideForProject(activeProjectPath);
    }
  }, [activeProjectPath, loadGuideForProject]);

  // When Self-Drive owns this project, UI mutations must route through
  // selfDriveStore helpers (which mirror both stores via applyGuideMutation).
  // Otherwise `selfDriveStore.guide` stays stale and resume() loops back to
  // the already-completed session. Route only when Self-Drive is paused/
  // running for THIS project — otherwise fall through to the guideStore
  // path which is correct for the idle case.
  const routeThroughSelfDrive = (): boolean =>
    !!activeProjectPath && isSelfDriveOwningProject(activeProjectPath);

  const handleToggleVerifyCheck = (sessionIndex: number, checkId: string) => {
    if (routeThroughSelfDrive()) {
      toggleVerifyCheckForSession(sessionIndex, checkId);
    } else {
      toggleVerifyCheck(sessionIndex, checkId);
    }
  };

  const handleMarkPromptSent = (sessionIndex: number) => {
    if (routeThroughSelfDrive()) {
      markPromptSentForSession(sessionIndex);
    } else {
      markPromptSent(sessionIndex);
    }
  };

  const handleMarkVerifyRequested = (sessionIndex: number) => {
    if (routeThroughSelfDrive()) {
      markVerifyRequestedForSession(sessionIndex);
    } else {
      markVerifyRequested(sessionIndex);
    }
  };

  const handleMarkComplete = async (sessionIndex: number) => {
    if (routeThroughSelfDrive()) {
      // Self-Drive path — manual click is an explicit user override. We
      // bypass the cross-system parity gate here on purpose: parity is
      // useful as an *automated* guard inside handleAdvance(), but it
      // must never silently block a deliberate human "Mark Complete".
      // The verify-checks gate still applies (button is disabled at the
      // UI level until every check is ticked).
      const outcome = await attemptMarkSessionComplete(sessionIndex, {
        skipParityGate: true,
      });
      if (!outcome.ok) {
        if (outcome.reason === "checks-incomplete") {
          showToast("Complete all verify checks before marking done.", "error");
        } else if (outcome.reason === "session-not-found") {
          showToast("Session not found in pinned guide.", "error");
        }
        return;
      }
      // Manual completion of the active session is the user's signal that
      // they've handled the situation. If Self-Drive was paused (typically
      // by the parity gate they just bypassed), clear the pause so Resume
      // picks up at the next session instead of immediately re-tripping.
      const sd = useSelfDriveStore.getState();
      if (sd.status === "paused") {
        sd.clearPause();
      }
      const g = useSelfDriveStore.getState().guide;
      if (g?.status === "completed") {
        showToast("All sessions complete! Your implementation is done.", "success");
      } else {
        const nextSession = g?.sessions.find((s) => s.status === "active");
        if (nextSession) {
          showToast(`Session ${sessionIndex} complete! Next: Session ${nextSession.index}`, "success");
        }
      }
      return;
    }

    const success = markSessionComplete(sessionIndex);
    if (success) {
      const g = useGuideStore.getState().guide;
      if (g?.status === "completed") {
        showToast("All sessions complete! Your implementation is done.", "success");
      } else {
        const nextSession = g?.sessions.find((s) => s.status === "active");
        if (nextSession) {
          showToast(`Session ${sessionIndex} complete! Next: Session ${nextSession.index}`, "success");
        }
      }
    }
  };

  const handleOpenSpec = async () => {
    if (!guide || !activeProjectPath) return;
    try {
      await readSpecDocument(activeProjectPath, guide.specFilename);
      // Switch to files tab — the spec viewer is there
      useUiStore.getState().setRightTab("files");
    } catch {
      showToast("Spec file not found", "error");
    }
  };

  const handleUnload = () => {
    setShowUnloadConfirm(false);
    unloadGuide();
    useUiStore.getState().setRightTab("activity");
    showToast("Guide unloaded", "info");
  };

  const handleDismiss = async () => {
    setShowDismissConfirm(false);
    await dismissGuide();
    useUiStore.getState().setRightTab("activity");
    showToast("Implementation guide dismissed", "info");
  };

  // Loading state
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-ghost)" }} />
      </div>
    );
  }

  // No guide
  if (!guide) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-4">
        <BookOpen size={24} style={{ color: "var(--text-ghost)" }} />
        <p className="text-xs text-center" style={{ color: "var(--text-ghost)" }}>
          No implementation guide yet.
          <br />
          Save a spec with a Session Plan to generate one.
        </p>
      </div>
    );
  }

  const canUnload = !isGuideStarted(guide) && selfDriveStatus !== "running" && selfDriveStatus !== "paused";

  // Compute progress
  const totalSessions = guide.sessions.length;
  const completedSessions = guide.sessions.filter((s) => s.status === "done").length;
  const progressPercent = Math.round((completedSessions / totalSessions) * 100);
  const isComplete = guide.status === "completed";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2.5 border-b shrink-0" style={{ borderColor: "var(--border-light)" }}>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen size={13} style={{ color: isComplete ? "var(--color-green, #22c55e)" : "var(--accent)" }} />
          <span
            className="text-xs font-medium truncate flex-1"
            style={{ color: "var(--text-primary)" }}
          >
            {guide.title}
          </span>
        </div>
        {isComplete ? (
          <div
            className="flex items-center gap-2 px-2 py-1 mb-1.5 rounded-md"
            style={{
              background: "rgba(34, 197, 94, 0.1)",
              border: "1px solid var(--color-green, #22c55e)",
            }}
          >
            <CheckCircle2 size={13} style={{ color: "var(--color-green, #22c55e)" }} />
            <span
              className="text-label font-semibold"
              style={{ color: "var(--color-green, #22c55e)" }}
            >
              Implementation Complete
            </span>
          </div>
        ) : (
          <p className="text-detail mb-1.5" style={{ color: "var(--text-secondary)" }}>
            Implementation Guide &middot; {completedSessions} of {totalSessions} sessions complete
          </p>
        )}
        {/* Progress bar + Self-Drive button */}
        <div className="flex items-center gap-2">
          <div
            className="flex-1 h-1 rounded-full overflow-hidden"
            style={{ background: "var(--bg-elevated)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressPercent}%`,
                background: isComplete ? "var(--color-green, #22c55e)" : "var(--accent)",
              }}
            />
          </div>
          {!isComplete && selfDriveStatus === "idle" && (
            <button
              onClick={() => setShowConfirmModal(true)}
              disabled={!activeSessionId || !guide.sessions.some((s) => s.status === "active")}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-detail font-medium transition-all hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              style={{ background: "var(--accent)", color: "white" }}
              title={
                !activeSessionId
                  ? "Start Claude Code first"
                  : !settings.apiKeys[settings.selfDriveProvider]?.trim()
                    ? "Configure AI provider in Settings"
                    : "Start Self-Drive — autonomous implementation"
              }
            >
              <Rocket size={10} />
              Self-Drive
            </button>
          )}
          {!isComplete && selfDriveStatus === "idle" && (
            <button
              onClick={() => {
                useUiStore.getState().openSettingsToTab("self-drive");
              }}
              className="p-1 rounded hover:bg-bg-elevated transition-colors shrink-0"
              title="Self-Drive settings"
            >
              <Settings size={11} style={{ color: "var(--text-ghost)" }} />
            </button>
          )}
        </div>

        {/* Self-Drive status strip */}
        <SelfDriveStatus />
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {guide.sessions.map((session) => (
          <GuideSessionCard
            key={session.index}
            session={session}
            specFilename={guide.specFilename}
            onToggleVerifyCheck={(checkId) =>
              handleToggleVerifyCheck(session.index, checkId)
            }
            onMarkComplete={() => {
              void handleMarkComplete(session.index);
            }}
            onMarkPromptSent={() => handleMarkPromptSent(session.index)}
            onMarkVerifyRequested={() => handleMarkVerifyRequested(session.index)}
          />
        ))}
      </div>

      {/* Footer */}
      <div
        className="px-3 py-2 border-t flex items-center gap-2 shrink-0"
        style={{ borderColor: "var(--border-light)" }}
      >
        <button
          onClick={handleOpenSpec}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-label transition-colors hover:bg-bg-elevated"
          style={{ color: "var(--text-secondary)" }}
        >
          <FileText size={11} />
          Open Spec
        </button>
        {!showUnloadConfirm ? (
          <button
            onClick={() => setShowUnloadConfirm(true)}
            disabled={!canUnload}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-label transition-colors hover:bg-bg-elevated disabled:opacity-30"
            style={{ color: "var(--text-ghost)" }}
            title={canUnload ? "Unload guide (keeps saved in database)" : "Cannot unload — guide is in progress"}
          >
            <Unlink size={11} />
            Unload
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-detail" style={{ color: "var(--text-secondary)" }}>
              Unload guide?
            </span>
            <button
              onClick={handleUnload}
              className="px-2 py-1 rounded text-detail font-medium"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Yes
            </button>
            <button
              onClick={() => setShowUnloadConfirm(false)}
              className="px-2 py-1 rounded text-detail"
              style={{ color: "var(--text-secondary)" }}
            >
              No
            </button>
          </div>
        )}
        <div className="flex-1" />
        {!showDismissConfirm ? (
          <button
            onClick={() => setShowDismissConfirm(true)}
            disabled={selfDriveStatus === "running" || selfDriveStatus === "paused"}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-label transition-colors hover:bg-red-500/10 disabled:opacity-30"
            style={{ color: "var(--text-ghost)" }}
          >
            <Trash2 size={11} />
            Dismiss
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-detail" style={{ color: "var(--text-secondary)" }}>
              Delete guide?
            </span>
            <button
              onClick={handleDismiss}
              className="px-2 py-1 rounded text-detail font-medium"
              style={{ background: "#ef4444", color: "white" }}
            >
              Yes
            </button>
            <button
              onClick={() => setShowDismissConfirm(false)}
              className="px-2 py-1 rounded text-detail"
              style={{ color: "var(--text-secondary)" }}
            >
              No
            </button>
          </div>
        )}
      </div>

      {/* Self-Drive confirm modal */}
      <SelfDriveConfirmModal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={() => {
          setShowConfirmModal(false);
          selfDriveStart();
        }}
      />
    </div>
  );
}
