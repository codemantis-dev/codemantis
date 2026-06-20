import { useEffect, useState } from "react";
import { SectionTitle, FieldRow } from "./SettingsShared";
import { useUiStore } from "../../../stores/uiStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { checkClaudeStatus, checkCodexStatus } from "../../../lib/tauri-commands";
import type { AgentId } from "../../../types/agent-events";
import { TASK_CATEGORIES, TASK_CATEGORY_META, type TaskCategory } from "../../../types/task-category";
import { handleError } from "../../../lib/error-handler";
import AgentCostBreakdown from "./AgentCostBreakdown";

type AgentInstallState =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "installed"; version: string | null; authenticated: boolean | null };

/**
 * Settings → Agents tab (Phase 2 §6). Surfaces every supported coding-
 * agent CLI, its detected install/auth status, and lets the user pick a
 * default for new sessions.
 *
 * v1.3.0 ships Claude Code + OpenAI Codex. v1.4.0 will add in-app login
 * + Codex install detection IPC; until then the Codex row shows
 * "expected on PATH" guidance.
 */

interface AgentRow {
  id: AgentId;
  label: string;
  tagline: string;
  installCmd: string;
  loginCmd: string;
  docsUrl: string;
}

const AGENTS: AgentRow[] = [
  {
    id: "claude_code",
    label: "Claude Code",
    tagline: "Anthropic's CLI — uses your Claude Pro/Max subscription.",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    loginCmd: "claude login   (or sign in via the welcome screen)",
    docsUrl: "https://claude.com/product/claude-code",
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    tagline:
      "ChatGPT-bundled coding agent — uses your ChatGPT subscription, no separate OpenAI API key needed.",
    installCmd: "npm install -g @openai/codex   # or: brew install codex",
    loginCmd: "codex login",
    docsUrl: "https://developers.openai.com/codex/auth",
  },
];

