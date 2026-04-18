// ═══════════════════════════════════════════════════════════════════════
// Self-Drive Decision Card — center-aligned orchestrator action in chat
// ═══════════════════════════════════════════════════════════════════════

import { useState } from "react";
import {
  CheckCircle2,
  Wrench,
  ShieldCheck,
  ShieldAlert,
  TestTube,
  Pause,
  XCircle,
  Hammer,
  GitCommit,
  AlertTriangle,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { formatTime } from "../../lib/format-utils";
import { useSelfDriveStore } from "../../stores/selfDriveStore";

interface SelfDriveEventData {
  action: string;
  summary: string;
  confidence: string;
  sessionIndex: number;
  phase: string;
  blocker?: {
    id: string;
    kind: string;
    summary: string;
    optionsOffered: string[];
    resolutionCriteria: string;
    status: "open" | "user-decided" | "verifying" | "resolved" | "abandoned";
  };
}

interface Props {
  event: SelfDriveEventData;
  timestamp: string;
}

interface ActionStyle {
  icon: LucideIcon;
  bg: string;
  border: string;
  text: string;
  label: string;
}

const ACTION_STYLES: Record<string, ActionStyle> = {
  advance: {
    icon: CheckCircle2,
    bg: "rgba(34, 197, 94, 0.1)",
    border: "rgba(34, 197, 94, 0.3)",
    text: "var(--color-green, #22c55e)",
    label: "Advance",
  },
  fix: {
    icon: Wrench,
    bg: "rgba(234, 179, 8, 0.1)",
    border: "rgba(234, 179, 8, 0.3)",
    text: "var(--yellow, #eab308)",
    label: "Fix",
  },
  verify: {
    icon: ShieldCheck,
    bg: "rgba(99, 102, 241, 0.1)",
    border: "rgba(99, 102, 241, 0.3)",
    text: "var(--accent)",
    label: "Verify",
  },
  build_check: {
    icon: Hammer,
    bg: "rgba(99, 102, 241, 0.1)",
    border: "rgba(99, 102, 241, 0.3)",
    text: "var(--accent)",
    label: "Build Check",
  },
  test: {
    icon: TestTube,
    bg: "rgba(99, 102, 241, 0.1)",
    border: "rgba(99, 102, 241, 0.3)",
    text: "var(--accent)",
    label: "Test",
  },
  commit: {
    icon: GitCommit,
    bg: "rgba(99, 102, 241, 0.1)",
    border: "rgba(99, 102, 241, 0.3)",
    text: "var(--accent)",
    label: "Commit",
  },
  pause: {
    icon: Pause,
    bg: "rgba(234, 179, 8, 0.1)",
    border: "rgba(234, 179, 8, 0.3)",
    text: "var(--yellow, #eab308)",
    label: "Paused",
  },
  abort: {
    icon: XCircle,
    bg: "rgba(239, 68, 68, 0.1)",
    border: "rgba(239, 68, 68, 0.3)",
    text: "var(--red, #ef4444)",
    label: "Aborted",
  },
};

const DEFAULT_STYLE: ActionStyle = {
  icon: ShieldAlert,
  bg: "rgba(99, 102, 241, 0.1)",
  border: "rgba(99, 102, 241, 0.3)",
  text: "var(--accent)",
  label: "Self-Drive",
};

export default function SelfDriveDecisionCard({ event, timestamp }: Props) {
  // Blocker variant: render an actionable card with options + free text.
  if (event.blocker) {
    return <BlockerCard blocker={event.blocker} timestamp={timestamp} />;
  }

  const style = ACTION_STYLES[event.action] ?? DEFAULT_STYLE;
  const Icon = style.icon;

  return (
    <div className="flex justify-center my-3">
      <div
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-detail font-medium max-w-[85%]"
        style={{
          background: style.bg,
          border: `1px solid ${style.border}`,
          color: style.text,
        }}
      >
        <Icon size={13} className="shrink-0" />
        <span className="truncate">
          Self-Drive: {event.summary}
        </span>
        <span className="shrink-0 opacity-50 text-detail">
          {formatTime(timestamp)}
        </span>
      </div>
    </div>
  );
}

// ─── BlockerCard ───────────────────────────────────────────────────────
// Shown when Self-Drive pauses on a structured blocker. The user picks an
// offered option (or types a free-form resolution) and Resume triggers
// a recovery verification against Claude Code before the session continues.

interface BlockerCardProps {
  blocker: NonNullable<SelfDriveEventData["blocker"]>;
  timestamp: string;
}

function BlockerCard({ blocker, timestamp }: BlockerCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const activeBlocker = useSelfDriveStore((s) => s.activeBlocker);
  const pickBlockerOption = useSelfDriveStore((s) => s.pickBlockerOption);
  const status = useSelfDriveStore((s) => s.status);

  // Is this card still the live one? We match by id so stale cards (from a
  // previous paused run, or after resolution) show a resolved-looking state.
  const isLive = activeBlocker?.id === blocker.id && status === "paused";
  const cardStatus: typeof blocker.status = isLive ? blocker.status : "resolved";

  const pickOption = async (resolution: string): Promise<void> => {
    if (!isLive || submitting) return;
    setSubmitting(true);
    try {
      await pickBlockerOption(resolution);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center my-3">
      <div
        className="w-full max-w-[640px] rounded-xl border p-4 text-label"
        style={{
          background: "rgba(234, 179, 8, 0.08)",
          borderColor: "rgba(234, 179, 8, 0.4)",
          color: "var(--text-primary)",
        }}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--yellow, #eab308)" }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">Blocker</span>
              <span
                className="px-1.5 py-0.5 rounded text-detail uppercase tracking-wide"
                style={{ background: "rgba(0,0,0,0.15)", color: "var(--text-secondary)" }}
              >
                {blocker.kind}
              </span>
              <span className="shrink-0 opacity-50 text-detail">{formatTime(timestamp)}</span>
            </div>
            <p className="mt-1" style={{ color: "var(--text-primary)" }}>
              {blocker.summary}
            </p>
            <p className="mt-1 text-detail" style={{ color: "var(--text-secondary)" }}>
              <span className="opacity-70">Resolution criteria:</span>{" "}
              {blocker.resolutionCriteria}
            </p>
          </div>
        </div>

        {cardStatus === "open" && (
          <>
            {blocker.optionsOffered.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                <p className="text-detail opacity-70">Pick an option (one click resolves + resumes):</p>
                {blocker.optionsOffered.map((opt, i) => (
                  <button
                    key={i}
                    disabled={submitting}
                    onClick={() => pickOption(opt)}
                    className="text-left px-3 py-1.5 rounded border text-label transition-colors hover:bg-bg-elevated disabled:opacity-50"
                    style={{ borderColor: "var(--border-light)", color: "var(--text-primary)" }}
                  >
                    {i + 1}. {opt}
                  </button>
                ))}
              </div>
            )}

            <div
              className="mt-3 flex items-start gap-2 p-2 rounded"
              style={{ background: "rgba(0,0,0,0.08)" }}
            >
              <MessageSquare size={13} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
              <p className="text-detail leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {blocker.optionsOffered.length > 0
                  ? "Or answer in the main chat below"
                  : "Answer in the main chat below"}
                  {" "}— Claude Code's reply will be captured. Then click{" "}
                <span className="font-medium" style={{ color: "var(--text-primary)" }}>Resume</span>{" "}
                in the Guide panel.
              </p>
            </div>
          </>
        )}

        {cardStatus !== "open" && (
          <p className="mt-3 text-detail" style={{ color: "var(--text-secondary)" }}>
            Status: {cardStatus}
            {activeBlocker?.userResolution && ` · ${activeBlocker.userResolution.split("\n")[0].slice(0, 120)}`}
          </p>
        )}
      </div>
    </div>
  );
}
