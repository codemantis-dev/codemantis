import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Play,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  ShieldCheck,
} from "lucide-react";
import type { GuideSession } from "../../types/implementation-guide";
import { showToast } from "../../stores/toastStore";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { buildSessionVerifyPrompt } from "../../lib/guide-verify-prompt";

interface Props {
  session: GuideSession;
  specFilename: string;
  auditFilename: string | null;
  onToggleVerifyCheck: (checkId: string) => void;
  onMarkComplete: () => void;
  onMarkPromptSent: () => void;
  onMarkVerifyRequested: () => void;
}

export default function GuideSessionCard({
  session,
  specFilename,
  auditFilename,
  onToggleVerifyCheck,
  onMarkComplete,
  onMarkPromptSent,
  onMarkVerifyRequested,
}: Props) {
  const [expanded, setExpanded] = useState(session.status === "active");
  const [filesExpanded, setFilesExpanded] = useState(false);

  const isDone = session.status === "done";
  const isActive = session.status === "active";
  const isPending = session.status === "pending";

  const allChecked =
    session.verifyChecks.length === 0 ||
    session.verifyChecks.every((c) => c.checked);
  const checkedCount = session.verifyChecks.filter((c) => c.checked).length;

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(session.prompt).then(
      () => showToast("Prompt copied to clipboard", "success"),
      () => showToast("Failed to copy prompt", "error"),
    );
  };

  const handleSendToChat = () => {
    const activeSessionId = useSessionStore.getState().activeSessionId;
    if (!activeSessionId) {
      showToast("No active Claude Code session. Start one first.", "info");
      return;
    }
    useUiStore.getState().setDraftInput(session.prompt);
    onMarkPromptSent();
    showToast("Prompt pasted into chat. Review and press Enter to send.", "info");
  };

  const handleVerifyForMe = () => {
    const activeSessionId = useSessionStore.getState().activeSessionId;
    if (!activeSessionId) {
      showToast("No active Claude Code session. Start one first.", "info");
      return;
    }

    const verifyPrompt = buildSessionVerifyPrompt(session, specFilename, auditFilename);

    useUiStore.getState().setDraftInput(verifyPrompt);
    onMarkVerifyRequested();
    showToast("Verification prompt pasted into chat. Review and press Enter to send.", "info");
  };

  // Border color by status
  const borderColor = isDone
    ? "var(--color-green, #22c55e)"
    : isActive
      ? "var(--accent)"
      : "var(--border-light)";

  return (
    <div
      className="rounded-lg overflow-hidden transition-all"
      style={{
        background: "var(--bg-primary)",
        border: `1px solid ${isDone ? "var(--color-green, #22c55e)" : isActive ? "var(--accent)" : "var(--border-light)"}`,
        borderLeftWidth: 3,
        borderLeftColor: borderColor,
        opacity: isPending ? 0.7 : 1,
      }}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-elevated/50"
      >
        {/* Status icon */}
        {isDone ? (
          <CheckCircle2 size={14} style={{ color: "var(--color-green, #22c55e)" }} className="shrink-0" />
        ) : isActive ? (
          <Play size={14} style={{ color: "var(--accent)" }} className="shrink-0" />
        ) : (
          <Circle size={14} style={{ color: "var(--text-ghost)" }} className="shrink-0" />
        )}

        {/* Title */}
        <span
          className="flex-1 text-xs font-medium truncate"
          style={{ color: isDone ? "var(--text-secondary)" : "var(--text-primary)" }}
        >
          Session {session.index}: {session.name}
        </span>

        {/* Active badge */}
        {isActive && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
            style={{ background: "var(--accent)", color: "white" }}
          >
            CURRENT
          </span>
        )}

        {/* Done summary */}
        {isDone && (
          <span className="text-[10px] shrink-0" style={{ color: "var(--text-ghost)" }}>
            All checks passed
          </span>
        )}

        {/* Expand chevron */}
        {expanded ? (
          <ChevronDown size={12} style={{ color: "var(--text-ghost)" }} className="shrink-0" />
        ) : (
          <ChevronRight size={12} style={{ color: "var(--text-ghost)" }} className="shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t" style={{ borderColor: "var(--border-light)" }}>
          {/* Scope & Read sections */}
          {(session.scope || session.readSections) && (
            <div className="pt-2 space-y-1">
              {session.scope && (
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  <span className="font-medium">Scope:</span> {session.scope}
                </p>
              )}
              {session.readSections && (
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  <span className="font-medium">Read:</span> {session.readSections}
                </p>
              )}
            </div>
          )}

          {/* Files list */}
          {session.files.length > 0 && (
            <div>
              <button
                onClick={() => setFilesExpanded(!filesExpanded)}
                className="flex items-center gap-1 text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                <FileText size={11} />
                {session.files.length} file{session.files.length > 1 ? "s" : ""}
                {filesExpanded ? (
                  <ChevronDown size={10} />
                ) : (
                  <ChevronRight size={10} />
                )}
              </button>
              {filesExpanded && (
                <div className="mt-1 ml-3 space-y-0.5">
                  {session.files.map((f) => (
                    <p
                      key={f}
                      className="text-[10px] font-mono truncate"
                      style={{ color: "var(--text-ghost)" }}
                    >
                      {f}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Prompt actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyPrompt}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors hover:opacity-90"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              <Copy size={11} />
              Copy Prompt
            </button>
            <button
              onClick={handleSendToChat}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors hover:opacity-90"
              style={{
                background: "var(--accent)",
                color: "white",
              }}
            >
              <Play size={11} />
              Send to Chat
            </button>
            {session.promptSent && (
              <Check size={14} strokeWidth={3} style={{ color: "var(--color-green, #22c55e)" }} />
            )}
          </div>

          {/* Verify checklist */}
          {session.verifyChecks.length > 0 && (
            <div className="space-y-1">
              <p
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Verify before next session:
              </p>
              {session.verifyChecks.map((check) => (
                <label
                  key={check.id}
                  className="flex items-start gap-2 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={check.checked}
                    onChange={() => onToggleVerifyCheck(check.id)}
                    className="mt-0.5 shrink-0 accent-[var(--accent)]"
                  />
                  <span
                    className="text-[11px] leading-snug"
                    style={{
                      color: check.checked
                        ? "var(--text-ghost)"
                        : "var(--text-secondary)",
                      textDecoration: check.checked ? "line-through" : "none",
                    }}
                  >
                    {check.label}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Verify for me */}
          {isActive && session.verifyChecks.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleVerifyForMe}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors hover:brightness-95"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                <ShieldCheck size={11} />
                Verify for me
              </button>
              {session.verifyRequested && (
                <Check size={14} strokeWidth={3} style={{ color: "var(--color-green, #22c55e)" }} />
              )}
            </div>
          )}

          {/* Mark complete button */}
          {isActive && (
            <button
              onClick={onMarkComplete}
              disabled={!allChecked}
              className="w-full py-1.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40"
              style={{
                background: allChecked ? "var(--color-green, #22c55e)" : "var(--bg-elevated)",
                color: allChecked ? "white" : "var(--text-ghost)",
                border: allChecked ? "none" : "1px solid var(--border)",
              }}
            >
              {allChecked
                ? "Mark Session Complete"
                : `${checkedCount}/${session.verifyChecks.length} checks — complete all to continue`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
