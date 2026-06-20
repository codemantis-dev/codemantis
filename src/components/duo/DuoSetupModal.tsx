/**
 * DuoSetupModal — configure a Duo-Coding run: the primary (sole writer) and the
 * read-only mentor, plus the task. Model + effort are live dropdowns sourced
 * from the per-agent capability cache (never hardcoded). Tie-break + analyst
 * come from Settings.
 */
import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { useDuoStore, resolveDuoSettings } from "../../stores/duoStore";
import { useCliModelCacheStore } from "../../stores/cliModelCacheStore";
import {
  resolveAgentModels,
  effortLevelsForModel,
  findModel,
} from "../../lib/agent-model-options";
import type { AgentId, CliModelInfo } from "../../types/agent-events";

interface Props {
  open: boolean;
  projectPath: string;
  onClose: () => void;
}

const AGENTS: { id: AgentId; label: string }[] = [
  { id: "claude_code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
];

const selectClass =
  "w-full mt-1 rounded px-2 py-1.5 text-detail disabled:opacity-50 disabled:cursor-not-allowed";
const selectStyle = {
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
} as const;

/** One agent's configuration column (primary or mentor). */
function AgentColumn({
  title,
  subtitle,
  agentId,
  model,
  effort,
  models,
  onAgent,
  onModel,
  onEffort,
}: {
  title: string;
  subtitle: string;
  agentId: AgentId;
  model: string;
  effort: string;
  models: CliModelInfo[];
  onAgent: (a: AgentId) => void;
  onModel: (m: string) => void;
  onEffort: (e: string) => void;
}): React.ReactElement {
  // Effort levels come from the selected model (or the default entry).
  const selected = findModel(models, model) ?? models.find((m) => m.isDefault) ?? models[0];
  const effortLevels = effortLevelsForModel(selected);

  return (
    <div
      className="rounded-md border p-3 flex flex-col gap-2"
      style={{ background: "var(--bg-subtle)", borderColor: "var(--border)" }}
    >
      <div className="text-detail font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </div>
      <div className="text-detail" style={{ color: "var(--text-dim)" }}>
        {subtitle}
      </div>

      <label className="text-detail" style={{ color: "var(--text-secondary)" }}>
        Agent
        <select
          aria-label={`${title} agent`}
          value={agentId}
          onChange={(e) => onAgent(e.target.value as AgentId)}
          className={selectClass}
          style={selectStyle}
        >
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-detail" style={{ color: "var(--text-secondary)" }}>
        Model
        <select
          aria-label={`${title} model`}
          value={model}
          onChange={(e) => onModel(e.target.value)}
          className={selectClass}
          style={selectStyle}
        >
          <option value="">Default</option>
          {models
            .filter((m) => m.value !== "default" && m.value !== "")
            .map((m) => (
              <option key={m.value} value={m.value}>
                {m.displayName}
              </option>
            ))}
        </select>
      </label>

      <label className="text-detail" style={{ color: "var(--text-secondary)" }}>
        Effort
        <select
          aria-label={`${title} effort`}
          value={effort}
          onChange={(e) => onEffort(e.target.value)}
          disabled={effortLevels.length === 0}
          className={selectClass}
          style={selectStyle}
        >
          <option value="">Default</option>
          {effortLevels.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl}
            </option>
          ))}
        </select>
        {effortLevels.length === 0 && (
          <span className="block mt-0.5 text-detail" style={{ color: "var(--text-dim)" }}>
            Uses the model default until a {agentId === "codex" ? "Codex" : "Claude Code"} session has run.
          </span>
        )}
      </label>
    </div>
  );
}

export default function DuoSetupModal({ open, projectPath, onClose }: Props): React.ReactElement | null {
  const [primaryAgent, setPrimaryAgent] = useState<AgentId>("codex");
  const [primaryModel, setPrimaryModel] = useState("");
  const [primaryEffort, setPrimaryEffort] = useState("");
  const [duoAgent, setDuoAgent] = useState<AgentId>("claude_code");
  const [duoModel, setDuoModel] = useState("");
  const [duoEffort, setDuoEffort] = useState("");
  const [task, setTask] = useState("");

  // Re-render when any session populates the per-agent model cache.
  const cachedModelsByAgent = useCliModelCacheStore((s) => s.models);
  const primaryModels = useMemo(
    () => resolveAgentModels(primaryAgent, cachedModelsByAgent),
    [primaryAgent, cachedModelsByAgent],
  );
  const duoModels = useMemo(
    () => resolveAgentModels(duoAgent, cachedModelsByAgent),
    [duoAgent, cachedModelsByAgent],
  );

  if (!open) return null;
  const settings = resolveDuoSettings();

  // Changing the agent invalidates the model/effort picks for that side.
  const changePrimaryAgent = (a: AgentId): void => {
    setPrimaryAgent(a);
    setPrimaryModel("");
    setPrimaryEffort("");
  };
  const changeDuoAgent = (a: AgentId): void => {
    setDuoAgent(a);
    setDuoModel("");
    setDuoEffort("");
  };

  const submit = (): void => {
    if (!task.trim()) return;
    void useDuoStore.getState().start({
      task: task.trim(),
      projectPath,
      primary: {
        agentId: primaryAgent,
        model: primaryModel || undefined,
        effort: primaryEffort || undefined,
      },
      duo: {
        agentId: duoAgent,
        model: duoModel || undefined,
        effort: duoEffort || undefined,
      },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border shadow-xl"
        style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center gap-2 px-4 py-3 border-b sticky top-0"
          style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}
        >
          <Users size={16} style={{ color: "var(--accent)" }} />
          <span className="text-ui font-semibold" style={{ color: "var(--text-primary)" }}>
            New Duo-Coding run
          </span>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <AgentColumn
              title="Primary"
              subtitle="Does the work — the sole writer."
              agentId={primaryAgent}
              model={primaryModel}
              effort={primaryEffort}
              models={primaryModels}
              onAgent={changePrimaryAgent}
              onModel={setPrimaryModel}
              onEffort={setPrimaryEffort}
            />
            <AgentColumn
              title="Mentor"
              subtitle="Reviews read-only — never edits files."
              agentId={duoAgent}
              model={duoModel}
              effort={duoEffort}
              models={duoModels}
              onAgent={changeDuoAgent}
              onModel={setDuoModel}
              onEffort={setDuoEffort}
            />
          </div>

          <label className="text-detail" style={{ color: "var(--text-secondary)" }}>
            Task
            <textarea
              aria-label="Task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
              placeholder="Describe what the pair should build…"
              className="w-full mt-1 rounded px-2 py-1.5 text-detail resize-none"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
          </label>

          <div className="text-detail" style={{ color: "var(--text-dim)" }}>
            Tie-break: <span style={{ color: "var(--text-secondary)" }}>{settings.tieBreakPolicy}</span>
            {" · "}Analyst: <span style={{ color: "var(--text-secondary)" }}>{settings.analystProvider}/{settings.analystModel}</span>
            {" · "}<span>configurable in Settings</span>
          </div>
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 py-3 border-t sticky bottom-0"
          style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-detail"
            style={{ color: "var(--text-secondary)", background: "var(--bg-elevated)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!task.trim()}
            className="px-3 py-1.5 rounded-md text-detail font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--bg-primary)", background: "var(--accent)" }}
          >
            Start run
          </button>
        </div>
      </div>
    </div>
  );
}
