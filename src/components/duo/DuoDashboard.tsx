/**
 * DuoDashboard — the metadata body of the Duo workspace's "Dashboard" tab:
 * the analyst's assessment, gauges, metrics strip, charts, risks,
 * recommendations, repair/improvement analysis, and watch items.
 *
 * Run controls, the idle/setup state, the live agent chats, and the
 * orchestrator card all live in `DuoWorkspace` — this component is purely the
 * analyst/metrics readout for an active (or recovered) run.
 */
import {
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Wrench,
  Eye,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { useDuoStore } from "../../stores/duoStore";
import { StatTile, Badge, ScoreGauge } from "./DuoPrimitives";
import { levelColor } from "./duo-colors";

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-2"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-detail font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

export default function DuoDashboard(): React.ReactElement {
  const metrics = useDuoStore((s) => s.metrics);
  const snapshot = useDuoStore((s) => s.analystSnapshot);

  const report = snapshot?.report;
  const series = snapshot?.series ?? [];
  const agreeData = [
    { name: "Agree", value: metrics.agreements, fill: "var(--green)" },
    { name: "Disagree", value: metrics.disagreements, fill: "var(--red)" },
    { name: "Repairs", value: metrics.repairs, fill: "var(--yellow)" },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      {/* ── Analyst headline + narrative ── */}
      {report ? (
        <Card title={report.headline || "Analyst assessment"} icon={<TrendingUp size={14} style={{ color: "var(--accent)" }} />}>
          <p className="text-detail" style={{ color: "var(--text-secondary)" }}>
            {report.narrative}
          </p>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Badge text={report.phaseAssessment.momentum} color={levelColor(report.phaseAssessment.momentum)} />
            <span className="text-detail" style={{ color: "var(--text-dim)" }}>
              {report.phaseAssessment.momentumRationale}
            </span>
            <span className="text-detail ml-auto" style={{ color: "var(--text-dim)" }}>
              confidence {report.confidence}%
            </span>
          </div>
        </Card>
      ) : (
        <div
          className="rounded-lg border p-4 text-detail"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--border)", color: "var(--text-dim)" }}
        >
          Analyst warming up — the first assessment appears after the mentor&apos;s first review.
        </div>
      )}

      {/* ── Gauges ── */}
      {report && (
        <div className="grid grid-cols-2 gap-4">
          <ScoreGauge
            label="Collaboration health"
            score={report.collaborationHealth.score}
            caption={report.collaborationHealth.summary}
          />
          <ScoreGauge
            label="Code quality"
            score={report.qualityAssessment.score}
            caption={report.qualityAssessment.trajectory}
          />
        </div>
      )}

      {/* ── Metrics strip ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatTile label="reviews" value={metrics.reviews} />
        <StatTile label="agreements" value={metrics.agreements} accent="var(--green)" />
        <StatTile label="disagreements" value={metrics.disagreements} accent="var(--red)" />
        <StatTile label="repairs" value={metrics.repairs} accent="var(--yellow)" />
        <StatTile label="dialogue rounds" value={metrics.dialogueRounds} />
        <StatTile label="drift" value={metrics.driftIncidents} accent={metrics.driftIncidents > 0 ? "var(--red)" : undefined} />
        <StatTile label="agree rate" value={`${Math.round(metrics.agreementRate * 100)}%`} />
        <StatTile label="cost" value={`$${metrics.costUsd.toFixed(2)}`} />
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Changes per turn">
          <div style={{ height: 160 }}>
            {series.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="turn" stroke="var(--text-dim)" fontSize={11} />
                  <YAxis stroke="var(--text-dim)" fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="added" stackId="d" fill="var(--green)" />
                  <Bar dataKey="removed" stackId="d" fill="var(--red)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-detail" style={{ color: "var(--text-dim)" }}>
                No turns recorded yet.
              </div>
            )}
          </div>
        </Card>
        <Card title="Agreements vs disagreements">
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agreeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--text-dim)" fontSize={11} />
                <YAxis stroke="var(--text-dim)" fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ── Risks + recommendations ── */}
      {report && (
        <div className="grid grid-cols-2 gap-4">
          <Card title="Risks" icon={<AlertTriangle size={14} style={{ color: "var(--yellow)" }} />}>
            {report.qualityAssessment.risks.length === 0 ? (
              <span className="text-detail" style={{ color: "var(--text-dim)" }}>None flagged.</span>
            ) : (
              report.qualityAssessment.risks.map((r, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge text={r.severity} color={levelColor(r.severity)} />
                  <span className="text-detail" style={{ color: "var(--text-secondary)" }}>
                    {r.description}
                  </span>
                </div>
              ))
            )}
          </Card>
          <Card title="Recommendations" icon={<Lightbulb size={14} style={{ color: "var(--accent)" }} />}>
            {report.recommendations.length === 0 ? (
              <span className="text-detail" style={{ color: "var(--text-dim)" }}>None right now.</span>
            ) : (
              report.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge text={rec.priority} color={levelColor(rec.priority)} />
                  <span className="text-detail" style={{ color: "var(--text-secondary)" }}>
                    {rec.action}
                    <span style={{ color: "var(--text-dim)" }}> · {rec.audience}</span>
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>
      )}

      {/* ── Repair + improvement ── */}
      {report && (
        <div className="grid grid-cols-2 gap-4">
          <Card title="Repair analysis" icon={<Wrench size={14} style={{ color: "var(--yellow)" }} />}>
            <p className="text-detail" style={{ color: "var(--text-secondary)" }}>
              {report.repairAnalysis.summary || "No repairs yet."}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-detail" style={{ color: "var(--text-dim)" }}>Mentor effectiveness</span>
              <Badge text={report.repairAnalysis.mentorEffectiveness} color={levelColor(report.repairAnalysis.mentorEffectiveness)} />
            </div>
          </Card>
          <Card title="Improvements" icon={<TrendingUp size={14} style={{ color: "var(--green)" }} />}>
            <p className="text-detail" style={{ color: "var(--text-secondary)" }}>
              {report.improvementAnalysis.summary || "Tracking improvements the mentor drives."}
            </p>
            {report.improvementAnalysis.delivered.map((d, i) => (
              <span key={i} className="text-detail" style={{ color: "var(--text-dim)" }}>• {d}</span>
            ))}
          </Card>
        </div>
      )}

      {/* ── Watch items ── */}
      {report && report.watchItems.length > 0 && (
        <Card title="Watch items" icon={<Eye size={14} style={{ color: "var(--text-secondary)" }} />}>
          {report.watchItems.map((w, i) => (
            <span key={i} className="text-detail" style={{ color: "var(--text-secondary)" }}>• {w}</span>
          ))}
        </Card>
      )}
    </div>
  );
}
