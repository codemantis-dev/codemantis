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
