// Branch Map — full-width center view (sibling of Project Log / Session
// History). Owns load/empty/error gating, the header + actions, the graph
// canvas, the detail rail, and the guardrail dialogs.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Waypoints, RefreshCw, ArrowLeft, Loader2, GitBranch } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useGitStore, isGitLoading } from "../../stores/gitStore";
import { useChangelogStore } from "../../stores/changelogStore";
import { linkCommitsToChangelog } from "../../lib/branchmap/changelog-link";
import { switchBranchPreview } from "../../lib/tauri-commands";
import BranchMapEmpty from "./BranchMapEmpty";
import BranchGraphSvg from "./BranchGraphSvg";
import CommitDetailRail from "./CommitDetailRail";
import BranchActionsBar from "./BranchActionsBar";
import NewBranchDialog from "./NewBranchDialog";
import CommitDialog from "./CommitDialog";
import SwitchBranchDialog from "./SwitchBranchDialog";
import DeleteBranchDialog from "./DeleteBranchDialog";
import MergeConfirmDialog from "./MergeConfirmDialog";
import SyncDialog from "./SyncDialog";
import ConflictBanner from "./ConflictBanner";
import BranchCoachTip from "./BranchCoachTip";

function projectBasename(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

type DialogState =
  | { kind: "none" }
  | { kind: "newBranch" }
  | { kind: "commit" }
  | { kind: "switch"; name: string; dirtyFiles: string[] }
  | { kind: "delete"; name: string }
  | { kind: "merge"; name: string }
  | { kind: "sync" };

export default function BranchMapView() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const setShowBranchMap = useUiStore((s) => s.setShowBranchMap);
  const refresh = useGitStore((s) => s.refresh);
  const switchBranch = useGitStore((s) => s.switchBranch);
  const opInProgress = useGitStore((s) => s.opInProgress);
  const project = useGitStore((s) =>
    activeProjectPath ? s.byProject.get(activeProjectPath) : undefined,
  );
  const loading = useGitStore((s) =>
    activeProjectPath ? isGitLoading(s, activeProjectPath) : false,
  );
  const loadProjectEntries = useChangelogStore((s) => s.loadProjectEntries);
  const changelogEntries = useChangelogStore((s) =>
    activeProjectPath ? s.projectEntries.get(activeProjectPath) : undefined,
  );

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  useEffect(() => {
    if (activeProjectPath) {
      refresh(activeProjectPath);
      loadProjectEntries(activeProjectPath).catch(() => {});
    }
  }, [activeProjectPath, refresh, loadProjectEntries]);

  // Reset transient state when switching projects.
  useEffect(() => {
    setSelectedHash(null);
    setDialog({ kind: "none" });
  }, [activeProjectPath]);

  const graph = project?.graph ?? null;
  const status = project?.status ?? null;
  const conflict = project?.conflict ?? null;

  const changelogByHash = useMemo(
    () => linkCommitsToChangelog(graph?.commits ?? [], changelogEntries ?? []),
    [graph?.commits, changelogEntries],
  );

  const closeDialog = useCallback(() => setDialog({ kind: "none" }), []);

  // Switching: go direct when clean, prompt to save first when dirty.
  const handleSwitch = useCallback(
    async (name: string) => {
      if (!activeProjectPath) return;
      try {
        const preview = await switchBranchPreview(activeProjectPath, name);
        if (preview.dirty) {
          setDialog({ kind: "switch", name, dirtyFiles: preview.dirtyFiles });
        } else {
          await switchBranch(activeProjectPath, name);
        }
      } catch {
        // Fall back to a direct attempt; the store surfaces any error toast.
        await switchBranch(activeProjectPath, name);
      }
    },
    [activeProjectPath, switchBranch],
  );

  if (!activeProjectPath) {
    return (
      <div className="h-full flex items-center justify-center text-text-ghost text-ui">
        No project selected
      </div>
    );
  }

  const projectName = projectBasename(activeProjectPath);
  const changedCount = status?.uncommitted_changes ?? 0;
  const isRepoReady = !!graph && graph.commits.length > 0 && !!status?.is_git_repo;
  const busy = opInProgress !== null;
  const commitSuggestion = changelogEntries?.[0]?.headline;

  const handleRefresh = () => refresh(activeProjectPath);

  // Decide what to render in the body.
  let body: React.ReactNode;
  if (!project && loading) {
    body = <LoadingBody />;
  } else if (project?.error && !graph) {
    body = (
      <BranchMapEmpty variant="error" projectName={projectName} detail={project.error} />
    );
  } else if (status && !status.is_git_repo) {
    body = <BranchMapEmpty variant="not-a-repo" projectName={projectName} />;
  } else if (graph && graph.commits.length === 0) {
    body = <BranchMapEmpty variant="no-commits" projectName={projectName} />;
  } else if (graph) {
    body = (
      <div className="h-full flex min-h-0">
        <div className="flex-1 min-w-0">
          <BranchGraphSvg
            graph={graph}
            selectedHash={selectedHash}
            onSelectCommit={setSelectedHash}
            changelogByHash={changelogByHash}
            currentBranch={status?.branch ?? null}
            onSwitchBranch={handleSwitch}
            onMergeBranch={(name) => setDialog({ kind: "merge", name })}
            onDeleteBranch={(name) => setDialog({ kind: "delete", name })}
          />
        </div>
        <div className="w-72 shrink-0 border-l border-border-light">
          <CommitDetailRail
            graph={graph}
            selectedHash={selectedHash}
            onSelectCommit={setSelectedHash}
            changelogByHash={changelogByHash}
          />
        </div>
      </div>
    );
  } else {
    body = <LoadingBody />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header — mirrors ProjectLogFeed */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b border-border-light shrink-0"
        style={{ background: "var(--bg-subtle)" }}
      >
        <Waypoints size={14} className="text-text-secondary shrink-0" />
        <span className="text-ui font-medium text-text-primary">Branch Map</span>
        {status?.is_git_repo && status.branch && (
          <span className="flex items-center gap-1 text-detail font-medium text-accent bg-accent-dim rounded px-1.5 py-px">
            <GitBranch size={10} />
            {status.branch}
          </span>
        )}
        {changedCount > 0 && (
          <span className="text-detail font-medium text-yellow bg-bg-elevated rounded px-1.5 py-px">
            {changedCount} unsaved change{changedCount === 1 ? "" : "s"}
          </span>
        )}

        {isRepoReady && (
          <div className="ml-3">
            <BranchActionsBar
              onNewBranch={() => setDialog({ kind: "newBranch" })}
              onCommit={() => setDialog({ kind: "commit" })}
              onSync={() => setDialog({ kind: "sync" })}
              changedCount={changedCount}
              busy={busy}
            />
          </div>
        )}

        <div className="flex-1" />
        <button
          onClick={() => setShowBranchMap(false)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          title="Back to Project"
        >
          <ArrowLeft size={12} />
          <span>Back</span>
        </button>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-1 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Conflict banner — when a merge/pull is paused mid-conflict. */}
      {conflict?.inProgress && (
        <ConflictBanner projectPath={activeProjectPath} conflict={conflict} />
      )}

      {/* First-visit coaching — shown once. */}
      {isRepoReady && (
        <BranchCoachTip tipKey="intro" title="New to branches? Here's the idea">
          A <strong>branch</strong> is a safe space to try changes without touching{" "}
          <strong>main</strong> — the version you're happy to ship. When an experiment works,
          hover its lane and choose <em>Make it official</em> to bring it into main.
        </BranchCoachTip>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">{body}</div>

      {/* Guardrail dialogs */}
      <NewBranchDialog
        open={dialog.kind === "newBranch"}
        projectPath={activeProjectPath}
        onClose={closeDialog}
      />
      <CommitDialog
        open={dialog.kind === "commit"}
        projectPath={activeProjectPath}
        changedCount={changedCount}
        suggestion={commitSuggestion}
        onClose={closeDialog}
      />
      {dialog.kind === "switch" && (
        <SwitchBranchDialog
          open
          projectPath={activeProjectPath}
          targetBranch={dialog.name}
          dirtyFiles={dialog.dirtyFiles}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === "delete" && (
        <DeleteBranchDialog
          open
          projectPath={activeProjectPath}
          branch={dialog.name}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === "merge" && (
        <MergeConfirmDialog
          open
          projectPath={activeProjectPath}
          source={dialog.name}
          currentBranch={status?.branch ?? null}
          onClose={closeDialog}
        />
      )}
      <SyncDialog
        open={dialog.kind === "sync"}
        projectPath={activeProjectPath}
        onClose={closeDialog}
      />
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-text-dim text-label">
      <Loader2 size={14} className="animate-spin" />
      <span>Reading your branches…</span>
    </div>
  );
}
