// One-line summary card for a capability in Mission Control or other lists.
// Surfaces: icon, name, purpose, status pill, primary action.
// The action is intentionally a single button per row — non-tech users get
// confused by multiple options. If they need more, they enter the SetupFlow.

import { Check, AlertCircle, Loader2, Clock } from "lucide-react";
import type { Capability } from "../../types/preflight";
import type { CapabilityStatus } from "../../types/preflight";
import CapabilityIcon from "./icons/CapabilityIcon";

interface CapabilityCardProps {
  capability: Capability;
  status?: CapabilityStatus | null;
  /** Optional service-display name + category from the catalog entry. */
  serviceName?: string;
  serviceCategory?: string;
  /** Estimated minutes from the catalog entry's remediation. */
  estimatedMinutes?: number;
  /** Primary button label (e.g. "Set up", "Verify", "Update"). */
  actionLabel: string;
  onAction: () => void;
  /** Whether the action is currently busy (shows spinner + disables click). */
  busy?: boolean;
}

export default function CapabilityCard({
  capability,
  status,
  serviceName,
  serviceCategory,
  estimatedMinutes,
  actionLabel,
  onAction,
  busy,
}: CapabilityCardProps) {
  const display = serviceName ?? capability.name;
  const state = status?.state ?? "unknown";
  const isOptional = !capability.required;

  return (
    <div
      className="rounded-lg border p-4 flex items-center gap-4"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <CapabilityIcon
        serviceName={display}
        iconFile={null}
        category={serviceCategory}
        size={36}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-ui font-semibold text-text-primary truncate">
            {display}
          </span>
          {isOptional && (
            <span
              className="text-detail px-1.5 py-0.5 rounded"
              style={{ background: "var(--bg-subtle)", color: "var(--text-dim)" }}
            >
              Optional
            </span>
          )}
        </div>
        {capability.purpose && (
          <p className="text-label text-text-dim leading-snug truncate">
            {capability.purpose}
          </p>
        )}
        {estimatedMinutes && state !== "satisfied" && (
          <p className="text-detail text-text-ghost mt-1 flex items-center gap-1">
            <Clock size={11} />
            About {estimatedMinutes} {estimatedMinutes === 1 ? "minute" : "minutes"}
          </p>
        )}
      </div>
      <StatusPill state={state} />
      <button
        type="button"
        onClick={onAction}
        disabled={busy}
        className="px-3 py-1.5 rounded-md text-ui font-medium transition-colors shrink-0 disabled:opacity-50"
        style={{
          background: state === "satisfied" ? "var(--bg-subtle)" : "var(--accent)",
          color: state === "satisfied" ? "var(--text-secondary)" : "white",
        }}
      >
        {busy ? <Loader2 size={14} className="animate-spin inline" /> : actionLabel}
      </button>
    </div>
  );
}

function StatusPill({ state }: { state: CapabilityStatus["state"] }) {
  const config: Record<
    CapabilityStatus["state"],
    { label: string; colour: string; Icon: typeof Check }
  > = {
    satisfied: { label: "Ready", colour: "rgb(34, 197, 94)", Icon: Check },
    detecting: { label: "Checking…", colour: "var(--text-dim)", Icon: Loader2 },
    auto_installing: {
      label: "Installing…",
      colour: "var(--accent)",
      Icon: Loader2,
    },
    awaiting_user_action: {
      label: "Action needed",
      colour: "rgb(234, 179, 8)",
      Icon: AlertCircle,
    },
    missing: { label: "Needed", colour: "rgb(239, 68, 68)", Icon: AlertCircle },
    stale: { label: "Re-check", colour: "rgb(234, 179, 8)", Icon: AlertCircle },
    unknown: { label: "Not checked", colour: "var(--text-dim)", Icon: Clock },
  };
  const { label, colour, Icon } = config[state];
  const spinning = state === "detecting" || state === "auto_installing";
  return (
    <span
      className="text-detail flex items-center gap-1 shrink-0"
      style={{ color: colour }}
      data-testid="status-pill"
      data-state={state}
    >
      <Icon size={12} className={spinning ? "animate-spin" : ""} />
      {label}
    </span>
  );
}
