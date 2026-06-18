// One-line summary card for a capability in Mission Control.
// Surfaces: icon, name, purpose, manual setup guidance, status pill, and
// actions. Tier 2 ships honest actions only — "Re-check" (re-runs the real
// verification) and "Skip for now" (persists an acknowledged-skip). The
// catalog-driven guided SetupFlow is deferred to Tier 3.

import { Check, AlertCircle, Loader2, Clock, Terminal } from "lucide-react";
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
  /** Human guidance on how to satisfy this capability (from its verification). */
  guidance?: string | null;
  /** Re-run this capability's verification. */
  onRecheck: () => void;
  /** Mark the capability as user-acknowledged-skip. Omitted when not skippable. */
  onSkip?: () => void;
  /** Whether a verify/skip op is currently in-flight (spinner + disables clicks). */
  busy?: boolean;
}

export default function CapabilityCard({
  capability,
  status,
  serviceName,
  serviceCategory,
  estimatedMinutes,
  guidance,
  onRecheck,
  onSkip,
  busy,
}: CapabilityCardProps) {
  const display = serviceName ?? capability.name;
  const state = status?.state ?? "unknown";
  const isOptional = !capability.required;
  const skipped = status?.userAcknowledgedOptionalSkip ?? false;
  const satisfied = state === "satisfied";
  const showGuidance = !!guidance && !satisfied && !skipped;
  const showSkip = !!onSkip && !satisfied && !skipped;

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
          {skipped && (
            <span
              className="text-detail px-1.5 py-0.5 rounded"
              style={{ background: "var(--bg-subtle)", color: "var(--text-dim)" }}
            >
              Skipped
            </span>
          )}
        </div>
        {capability.purpose && (
          <p className="text-label text-text-dim leading-snug truncate">
            {capability.purpose}
          </p>
        )}
        {showGuidance && (
          <p
            className="text-detail text-text-secondary mt-1 flex items-start gap-1"
            data-testid="capability-guidance"
          >
            <Terminal size={11} className="mt-0.5 shrink-0" />
            <span className="break-words">{guidance}</span>
          </p>
        )}
        {estimatedMinutes && !satisfied && (
          <p className="text-detail text-text-ghost mt-1 flex items-center gap-1">
            <Clock size={11} />
            About {estimatedMinutes} {estimatedMinutes === 1 ? "minute" : "minutes"}
          </p>
        )}
      </div>
      <StatusPill state={state} />
      <div className="flex items-center gap-2 shrink-0">
        {showSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-detail text-text-dim hover:text-text-secondary disabled:opacity-50"
          >
            Skip for now
          </button>
        )}
        <button
          type="button"
          onClick={onRecheck}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-ui font-medium transition-colors disabled:opacity-50"
          style={{
            background: satisfied ? "var(--bg-subtle)" : "var(--accent)",
            color: satisfied ? "var(--text-secondary)" : "white",
          }}
        >
          {busy ? <Loader2 size={14} className="animate-spin inline" /> : "Re-check"}
        </button>
      </div>
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
