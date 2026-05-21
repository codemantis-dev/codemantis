import { useEffect, useState } from "react";
import { SectionTitle } from "./SettingsShared";
import { useUiStore } from "../../../stores/uiStore";
import { checkClaudeStatus, checkCodexStatus } from "../../../lib/tauri-commands";
import type { AgentId } from "../../../types/agent-events";

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
    </div>
  );
}
