import { useState, useRef, useEffect } from "react";
import { Download, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AgentId } from "../../types/agent-events";
import {
  installOrUpdateCli,
  listenCliSetupProgress,
} from "../../lib/tauri-commands";
import ErrorCard from "../shared/ErrorCard";

interface CliSetupButtonProps {
  agent: AgentId;
  /** "install" when the CLI is missing, "update" when it's outdated. */
  kind: "install" | "update";
  /** Called after a successful install/update so the caller can re-check status. */
  onDone: () => void;
  /** Optional release channel / version (e.g. "stable"). */
  channel?: string;
}

const AGENT_LABEL: Record<AgentId, string> = {
  claude_code: "Claude Code",
  codex: "OpenAI Codex",
};

/** npm-free native installers — what the in-app button actually runs. */
const MANUAL_COMMAND: Record<AgentId, string> = {
  claude_code: "curl -fsSL https://claude.ai/install.sh | bash",
  codex: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
};

/** Legacy npm path — shown only under "Advanced" for users who already have npm. */
const NPM_COMMAND: Record<AgentId, string> = {
  claude_code: "npm install -g @anthropic-ai/claude-code@latest",
  codex: "npm install -g @openai/codex",
};

/**
 * One-click install/update for a coding-agent CLI using its official npm-free
 * native installer. Non-developer macOS users typically have no npm, so this
 * runs the install in-app and streams progress instead of asking them to open a
 * terminal. The raw commands live under a collapsed "Advanced" disclosure.
 */
export default function CliSetupButton({
  agent,
  kind,
  onDone,
  channel,
}: CliSetupButtonProps): React.ReactElement {
  const [installing, setInstalling] = useState(false);
  const [lastLine, setLastLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const verb = kind === "install" ? "Install" : "Update";
  const label = `${verb} ${AGENT_LABEL[agent]}`;

  const handleClick = async (): Promise<void> => {
    if (installing) return;
    setInstalling(true);
    setError(null);
    setLastLine("Starting…");
    try {
      unlistenRef.current = await listenCliSetupProgress((p) => {
        if (p.agent === agent && p.line.trim()) setLastLine(p.line.trim());
      });
      const result = await installOrUpdateCli(agent, channel);
      if (result.success) {
        setLastLine(result.message);
        onDone();
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setInstalling(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={installing}
        className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 font-medium transition-opacity disabled:opacity-70"
        style={{
          background: "var(--accent)",
          color: "var(--accent-contrast, #fff)",
          fontSize: "13px",
        }}
        title={`${label} (no Terminal needed)`}
      >
        {installing ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Download size={14} />
        )}
        {installing ? `${verb}ing…` : label}
      </button>

      {installing && lastLine && (
        <p
          className="text-text-ghost font-mono mt-2 truncate"
          style={{ fontSize: "11px" }}
          title={lastLine}
        >
          {lastLine}
        </p>
      )}

      {error && (
        <ErrorCard
          compact
          title={`Couldn't ${verb.toLowerCase()} ${AGENT_LABEL[agent]} automatically`}
          message={`${error} — you can try the manual command under Advanced below.`}
          onDismiss={() => setError(null)}
        />
      )}

      {/* Advanced / manual fallback (curl + npm), collapsed by default */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1 text-text-ghost hover:text-text-dim transition-colors mt-2"
        style={{ fontSize: "11px" }}
      >
        {showAdvanced ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Show details / advanced
      </button>
      {showAdvanced && (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-text-dim" style={{ fontSize: "11px" }}>
            The button runs the official installer (no npm needed):
          </p>
          <code
            className="text-accent font-mono px-1.5 py-0.5 rounded inline-block"
            style={{
              fontSize: "11px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
            }}
          >
            {MANUAL_COMMAND[agent]}
          </code>
          <p className="text-text-dim" style={{ fontSize: "11px" }}>
            Or, if you already use npm:
          </p>
          <code
            className="text-text-dim font-mono px-1.5 py-0.5 rounded inline-block"
            style={{
              fontSize: "11px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
            }}
          >
            {NPM_COMMAND[agent]}
          </code>
        </div>
      )}
    </div>
  );
}
