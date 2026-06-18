// MissionControl — the full-screen "before we build, let's set up" page.
//
// User vision: a non-technical user lands here, sees clearly what's needed,
// understands roughly how long it'll take, and clicks through each item
// without ever staring at a stack trace.

import { useMemo, useEffect, useState } from "react";
import { Rocket, AlertTriangle, Check } from "lucide-react";
import type {
  Capability,
  CapabilityStatus,
  Manifest,
  PreflightStatus,
  Verification,
} from "../../types/preflight";
import { usePreflightStore } from "../../stores/preflightStore";
import CapabilityCard from "./CapabilityCard";

interface MissionControlProps {
  /** The bundle's preflight manifest (loaded via preflightLoadManifest). */
  manifest: Manifest;
  /** Aggregated status — drives the summary band and per-row pills. */
  status: PreflightStatus | null;
  /** Active project path — used to re-check / skip capabilities via the store. */
  projectPath: string;
  /** Click handler for "Start Building" — only fires when allSatisfied. */
  onStartBuilding: () => void;
  /** Catalog metadata helpers (lookup by catalogRef → display info). */
  resolveCatalog: (catalogRef: string) => CatalogResolution | null;
  /** Optional: kick off verify_all when first mounted. */
  onMount?: () => void;
}

export interface CatalogResolution {
  serviceName: string;
  serviceCategory?: string;
  estimatedMinutes?: number;
}

export default function MissionControl({
  manifest,
  status,
  projectPath,
  onStartBuilding,
  resolveCatalog,
  onMount,
}: MissionControlProps) {
  const verifyOne = usePreflightStore((s) => s.verifyOne);
  const acknowledgeSkip = usePreflightStore((s) => s.acknowledgeSkip);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    onMount?.();
    // We deliberately fire-once on mount; the parent supplies a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runWhileBusy = async (capId: string, op: () => Promise<void>): Promise<void> => {
    setBusyId(capId);
    try {
      await op();
    } finally {
      setBusyId(null);
    }
  };

  const renderCard = (cap: Capability): React.ReactNode => {
    const capStatus = status?.capabilities.find((s) => s.capabilityId === cap.id);
    const cat = resolveCatalog(cap.catalogRef);
    // Skippable = anything that isn't a hard (required AND blocking) gate.
    const skippable = !(cap.required && cap.blocksSelfDrive);
    return (
      <CapabilityCard
        key={cap.id}
        capability={cap}
        status={capStatus ?? null}
        serviceName={cat?.serviceName ?? cap.name}
        serviceCategory={cat?.serviceCategory}
        estimatedMinutes={cat?.estimatedMinutes}
        guidance={verificationGuidance(cap.verification)}
        busy={busyId === cap.id}
        onRecheck={() => runWhileBusy(cap.id, () => verifyOne(projectPath, cap.id))}
        onSkip={
          skippable
            ? () => runWhileBusy(cap.id, () => acknowledgeSkip(projectPath, cap.id))
            : undefined
        }
      />
    );
  };

  // Group capabilities for display.
  const groups = useMemo(() => bucket(manifest.capabilities), [manifest]);

  const totalRequired = manifest.capabilities.filter((c) => c.required).length;
  const readyCount = (status?.capabilities ?? []).filter(
    (s) => s.state === "satisfied",
  ).length;
  const blocking = blockingCount(manifest, status);

  const allSatisfied = status?.allSatisfied ?? false;

  const totalMinutes = useMemo(() => {
    return manifest.capabilities.reduce((sum, c) => {
      const r = resolveCatalog(c.catalogRef);
      const isReady = (status?.capabilities ?? []).some(
        (s) => s.capabilityId === c.id && s.state === "satisfied",
      );
      if (isReady) return sum;
      return sum + (r?.estimatedMinutes ?? 3);
    }, 0);
  }, [manifest, resolveCatalog, status]);

  return (
    <div
      className="w-full h-full overflow-auto"
      style={{ background: "var(--bg-primary)" }}
      data-testid="mission-control"
    >
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-text-primary mb-1">
            Set up <span style={{ color: "var(--accent)" }}>{manifest.project}</span>
          </h1>
          <p className="text-label text-text-secondary leading-relaxed">
            Before we build, let's set up the things this project needs. We'll walk
            you through each one — most take a couple of minutes.
          </p>
        </header>

        {/* Status band */}
        <div
          className="rounded-lg border p-4 mb-6 flex items-center justify-between"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-elevated)",
          }}
          data-testid="status-band"
        >
          <div className="flex items-baseline gap-4">
            <div>
              <span className="text-2xl font-semibold text-text-primary">
                {readyCount}
              </span>
              <span className="text-text-dim"> / {totalRequired} ready</span>
            </div>
            {blocking > 0 && (
              <div className="text-label text-text-secondary">
                <AlertTriangle
                  size={13}
                  className="inline mr-1"
                  style={{ color: "rgb(234, 179, 8)" }}
                />
                {blocking} to set up
              </div>
            )}
            {totalMinutes > 0 && !allSatisfied && (
              <div className="text-label text-text-dim">
                ≈ {totalMinutes} minutes remaining
              </div>
            )}
          </div>
          {allSatisfied && (
            <span
              className="inline-flex items-center gap-1 text-detail"
              style={{ color: "rgb(34, 197, 94)" }}
            >
              <Check size={14} />
              Everything ready
            </span>
          )}
        </div>

        {/* Grouped capability list */}
        {groups.satisfied.length > 0 && (
          <Section title="Already on your system">
            {groups.satisfied.map(renderCard)}
          </Section>
        )}
        {groups.autoResolvable.length > 0 && (
          <Section title="Quick installs">
            {groups.autoResolvable.map(renderCard)}
          </Section>
        )}
        {groups.guidedHuman.length > 0 && (
          <Section title="Accounts & keys">
            {groups.guidedHuman.map(renderCard)}
          </Section>
        )}
        {groups.optional.length > 0 && (
          <Section title="Optional">
            {groups.optional.map(renderCard)}
          </Section>
        )}

        {/* Footer / Start Building */}
        <footer className="mt-10 flex items-center justify-between">
          <p className="text-detail text-text-dim">
            {allSatisfied
              ? "Everything's ready. Time to build something."
              : "Skip-for-now is always available — you can set things up later if you'd rather move on."}
          </p>
          <button
            type="button"
            onClick={onStartBuilding}
            disabled={!allSatisfied}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-ui font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Start Building
            <Rocket size={14} />
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6" data-testid="cap-section" data-section-title={title}>
      <h2 className="text-ui font-semibold text-text-secondary mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/**
 * Honest, manual setup guidance derived from a capability's verification rule.
 * Tier 2 has no catalog-driven step recipes, so we tell the user what the
 * check actually looks for — enough to satisfy it by hand, then "Re-check".
 */
