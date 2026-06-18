/**
 * DuoDashboard — the rich, live monitoring surface for a Duo-Coding run.
 * Shows the analyst's assessment, gauges, metrics, charts, risks,
 * recommendations, the live dialogue, and ALWAYS-available run controls
 * (Pause / Resume / Stop). Renders the tie-break modal when a decision is due.
 */
import { useEffect, useState } from "react";
import {
  Pause,
  Play,
  Square,
  Users,
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
import DuoDialogueView from "./DuoDialogueView";
import DuoTieBreakModal from "./DuoTieBreakModal";
import { StatTile, Badge, ScoreGauge } from "./DuoPrimitives";
import { levelColor } from "./duo-colors";
import type { DuoStatus } from "../../types/duo";

interface Props {
  onConfigure?: () => void;
}

const STATUS_COLOR: Record<DuoStatus, string> = {
  idle: "var(--text-dim)",
  running: "var(--green)",
  paused: "var(--yellow)",
  completed: "var(--blue)",
};

function useElapsed(startedAt: number | null, running: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!startedAt) return "0:00";
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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

export default function DuoDashboard({ onConfigure }: Props): React.ReactElement {
  const status = useDuoStore((s) => s.status);
  const phase = useDuoStore((s) => s.phase);
  const config = useDuoStore((s) => s.config);
  const startedAt = useDuoStore((s) => s.startedAt);
  const metrics = useDuoStore((s) => s.metrics);
  const snapshot = useDuoStore((s) => s.analystSnapshot);
  const pause = useDuoStore((s) => s.pause);
  const resume = useDuoStore((s) => s.resume);
  const stop = useDuoStore((s) => s.stop);
  const blocker = useDuoStore((s) => s.blocker);

  const [confirmStop, setConfirmStop] = useState(false);
  const elapsed = useElapsed(startedAt, status === "running");

  if (status === "idle") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Users size={40} style={{ color: "var(--accent)" }} />
        <div className="max-w-md flex flex-col gap-2">
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Duo-Coding
          </h2>
          <p className="text-detail" style={{ color: "var(--text-secondary)" }}>
            Pair a primary coding agent with a read-only mentor that reviews every
            turn, runs the build/tests itself, and directs repairs — with a live
            dashboard of agreements, disagreements, and decisions.
          </p>
        </div>
        <button
          type="button"
          onClick={onConfigure}
          className="px-4 py-2 rounded-md text-detail font-medium"
          style={{ background: "var(--accent)", color: "var(--bg-primary)" }}
        >
          Configure a Duo run
        </button>
      </div>
    );
  }

  const report = snapshot?.report;
  const series = snapshot?.series ?? [];
  const agreeData = [
    { name: "Agree", value: metrics.agreements, fill: "var(--green)" },
    { name: "Disagree", value: metrics.disagreements, fill: "var(--red)" },
    { name: "Repairs", value: metrics.repairs, fill: "var(--yellow)" },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      {/* ── Header / controls ── */}
      <div
        className="rounded-lg border p-4 flex items-center justify-between gap-4 flex-wrap"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-detail font-medium capitalize"
            style={{ color: STATUS_COLOR[status], background: "var(--bg-subtle)" }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: STATUS_COLOR[status] }}
            />
            {status}
          </span>
          {phase && (
            <span className="text-detail capitalize" style={{ color: "var(--text-secondary)" }}>
              {phase}
            </span>
          )}
          {config && (
            <span className="text-detail" style={{ color: "var(--text-dim)" }}>
              {config.primary.agentId}
              {config.primary.model ? `/${config.primary.model}` : ""}
              {" → "}
              {config.duo.agentId}
              {config.duo.model ? `/${config.duo.model}` : ""}
            </span>
          )}
          <span className="text-detail font-mono" style={{ color: "var(--text-dim)" }}>
            {elapsed}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {status === "running" && (
            <button
              type="button"
              onClick={pause}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail"
              style={{ color: "var(--text-primary)", background: "var(--bg-subtle)" }}
            >
              <Pause size={14} /> Pause
            </button>
          )}
          {status === "paused" && !blocker && (
            <button
              type="button"
              onClick={() => void resume()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail"
              style={{ color: "var(--text-primary)", background: "var(--bg-subtle)" }}
            >
              <Play size={14} /> Resume
            </button>
          )}
          {(status === "running" || status === "paused") &&
            (confirmStop ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmStop(false);
                  void stop("stopped-by-user");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail font-medium"
                style={{ color: "var(--bg-primary)", background: "var(--red)" }}
              >
                <Square size={14} /> Confirm stop?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmStop(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail"
                style={{ color: "var(--red)", background: "var(--bg-subtle)" }}
              >
                <Square size={14} /> Stop
              </button>
            ))}
        </div>
      </div>

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

      {/* ── Live dialogue ── */}
      <div className="flex flex-col gap-2">
        <span className="text-detail font-semibold" style={{ color: "var(--text-primary)" }}>
          Dialogue
        </span>
        <DuoDialogueView />
      </div>

      <DuoTieBreakModal />
    </div>
  );
}
