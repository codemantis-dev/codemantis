import { useState, useCallback } from "react";
import { FolderOpen, FolderPlus, AlertTriangle } from "lucide-react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { readFileTree } from "../../lib/tauri-commands";
import TemplatePicker from "../modals/TemplatePicker";
import type { TaskPlan } from "../../types/task-board";

type Mode = "choosing" | "template";

const PROJECT_MARKERS = [
  "package.json", "Cargo.toml", "pyproject.toml", "go.mod", "pom.xml",
  "build.gradle", "Gemfile", "composer.json", "requirements.txt", "setup.py",
  "pubspec.yaml", ".sln", "mix.exs",
];

interface Props {
  projectPath: string;
  plan: TaskPlan;
  onSwitchProject: (path: string) => Promise<void>;
}

export default function ProjectTargetDecision({ projectPath, plan, onSwitchProject }: Props) {
  const setProjectTarget = useTaskBoardStore((s) => s.setProjectTarget);
  const migratePlanToProject = useTaskBoardStore((s) => s.migratePlanToProject);

  const [mode, setMode] = useState<Mode>("choosing");
  const [showWarning, setShowWarning] = useState(false);
  const [detectedMarkers, setDetectedMarkers] = useState<string[]>([]);

  const handleCurrentProject = useCallback(async () => {
    try {
      const tree = await readFileTree(projectPath);
      const topLevelNames = tree.map((node) => node.name);
      const found = PROJECT_MARKERS.filter((m) => topLevelNames.includes(m));
      if (found.length > 0) {
        setDetectedMarkers(found);
        setShowWarning(true);
        return;
      }
    } catch {
      // If file tree read fails, proceed anyway
    }
    setProjectTarget(projectPath, { type: "current_project" });
  }, [projectPath, setProjectTarget]);

  const handleTemplateCreated = useCallback(
    async (newPath: string) => {
      migratePlanToProject(projectPath, newPath);
      await onSwitchProject(newPath);
    },
    [projectPath, migratePlanToProject, onSwitchProject]
  );

  const basename = projectPath.split("/").pop() ?? projectPath;

  // -- Existing project warning --
  if (showWarning) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: "#f59e0b", background: "var(--bg-secondary)" }}>
        <div className="flex items-start gap-2 mb-3">
          <AlertTriangle size={16} style={{ color: "#f59e0b" }} className="shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              This folder already contains a project
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
              Found: {detectedMarkers.join(", ")}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setShowWarning(false);
              setProjectTarget(projectPath, { type: "current_project" });
            }}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Continue Anyway
          </button>
          <button
            onClick={() => {
              setShowWarning(false);
              setMode("template");
            }}
            className="px-3 py-1.5 rounded-md border text-xs font-medium transition-colors hover:bg-bg-elevated"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Choose Different Folder
          </button>
          <button
            onClick={() => setShowWarning(false)}
            className="px-3 py-1.5 rounded-md border text-xs transition-colors hover:bg-bg-elevated"
            style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // -- Template picker --
  if (mode === "template") {
    return (
      <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setMode("choosing")}
            className="text-xs px-2 py-1 rounded hover:bg-bg-elevated transition-colors"
            style={{ color: "var(--text-dim)" }}
          >
            Back
          </button>
          <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
            Pick a template
          </span>
        </div>
        <div>
          <TemplatePicker
            onProjectCreated={handleTemplateCreated}
            preselectedTemplateId={plan.template_recommendation ?? undefined}
          />
        </div>
      </div>
    );
  }

  // -- Choosing mode --
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--accent)", background: "var(--bg-secondary)" }}>
      <div className="text-xs font-medium mb-1" style={{ color: "var(--text-primary)" }}>
        Where should this plan execute?
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--text-dim)" }}>
        Choose whether to work in the current project or create a new one.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {/* Current Project */}
        <button
          onClick={handleCurrentProject}
          className="flex flex-col items-center gap-2 p-3 rounded-md border transition-colors hover:border-accent/50"
          style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}
        >
          <FolderOpen size={20} style={{ color: "var(--accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
            Use Current Project
          </span>
          <span
            className="text-xs truncate max-w-full"
            style={{ color: "var(--text-dim)" }}
            title={projectPath}
          >
            {basename}
          </span>
        </button>

        {/* New Project — goes directly to template picker */}
        <button
          onClick={() => setMode("template")}
          className="flex flex-col items-center gap-2 p-3 rounded-md border transition-colors hover:border-accent/50"
          style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}
        >
          <FolderPlus size={20} style={{ color: "var(--accent)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
            Create New Project
          </span>
        </button>
      </div>

      {plan.template_recommendation && (
        <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          AI recommends: <span style={{ color: "var(--accent)" }}>{plan.template_recommendation}</span>
        </p>
      )}
    </div>
  );
}