function verificationGuidance(verification: Verification): string | null {
  switch (verification.kind) {
    case "shell_command":
      return `Satisfied when this succeeds: ${verification.command}`;
    case "env_var_present":
      return `Set the ${verification.varName} environment variable.`;
    case "secret_present":
      return `Provide the "${verification.key}" secret (add it to your environment or Settings → AI Providers).`;
    case "api_probe":
      return `Reachable when ${verification.method} ${verification.url} succeeds.`;
    default:
      return null;
  }
}

function bucket(caps: Capability[]): {
  satisfied: Capability[];
  autoResolvable: Capability[];
  guidedHuman: Capability[];
  optional: Capability[];
} {
  const satisfied: Capability[] = [];
  const autoResolvable: Capability[] = [];
  const guidedHuman: Capability[] = [];
  const optional: Capability[] = [];
  for (const cap of caps) {
    if (!cap.required) {
      optional.push(cap);
    } else if (cap.category === "auto_resolvable") {
      autoResolvable.push(cap);
    } else if (cap.category === "pre_existing_detection") {
      satisfied.push(cap);
    } else {
      guidedHuman.push(cap);
    }
  }
  return { satisfied, autoResolvable, guidedHuman, optional };
}

function blockingCount(
  manifest: Manifest,
  status: PreflightStatus | null,
): number {
  const statuses = new Map(
    (status?.capabilities ?? []).map((s) => [s.capabilityId, s] as const),
  );
  let count = 0;
  for (const cap of manifest.capabilities) {
    if (!cap.blocksSelfDrive || !cap.required) continue;
    const s = statuses.get(cap.id) as CapabilityStatus | undefined;
    if (s?.userAcknowledgedOptionalSkip) continue;
    if (s?.state !== "satisfied") count++;
  }
  return count;
}
