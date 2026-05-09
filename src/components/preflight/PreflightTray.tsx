// Always-visible 48px strip at the top of a project workspace. Three states:
//   - green:  "X/X ready" — everything's set up
//   - yellow: "X/Y ready · N need attention" — some missing
//   - red:    "<service> invalid · Self-Drive paused" — mid-run failure
//
// Click → opens Mission Control. The tray is the user's at-a-glance pulse;
// Mission Control is where they actually fix things.

import { Check, AlertTriangle, AlertCircle } from "lucide-react";
import type { PreflightStatus } from "../../types/preflight";

export type TrayMode = "ready" | "attention" | "paused";

interface PreflightTrayProps {
  status: PreflightStatus | null;
  /**
   * When the orchestrator is paused mid-run, the parent passes a paused
   * descriptor so the tray flips to its red state with the right message.
   */
  pausedReason?: { capabilityName: string } | null;
  onOpenMissionControl: () => void;
}

export default function PreflightTray({
  status,
  pausedReason,
  onOpenMissionControl,
}: PreflightTrayProps) {
  const mode = computeMode(status, pausedReason);
  const config = TRAY_CONFIG[mode];

  // Don't render at all if there's nothing to track yet — avoids a blank
  // strip on legacy projects without a manifest.
  if (!status && !pausedReason) return null;

  const ready = (status?.capabilities ?? []).filter(
    (c) => c.state === "satisfied",
  ).length;
  const total = status?.capabilities.length ?? 0;
  const missing = total - ready;

  let summary: string;
  if (mode === "paused" && pausedReason) {
    summary = `${pausedReason.capabilityName} needs attention — Self-Drive paused`;
  } else if (mode === "ready") {
    summary = `${total}/${total} ready`;
  } else {
    summary = `${ready}/${total} ready · ${missing} need${missing === 1 ? "s" : ""} attention`;
  }

  return (
    <div
      data-testid="preflight-tray"
      data-mode={mode}
      className="h-12 flex items-center justify-between px-4 border-b"
      style={{
        background: config.background,
        borderColor: config.borderColor,
        color: config.textColor,
      }}
    >
      <div className="flex items-center gap-2 text-ui">
        <config.Icon size={14} />
        <span className="font-medium">{summary}</span>
      </div>
      <button
        type="button"
        onClick={onOpenMissionControl}
        className="text-detail underline-offset-2 hover:underline"
        style={{ color: config.textColor }}
      >
        {mode === "paused" ? "Fix now" : "View Mission Control"}
      </button>
    </div>
  );
}

function computeMode(
  status: PreflightStatus | null,
  pausedReason: { capabilityName: string } | null | undefined,
): TrayMode {
  if (pausedReason) return "paused";
  if (!status) return "attention";
  if (status.allSatisfied) return "ready";
  return "attention";
}

const TRAY_CONFIG: Record<
  TrayMode,
  {
    background: string;
    borderColor: string;
    textColor: string;
    Icon: typeof Check;
  }
> = {
  ready: {
    background: "color-mix(in srgb, rgb(34, 197, 94) 12%, var(--bg-elevated))",
    borderColor: "color-mix(in srgb, rgb(34, 197, 94) 30%, var(--border))",
    textColor: "rgb(34, 197, 94)",
    Icon: Check,
  },
  attention: {
    background: "color-mix(in srgb, rgb(234, 179, 8) 10%, var(--bg-elevated))",
    borderColor: "color-mix(in srgb, rgb(234, 179, 8) 30%, var(--border))",
    textColor: "rgb(234, 179, 8)",
    Icon: AlertTriangle,
  },
  paused: {
    background: "color-mix(in srgb, rgb(239, 68, 68) 12%, var(--bg-elevated))",
    borderColor: "color-mix(in srgb, rgb(239, 68, 68) 30%, var(--border))",
    textColor: "rgb(239, 68, 68)",
    Icon: AlertCircle,
  },
};
