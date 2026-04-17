// ═══════════════════════════════════════════════════════════════════════
// Self-Drive Decision Card — center-aligned orchestrator action in chat
// ═══════════════════════════════════════════════════════════════════════

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
  type LucideIcon,
} from "lucide-react";
import { formatTime } from "../../lib/format-utils";

interface SelfDriveEventData {
  action: string;
  summary: string;
  confidence: string;
  sessionIndex: number;
  phase: string;
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
