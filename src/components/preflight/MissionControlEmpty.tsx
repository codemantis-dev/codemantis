// MissionControlEmpty — shown when Mission Control is opened for a project
// that has no `preflight.yaml` manifest yet. Mission Control is reachable for
// any project (TitleBar button / Cmd+Shift+G), but capabilities are only
// tracked once SpecWriter generates a manifest on spec-save — so this state
// explains that path instead of rendering an empty capability list.

import { Rocket, PenTool } from "lucide-react";

interface MissionControlEmptyProps {
  /** Display name of the active project (for the heading). */
  projectName: string;
  /** Whether the project already has a saved spec (tailors the guidance). */
  hasSavedSpec?: boolean;
  /** Opens the SpecWriter slide-over for the active project. */
  onOpenSpecWriter: () => void;
}

export default function MissionControlEmpty({
  projectName,
  hasSavedSpec = false,
  onOpenSpecWriter,
}: MissionControlEmptyProps): React.ReactElement {
  return (
    <div
      className="w-full h-full overflow-auto"
      style={{ background: "var(--bg-primary)" }}
      data-testid="mission-control-empty"
    >
      <div className="max-w-2xl mx-auto px-6 py-16 flex flex-col items-center text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          <Rocket size={24} style={{ color: "var(--accent)" }} />
        </div>

        <h1 className="text-xl font-semibold text-text-primary mb-2">
          No capabilities tracked for{" "}
          <span style={{ color: "var(--accent)" }}>{projectName}</span> yet
        </h1>

        <p className="text-label text-text-secondary leading-relaxed max-w-lg mb-2">
          Mission Control checks the accounts, API keys, CLI tools, and services a
          project needs <em>before</em> Self-Drive starts building — so an
          autonomous run doesn't stall halfway on a missing prerequisite.
        </p>
        <p className="text-label text-text-secondary leading-relaxed max-w-lg mb-8">
          {hasSavedSpec
            ? "This project has a saved spec but no capability manifest. Re-save it in SpecWriter to generate one, and the tracked capabilities will appear here."
            : "A capability manifest (preflight.yaml) is generated automatically when you save a spec in SpecWriter. Write a spec to get started."}
        </p>

        <button
          type="button"
          onClick={onOpenSpecWriter}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-ui font-semibold transition-colors"
          style={{ background: "var(--accent)", color: "white" }}
        >
          <PenTool size={14} />
          Open SpecWriter
        </button>
      </div>
    </div>
  );
}
