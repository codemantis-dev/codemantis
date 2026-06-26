/**
 * Small presentational primitives shared by the Duo-Coding dashboard.
 * Color comes from theme CSS variables only.
 */
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";
import { scoreColor } from "./duo-colors";
import { formatTokens } from "../../lib/format-utils";
import type { DuoRoleCosts } from "../../lib/duo-cost";

export function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}): React.ReactElement {
  return (
    <div
      className="rounded-md px-3 py-2 border flex flex-col gap-0.5 min-w-[84px]"
      style={{ background: "var(--bg-subtle)", borderColor: "var(--border)" }}
    >
      <span
        className="text-lg font-semibold leading-none"
        style={{ color: accent ?? "var(--text-primary)" }}
      >
        {value}
      </span>
      <span className="text-detail" style={{ color: "var(--text-dim)" }}>
        {label}
      </span>
    </div>
  );
}

const fmtUsd = (n: number): string => `$${n.toFixed(2)}`;

function CostRow({
  label,
  cost,
}: {
  label: string;
  cost: { usd: number; est?: boolean; tokens?: number };
}): React.ReactElement {
  // Estimated costs (Codex, which reports no real $) get a "~" + the token count
  // they were derived from; real reported costs show just the dollar figure.
  const value = cost.est
    ? `~${fmtUsd(cost.usd)}${cost.tokens ? ` · ${formatTokens(cost.tokens)}` : ""}`
    : fmtUsd(cost.usd);
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span style={{ color: "var(--text-secondary)" }}>{value}</span>
    </div>
  );
}

/**
 * Cost tile with a per-role breakdown (primary / mentor / analyst). The total is
 * shown prominently; the three contributors sit beneath it. Codex (primary)
 * reports no real cost, so its figure is an estimate (token usage × pricing),
 * marked with "~" and the token count.
 */
export function CostBreakdownTile({ costs }: { costs: DuoRoleCosts }): React.ReactElement {
  return (
    <div
      className="rounded-md px-3 py-2 border flex flex-col gap-1 min-w-[150px]"
      style={{ background: "var(--bg-subtle)", borderColor: "var(--border)" }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-lg font-semibold leading-none" style={{ color: "var(--text-primary)" }}>
          {fmtUsd(costs.total)}
        </span>
        <span className="text-detail" style={{ color: "var(--text-dim)" }}>
          cost
        </span>
      </div>
      <div className="text-detail flex flex-col gap-0.5 mt-1">
        <CostRow label="primary" cost={costs.primary} />
        <CostRow label="mentor" cost={costs.mentor} />
        <CostRow label="analyst" cost={costs.analyst} />
      </div>
    </div>
  );
}

export function Badge({
  text,
  color,
}: {
  text: string;
  color: string;
}): React.ReactElement {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-detail font-medium capitalize"
      style={{ color, background: "color-mix(in srgb, currentColor 14%, transparent)" }}
    >
      {text}
    </span>
  );
}

/** Half-circle score gauge (0–100). The numeric value is also rendered as text
 *  so it's assertable in tests and readable without the chart. */
export function ScoreGauge({
  label,
  score,
  caption,
}: {
  label: string;
  score: number;
  caption?: string;
}): React.ReactElement {
  const color = scoreColor(score);
  const data = [{ name: label, value: score, fill: color }];
  return (
    <div
      className="rounded-lg border p-4 flex flex-col items-center"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
      <span className="text-detail mb-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <div className="relative w-full" style={{ height: 96 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="70%"
            outerRadius="100%"
            data={data}
            startAngle={180}
            endAngle={0}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" background cornerRadius={6} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-end justify-center pb-1">
          <span className="text-2xl font-semibold" style={{ color }}>
            {score}
          </span>
        </div>
      </div>
      {caption && (
        <span
          className="text-detail text-center mt-1"
          style={{ color: "var(--text-dim)" }}
        >
          {caption}
        </span>
      )}
    </div>
  );
}
