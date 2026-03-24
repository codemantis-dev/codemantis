import { useEffect, useState } from "react";
import { FileText, Trash2, Loader2, BookOpen } from "lucide-react";
import { useGuideStore } from "../../stores/guideStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { showToast } from "../../stores/toastStore";
import { readSpecDocument } from "../../lib/tauri-commands";
import GuideSessionCard from "./GuideSessionCard";

export default function GuidePanel() {
  const guide = useGuideStore((s) => s.guide);
  const loading = useGuideStore((s) => s.loading);
  const toggleVerifyCheck = useGuideStore((s) => s.toggleVerifyCheck);
  const markSessionComplete = useGuideStore((s) => s.markSessionComplete);
  const dismissGuide = useGuideStore((s) => s.dismissGuide);
  const loadGuideForProject = useGuideStore((s) => s.loadGuideForProject);

  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  const [showDismissConfirm, setShowDismissConfirm] = useState(false);

  // Load guide when project changes
  useEffect(() => {
    if (activeProjectPath) {
      loadGuideForProject(activeProjectPath);
    }
  }, [activeProjectPath, loadGuideForProject]);

  const handleMarkComplete = (sessionIndex: number) => {
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
        <p className="text-[10px] mb-1.5" style={{ color: "var(--text-secondary)" }}>
          {isComplete
            ? "Implementation Guide Complete"
            : `Implementation Guide \u00b7 ${completedSessions} of ${totalSessions} sessions complete`}
        </p>
        {/* Progress bar */}
        <div
          className="h-1 rounded-full overflow-hidden"
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
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {guide.sessions.map((session) => (
          <GuideSessionCard
            key={session.index}
            session={session}
            specFilename={guide.specFilename}
            onToggleVerifyCheck={(checkId) =>
              toggleVerifyCheck(session.index, checkId)
            }
            onMarkComplete={() => handleMarkComplete(session.index)}
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
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] transition-colors hover:bg-bg-elevated"
          style={{ color: "var(--text-secondary)" }}
        >
          <FileText size={11} />
          Open Spec
        </button>
        <div className="flex-1" />
        {!showDismissConfirm ? (
          <button
            onClick={() => setShowDismissConfirm(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] transition-colors hover:bg-red-500/10"
            style={{ color: "var(--text-ghost)" }}
          >
            <Trash2 size={11} />
            Dismiss
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
              Delete guide?
            </span>
            <button
              onClick={handleDismiss}
              className="px-2 py-1 rounded text-[10px] font-medium"
              style={{ background: "#ef4444", color: "white" }}
            >
              Yes
            </button>
            <button
              onClick={() => setShowDismissConfirm(false)}
              className="px-2 py-1 rounded text-[10px]"
              style={{ color: "var(--text-secondary)" }}
            >
              No
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