export default function AgentsTab(): React.ReactElement {
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const [statuses, setStatuses] = useState<Record<AgentId, AgentInstallState>>({
    claude_code: { kind: "checking" },
    codex: { kind: "checking" },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [claudeRes, codexRes] = await Promise.allSettled([
        checkClaudeStatus(),
        checkCodexStatus(),
      ]);
      if (cancelled) return;
      const claudeState: AgentInstallState =
        claudeRes.status === "fulfilled" && claudeRes.value.installed
          ? {
              kind: "installed",
              version: claudeRes.value.parsed_version ?? claudeRes.value.version ?? null,
              authenticated: claudeRes.value.authenticated ?? null,
            }
          : { kind: "missing" };
      const codexState: AgentInstallState =
        codexRes.status === "fulfilled" && codexRes.value.installed
          ? {
              kind: "installed",
              version: codexRes.value.parsed_version ?? codexRes.value.version ?? null,
              authenticated: codexRes.value.authenticated,
            }
          : { kind: "missing" };
      setStatuses({ claude_code: claudeState, codex: codexState });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openDocs = (url: string): void => {
    void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url));
  };

  return (
    <div>
      <SectionTitle>Agents</SectionTitle>
      <p className="text-label text-text-secondary mb-4">
        CodeMantis can route each session through either of two coding-agent
        CLIs. Phase 2 (v1.3.0) lands the OpenAI Codex adapter alongside the
        existing Claude Code one. The default below is used for new sessions
        when the project picker doesn't override it; the agent picker on
        the project-open flow always wins.
      </p>

      <div className="flex flex-col gap-3">
        {AGENTS.map((a) => {
          const isDefault = selectedAgentId === a.id;
          const status = statuses[a.id];
          let installState: string;
          let badgeColor = "var(--text-secondary)";
          if (status.kind === "checking") {
            installState = "checking…";
          } else if (status.kind === "missing") {
            installState = "not installed";
            badgeColor = "var(--red, #ef4444)";
          } else {
            const v = status.version ? ` ${status.version}` : "";
            const authNote =
              status.authenticated === false
                ? " · not signed in"
                : status.authenticated === true
                ? " · signed in"
                : "";
            installState = `installed${v}${authNote}`;
            badgeColor =
              status.authenticated === false
                ? "var(--warning, #d97706)"
                : "var(--green, #10b981)";
          }
          return (
            <div
              key={a.id}
              className={`rounded-lg border p-4 transition-colors ${
                isDefault
                  ? "border-accent bg-accent-dim"
                  : "border-border bg-bg-subtle"
              }`}
              data-testid={`agents-tab-row-${a.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-ui font-medium text-text-primary">
                      {a.label}
                    </span>
                    <span
                      className="text-label px-2 py-0.5 rounded-md"
                      style={{
                        background: "var(--bg-elevated)",
                        color: badgeColor,
                      }}
                    >
                      {installState}
                    </span>
                  </div>
                  <p className="text-label text-text-secondary mt-1">
                    {a.tagline}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedAgentId(a.id)}
                  disabled={isDefault}
                  className={`text-label px-3 py-1 rounded-md transition-colors shrink-0 ${
                    isDefault
                      ? "bg-accent text-white cursor-default"
                      : "bg-bg-elevated text-text-secondary hover:border-accent/40 border border-border"
                  }`}
                  data-testid={`agents-tab-default-${a.id}`}
                >
                  {isDefault ? "Default" : "Make default"}
                </button>
              </div>

              <div className="mt-3 pt-3 border-t border-border-light grid gap-1 text-label text-text-ghost">
                <div>
                  <span className="text-text-secondary">Install:</span>{" "}
                  <code className="px-1 py-0.5 rounded bg-bg-elevated">
                    {a.installCmd}
                  </code>
                </div>
                <div>
                  <span className="text-text-secondary">Sign in:</span>{" "}
                  <code className="px-1 py-0.5 rounded bg-bg-elevated">
                    {a.loginCmd}
                  </code>
                </div>
                <button
                  onClick={() => openDocs(a.docsUrl)}
                  className="text-label mt-1 text-left hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {a.docsUrl} →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-label text-text-ghost mt-4">
        Each session is owned by exactly one agent for its lifetime. To
        switch agents on a project, close the session and open a new one
        with the other agent selected.
      </p>

      <SessionLimitField />

      <PerTaskDefaults statuses={statuses} primary={selectedAgentId} />
    </div>
  );
}

/**
 * Configurable cap on how many coding-agent session tabs can be open at
 * once. Enforced in `useClaudeSession` (startSession / resumeFromHistory).
 * Default 20; clamped to 1–100.
 */
const MIN_CODING_AGENT_SESSIONS = 1;
const MAX_CODING_AGENT_SESSIONS = 100;

function SessionLimitField(): React.ReactElement {
  const maxCodingAgentSessions = useSettingsStore(
    (s) => s.settings.maxCodingAgentSessions,
  );
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const setLimit = (raw: number): void => {
    const clamped = Math.max(
      MIN_CODING_AGENT_SESSIONS,
      Math.min(MAX_CODING_AGENT_SESSIONS, Math.round(raw)),
    );
    updateSettings({ maxCodingAgentSessions: clamped }).catch((e) =>
      handleError("AgentsTab.setSessionLimit", e),
    );
  };

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <h3 className="text-ui font-medium text-text-primary mb-1">Sessions</h3>
      <p className="text-label text-text-secondary mb-3">
        Maximum number of coding-agent session tabs you can keep open at once.
      </p>
      <FieldRow label={`Max open sessions (${MIN_CODING_AGENT_SESSIONS}–${MAX_CODING_AGENT_SESSIONS})`}>
        <input
          type="number"
          min={MIN_CODING_AGENT_SESSIONS}
          max={MAX_CODING_AGENT_SESSIONS}
          value={maxCodingAgentSessions}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="w-16 px-3 py-1.5 rounded-md text-ui bg-bg-elevated border border-border text-text-primary text-center"
          data-testid="agents-tab-max-sessions"
        />
      </FieldRow>
    </div>
  );
}

/**
 * v1.5.0 Phase 1 — per-task agent routing table. Each task category
 * gets a dropdown: "Use primary" (defer to the global default above)
 * or a specific agent. Saved into `settings.defaultAgentByTask`; the
 * resolver (`src/lib/agent-resolver.ts`) reads it at every session
 * spawn. Categories left at "Use primary" preserve existing behaviour.
 */
function PerTaskDefaults({
  statuses,
  primary,
}: {
  statuses: Record<AgentId, AgentInstallState>;
  primary: AgentId;
}): React.ReactElement {
  const byTask = useSettingsStore((s) => s.settings.defaultAgentByTask);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const isInstalled = (id: AgentId): boolean => statuses[id].kind === "installed";

  const setTask = (task: TaskCategory, value: AgentId | "primary"): void => {
    const next: Partial<Record<TaskCategory, AgentId>> = { ...byTask };
    if (value === "primary") {
      delete next[task];
    } else {
      next[task] = value;
    }
    updateSettings({ defaultAgentByTask: next }).catch((e) =>
      handleError("AgentsTab.setTask", e),
    );
  };

  const reset = (): void => {
    updateSettings({ defaultAgentByTask: {} }).catch((e) =>
      handleError("AgentsTab.resetTasks", e),
    );
  };

  const hasOverrides = Object.keys(byTask).length > 0;

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <h3 className="text-ui font-medium text-text-primary mb-1">
        Per-task defaults
      </h3>
      <p className="text-label text-text-secondary mb-3">
        Pick the agent for each kind of work. Categories left at{" "}
        <em>Use primary</em> defer to the default above. The agent picker
        on the project-open flow still overrides per session.
      </p>

      <div className="flex flex-col gap-1.5" data-testid="per-task-defaults">
        {TASK_CATEGORIES.map((task) => {
          const meta = TASK_CATEGORY_META[task];
          const current: AgentId | "primary" = byTask[task] ?? "primary";
          return (
            <div key={task} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <span className="text-label text-text-primary">{meta.label}</span>
                <span className="text-fine text-text-ghost block truncate">
                  {meta.description}
                </span>
              </div>
              <select
                value={current}
                onChange={(e) =>
                  setTask(task, e.target.value as AgentId | "primary")
                }
                className="px-2 py-1 rounded-md border text-label shrink-0"
                style={{
                  background: "var(--bg-primary)",
                  borderColor: "var(--border)",
                  color: "var(--text-primary)",
                }}
                data-testid={`per-task-select-${task}`}
              >
                <option value="primary">Use primary</option>
                <option value="claude_code" disabled={!isInstalled("claude_code")}>
                  Claude Code{isInstalled("claude_code") ? "" : " (not installed)"}
                </option>
                <option value="codex" disabled={!isInstalled("codex")}>
                  Codex{isInstalled("codex") ? "" : " (not installed)"}
                </option>
              </select>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={reset}
          disabled={!hasOverrides}
          className="text-label px-2.5 py-1 rounded-md border border-border text-text-secondary hover:border-accent/40 disabled:opacity-40 disabled:cursor-default transition-colors"
          data-testid="per-task-reset"
        >
          Reset to defaults
        </button>
        <span className="text-fine text-text-ghost">
          Primary is currently{" "}
          <span className="text-text-secondary">
            {primary === "codex" ? "Codex" : "Claude Code"}
          </span>
          .
        </span>
      </div>

      <h3 className="text-ui font-medium text-text-primary mt-6 mb-1">
        Usage split (last 7 days)
      </h3>
      <p className="text-label text-text-secondary mb-3">
        How your sessions divided between the two subscription pools.
      </p>
      <AgentCostBreakdown />
    </div>
  );
}
