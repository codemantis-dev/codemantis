import { useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import type {
  AnalysisFinding,
  AuditFailure,
  CoverageAuditReport,
  InputAnalysis,
} from "../../types/spec-writer";
import { describeFailure } from "../../lib/spec-coverage-audit";
import { describeFinding } from "../../lib/spec-input-analyzer";

interface Props {
  /** Latest coverage audit on the produced spec. */
  report: CoverageAuditReport | null;
  /** Latest input-analyzer report for the user-attached input docs. */
  analysis: InputAnalysis | null;
  /**
   * Trigger another recheck pass against the model. The button only renders
   * when the latest report has a usable recheckPrompt.
   */
  onRecheck: () => void;
  /** True when a recheck is currently in flight. */
  recheckInFlight?: boolean;
}

const STATUS_LABEL: Record<CoverageAuditReport['status'], string> = {
  pass: 'PASS',
  fail: 'FAIL',
};

export default function CoveragePanel({ report, analysis, onRecheck, recheckInFlight = false }: Props) {
  if (!report && !analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="text-4xl mb-4">🛡️</div>
        <div className="text-chat font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
          Coverage panel
        </div>
        <div className="text-ui leading-relaxed max-w-md" style={{ color: "var(--text-dim)" }}>
          When you provide an input spec and SpecWriter writes its output, this panel shows
          which sections were covered, what got dropped, and any silent rewrites — so you can
          spot quality problems before saving the spec.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {analysis && <InputAnalysisSection analysis={analysis} />}
        {report && <CoverageReportSection report={report} />}
      </div>

      {report && report.status === 'fail' && report.recheckPrompts.length > 0 && (
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 border-t shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="text-ui" style={{ color: "var(--text-dim)" }}>
            {report.failures.length} finding{report.failures.length === 1 ? '' : 's'} — re-prompt the model to fill the gaps?
          </div>
          <button
            onClick={onRecheck}
            disabled={recheckInFlight}
            title="Send another recheck pass to the model"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ui font-medium transition-colors hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <RefreshCw size={13} className={recheckInFlight ? 'animate-spin' : ''} />
            {recheckInFlight ? 'Rechecking…' : 'Run another recheck'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Coverage report section ──────────────────────────────────────────

function CoverageReportSection({ report }: { report: CoverageAuditReport }) {
  const isPass = report.status === 'pass';
  const failureCounts = countByKind(report.failures);

  return (
    <section>
      <SectionHeader
        icon={isPass ? <CheckCircle2 size={14} style={{ color: "var(--success, #22c55e)" }} /> : <XCircle size={14} style={{ color: "var(--destructive, #ef4444)" }} />}
        title="Coverage audit"
        subtitle={
          isPass
            ? `${STATUS_LABEL[report.status]} — output is ${(report.ratios.byteRatio * 100).toFixed(0)}% of input by bytes, covering ${report.output.sections} H2 section${report.output.sections === 1 ? '' : 's'}.`
            : `${STATUS_LABEL[report.status]} — ${report.failures.length} finding${report.failures.length === 1 ? '' : 's'} (${report.ratios.byteRatio.toFixed(2)}× by bytes).`
        }
      />

      {!isPass && report.failures.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {failureCounts.missingSection > 0 && <CountBadge label="missing section" count={failureCounts.missingSection} severity="block" />}
          {failureCounts.unmapped > 0 && <CountBadge label="unmapped row" count={failureCounts.unmapped} severity="warn" />}
          {failureCounts.schemaRename > 0 && <CountBadge label="schema rename" count={failureCounts.schemaRename} severity="block" />}
          {failureCounts.drift > 0 && <CountBadge label="verbatim drift" count={failureCounts.drift} severity="warn" />}
          {failureCounts.missingNumeric > 0 && <CountBadge label="missing numeric" count={failureCounts.missingNumeric} severity="warn" />}
          {failureCounts.truncation > 0 && <CountBadge label="truncation" count={failureCounts.truncation} severity="block" />}
          {failureCounts.placeholder > 0 && <CountBadge label="placeholder leaked" count={failureCounts.placeholder} severity="warn" />}
          {failureCounts.byteRatio > 0 && <CountBadge label="byte ratio low" count={failureCounts.byteRatio} severity="warn" />}
        </div>
      )}

      {report.failures.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-ui select-none flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
            Detailed findings ({report.failures.length})
          </summary>
          <ul className="mt-2 ml-4 space-y-1 text-ui" style={{ color: "var(--text-dim)" }}>
            {report.failures.map((f, i) => (
              <li key={i}>
                <span style={{ color: severityColor(severityOf(f)) }}>● </span>
                {describeFailure(f)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.inputDocs.length > 0 && (
        <div className="mt-3 text-ui" style={{ color: "var(--text-dim)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Input audited:</span>{' '}
          {report.inputDocs.map((d) => `${d.name} (${d.bytes.toLocaleString()} bytes)`).join(', ')}
        </div>
      )}
    </section>
  );
}

// ─── Input analysis section ───────────────────────────────────────────

function InputAnalysisSection({ analysis }: { analysis: InputAnalysis }) {
  const blocks = analysis.findings.filter((f) => f.severity === 'block');
  const warns = analysis.findings.filter((f) => f.severity === 'warn');
  const infos = analysis.findings.filter((f) => f.severity === 'info');

  return (
    <section>
      <SectionHeader
        icon={blocks.length > 0
          ? <XCircle size={14} style={{ color: "var(--destructive, #ef4444)" }} />
          : warns.length > 0
            ? <AlertTriangle size={14} style={{ color: "var(--warning, #f59e0b)" }} />
            : <Info size={14} style={{ color: "var(--accent)" }} />
        }
        title="Input analysis"
        subtitle={`${analysis.docs.length} doc${analysis.docs.length === 1 ? '' : 's'} scanned · ${blocks.length} blocking · ${warns.length} warning${warns.length === 1 ? '' : 's'} · ${infos.length} info`}
      />

      {analysis.docs.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-ui" style={{ color: "var(--text-dim)" }}>
          {analysis.docs.map((d) => (
            <li key={d.name}>
              <span style={{ color: "var(--text-secondary)" }}>{d.name}</span> — {d.bytes.toLocaleString()} bytes,{' '}
              {d.sections.filter((s) => s.level === 2).length} H2 sections
            </li>
          ))}
        </ul>
      )}

      {analysis.findings.length > 0 && (
        <FindingsList findings={analysis.findings} />
      )}

      {analysis.findings.length === 0 && (
        <div className="mt-2 text-ui" style={{ color: "var(--text-dim)" }}>No structural problems detected.</div>
      )}
    </section>
  );
}

function FindingsList({ findings }: { findings: AnalysisFinding[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? findings : findings.slice(0, 5);
  return (
    <div className="mt-2">
      <ul className="space-y-1 text-ui" style={{ color: "var(--text-dim)" }}>
        {visible.map((f, i) => (
          <li key={i}>
            <span style={{ color: severityColor(f.severity) }}>● </span>
            {describeFinding(f)}
          </li>
        ))}
      </ul>
      {findings.length > 5 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-ui flex items-center gap-1 hover:underline"
          style={{ color: "var(--text-secondary)" }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? 'Show less' : `Show all ${findings.length}`}
        </button>
      )}
    </div>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-chat font-medium" style={{ color: "var(--text-primary)" }}>{title}</div>
        <div className="text-ui" style={{ color: "var(--text-dim)" }}>{subtitle}</div>
      </div>
    </div>
  );
}

function CountBadge({ label, count, severity }: { label: string; count: number; severity: 'block' | 'warn' | 'info' }) {
  return (
    <div className="inline-flex items-center gap-1.5 mr-2 px-2 py-0.5 rounded-md text-ui" style={{
      background: "var(--bg-elevated)",
      color: severityColor(severity),
      border: `1px solid ${severityColor(severity)}`,
    }}>
      <span className="font-mono">{count}</span>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
    </div>
  );
}

function severityColor(severity: 'block' | 'warn' | 'info'): string {
  switch (severity) {
    case 'block': return 'var(--destructive, #ef4444)';
    case 'warn': return 'var(--warning, #f59e0b)';
    case 'info': return 'var(--text-secondary)';
  }
}

function severityOf(f: AuditFailure): 'block' | 'warn' | 'info' {
  switch (f.kind) {
    case 'missing-section':
    case 'schema-rename':
    case 'truncation':
      return 'block';
    case 'unmapped-section':
    case 'fidelity-drift':
    case 'missing-numeric':
    case 'placeholder-leaked':
    case 'byte-ratio-low':
      return 'warn';
  }
}

interface FailureCounts {
  missingSection: number;
  unmapped: number;
  schemaRename: number;
  drift: number;
  missingNumeric: number;
  truncation: number;
  placeholder: number;
  byteRatio: number;
}

function countByKind(failures: AuditFailure[]): FailureCounts {
  const c: FailureCounts = {
    missingSection: 0,
    unmapped: 0,
    schemaRename: 0,
    drift: 0,
    missingNumeric: 0,
    truncation: 0,
    placeholder: 0,
    byteRatio: 0,
  };
  for (const f of failures) {
    switch (f.kind) {
      case 'missing-section': c.missingSection++; break;
      case 'unmapped-section': c.unmapped++; break;
      case 'schema-rename': c.schemaRename++; break;
      case 'fidelity-drift': c.drift++; break;
      case 'missing-numeric': c.missingNumeric++; break;
      case 'truncation': c.truncation++; break;
      case 'placeholder-leaked': c.placeholder++; break;
      case 'byte-ratio-low': c.byteRatio++; break;
    }
  }
  return c;
}
