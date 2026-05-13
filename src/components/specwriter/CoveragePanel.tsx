import { useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, Wand2, ChevronDown, ChevronRight, Activity, FileEdit, FileX2, History } from "lucide-react";
import type {
  AnalysisFinding,
  AuditFailure,
  CoverageAuditReport,
  InputAnalysis,
  SpecCreationLog,
  SpecPatchOutcome,
  StreamStats,
} from "../../types/spec-writer";
import { describeFailure } from "../../lib/spec-coverage-audit";
import { describeFinding } from "../../lib/spec-input-analyzer";

interface Props {
  /** Latest coverage audit on the produced spec. */
  report: CoverageAuditReport | null;
  /** Latest input-analyzer report for the user-attached input docs. */
  analysis: InputAnalysis | null;
  /** Stage 4: most recent stream metadata (chunks/bytes/duration/status). */
  streamStats?: StreamStats | null;
  /**
   * Outcome of the most recent AUDIT-PATCH splice (if any). Rendered as a
   * banner at the top of the panel so users know — at a glance — that the
   * "Patch spec & re-audit" button actually rewrote the spec.
   */
  patchOutcome?: SpecPatchOutcome | null;
  /**
   * Per-section streaming progress for the current run (heading-level log).
   * Rendered as a collapsible section showing each section's bytes, with a
   * "RESUME HERE" pill on the open (in-progress) entry and a "post-compact"
   * pill on entries appended after a CLI auto-compaction event.
   */
  creationLog?: SpecCreationLog | null;
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

export default function CoveragePanel({ report, analysis, streamStats = null, patchOutcome = null, creationLog = null, onRecheck, recheckInFlight = false }: Props) {
  const hasCreationLog = !!creationLog && creationLog.entries.length > 0;
  if (!report && !analysis && !streamStats && !patchOutcome && !hasCreationLog) {
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
        {patchOutcome && <PatchOutcomeBanner outcome={patchOutcome} />}
        {analysis && <InputAnalysisSection analysis={analysis} />}
        {report && <CoverageReportSection report={report} />}
        {hasCreationLog && <CreationLogSection log={creationLog!} />}
        {streamStats && <StreamStatsSection stats={streamStats} />}
      </div>

      {report && report.status === 'fail' && report.recheckPrompts.length > 0 && (
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 border-t shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="text-ui" style={{ color: "var(--text-dim)" }}>
            {report.failures.length} finding{report.failures.length === 1 ? '' : 's'} — patch the spec to fix them?
          </div>
          <button
            onClick={onRecheck}
            disabled={recheckInFlight}
            title="Ask the model for an AUDIT-PATCH and splice it into the existing spec, then re-run the coverage audit."
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ui font-medium transition-colors hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Wand2 size={13} className={recheckInFlight ? 'animate-pulse' : ''} />
            {recheckInFlight ? 'Patching spec…' : 'Patch spec & re-audit'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Patch outcome banner ─────────────────────────────────────────────

function PatchOutcomeBanner({ outcome }: { outcome: SpecPatchOutcome }) {
  const applied = outcome.status === 'applied';
  const counts = new Map<SpecPatchOutcome['appliedOps'][number], number>();
  for (const k of outcome.appliedOps) counts.set(k, (counts.get(k) ?? 0) + 1);
  const opParts = [...counts.entries()].map(([k, n]) => `${n}× ${k}`);

  const accent = applied ? 'var(--success, #22c55e)' : 'var(--destructive, #ef4444)';
  const bg = applied ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';

  return (
    <section
      className="rounded-md p-3 border"
      style={{ background: bg, borderColor: accent }}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          {applied
            ? <FileEdit size={14} style={{ color: accent }} />
            : <FileX2 size={14} style={{ color: accent }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-chat font-medium" style={{ color: "var(--text-primary)" }}>
            {applied ? 'Spec patched' : 'Patch rejected — spec preserved'}
          </div>
          {applied ? (
            <div className="text-ui mt-1" style={{ color: "var(--text-dim)" }}>
              {opParts.length > 0
                ? `Splicer applied ${opParts.join(', ')} to the spec.`
                : 'No structural changes were applied.'}
              {' '}
              Re-audit found <strong style={{ color: "var(--text-secondary)" }}>{outcome.remainingFindings}</strong>{' '}
              remaining finding{outcome.remainingFindings === 1 ? '' : 's'}.{' '}
              <span style={{ color: "var(--text-secondary)" }}>
                The Specification tab is now showing the updated content.
              </span>
            </div>
          ) : (
            <div className="text-ui mt-1" style={{ color: "var(--text-dim)" }}>
              The model's reply could not be safely spliced into the spec — the original content was kept untouched.
              {outcome.errors.length > 0 && (
                <ul className="mt-1 ml-4 list-disc">
                  {outcome.errors.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
          {outcome.warnings.length > 0 && (
            <details className="mt-2">
              <summary
                className="cursor-pointer text-detail select-none"
                style={{ color: "var(--text-secondary)" }}
              >
                {outcome.warnings.length} warning{outcome.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 ml-4 list-disc text-detail" style={{ color: "var(--text-dim)" }}>
                {outcome.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Creation log section ─────────────────────────────────────────────

function CreationLogSection({ log }: { log: SpecCreationLog }) {
  const [expanded, setExpanded] = useState(false);
  const wasCompacted = log.compactedAt !== null;
  const entries = log.entries;
  const visible = expanded ? entries : entries.slice(-8);
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  return (
    <section>
      <SectionHeader
        icon={
          <History
            size={14}
            style={{ color: wasCompacted ? 'var(--warning, #f59e0b)' : 'var(--text-secondary)' }}
          />
        }
        title="Creation log"
        subtitle={
          wasCompacted
            ? `${entries.length} section(s) recorded · context was compacted at ${new Date(log.compactedAt!).toLocaleTimeString()}`
            : `${entries.length} section(s) recorded · ${totalBytes.toLocaleString()} bytes total`
        }
      />
      <ul className="mt-2 ml-2 space-y-0.5 text-ui" style={{ color: 'var(--text-dim)' }}>
        {entries.length > 8 && !expanded && (
          <li className="text-detail" style={{ color: 'var(--text-secondary)' }}>
            … {entries.length - 8} earlier section(s) hidden
          </li>
        )}
        {visible.map((e, i) => {
          const isOpen = e.closedAt === null;
          const hashes = '#'.repeat(e.level);
          return (
            <li key={`${e.startedAt}-${i}`} className="flex items-baseline gap-2 flex-wrap">
              <span style={{ color: 'var(--text-secondary)' }}>{hashes}</span>
              <span>{e.title}</span>
              <span className="text-detail" style={{ color: 'var(--text-ghost)' }}>
                ({e.bytes.toLocaleString()} bytes)
              </span>
              {e.postCompaction && (
                <span
                  className="px-1.5 py-0.5 rounded text-detail font-medium"
                  style={{
                    background: 'rgba(245,158,11,0.15)',
                    color: 'var(--warning, #f59e0b)',
                  }}
                >
                  post-compact
                </span>
              )}
              {isOpen && (
                <span
                  className="px-1.5 py-0.5 rounded text-detail font-medium animate-pulse"
                  style={{
                    background: 'rgba(34,197,94,0.15)',
                    color: 'var(--success, #22c55e)',
                  }}
                >
                  RESUME HERE
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {entries.length > 8 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-ui flex items-center gap-1 hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? 'Show recent only' : `Show all ${entries.length}`}
        </button>
      )}
    </section>
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
          {failureCounts.uiOrphanEntity > 0 && <CountBadge label="orphan entity" count={failureCounts.uiOrphanEntity} severity="block" />}
          {failureCounts.uiUntriggeredEndpoint > 0 && <CountBadge label="untriggered endpoint" count={failureCounts.uiUntriggeredEndpoint} severity="block" />}
          {failureCounts.uiInvisibleErrors > 0 && <CountBadge label="invisible errors" count={failureCounts.uiInvisibleErrors} severity="warn" />}
          {failureCounts.uiSessionNoOutcome > 0 && <CountBadge label="session w/o outcome" count={failureCounts.uiSessionNoOutcome} severity="block" />}
          {failureCounts.uiFoundationMissingJustification > 0 && <CountBadge label="foundation w/o justification" count={failureCounts.uiFoundationMissingJustification} severity="warn" />}
          {failureCounts.uiFoundationNonContiguous > 0 && <CountBadge label="foundation out of order" count={failureCounts.uiFoundationNonContiguous} severity="warn" />}
          {failureCounts.uiFormNoValidation > 0 && <CountBadge label="form w/o validation" count={failureCounts.uiFormNoValidation} severity="warn" />}
          {failureCounts.uiListNoStates > 0 && <CountBadge label="list w/o states" count={failureCounts.uiListNoStates} severity="warn" />}
          {failureCounts.uiSessionTooLarge > 0 && <CountBadge label="session too large" count={failureCounts.uiSessionTooLarge} severity="block" />}
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

// ─── Stream stats section (Stage 4) ──────────────────────────────────

function StreamStatsSection({ stats }: { stats: StreamStats }) {
  const ok = stats.status === 'ok';
  const icon = ok
    ? <Activity size={14} style={{ color: "var(--text-secondary)" }} />
    : stats.status === 'errored'
      ? <XCircle size={14} style={{ color: "var(--destructive, #ef4444)" }} />
      : <AlertTriangle size={14} style={{ color: "var(--warning, #f59e0b)" }} />;

  return (
    <section>
      <SectionHeader
        icon={icon}
        title="Stream"
        subtitle={`${formatStatus(stats.status)} · ${stats.chunks.toLocaleString()} chunk${stats.chunks === 1 ? '' : 's'} · ${stats.bytes.toLocaleString()} bytes · ${formatDuration(stats.durationMs)}`}
      />
      {stats.note && (
        <div className="mt-2 text-ui" style={{ color: ok ? "var(--text-dim)" : "var(--warning, #f59e0b)" }}>
          {stats.note}
        </div>
      )}
      {!ok && (
        <div className="mt-2 text-ui" style={{ color: "var(--text-dim)" }}>
          {stats.status === 'stalled' && 'No deltas arrived for 30+ seconds before the stream ended. The model may have stopped responding mid-output.'}
          {stats.status === 'cancelled' && 'The stream was cancelled before completion. Buffered content was preserved.'}
          {stats.status === 'errored' && 'The stream errored before completion. Buffered content was preserved.'}
        </div>
      )}
    </section>
  );
}

function formatStatus(status: StreamStats['status']): string {
  switch (status) {
    case 'ok': return 'OK';
    case 'cancelled': return 'CANCELLED';
    case 'errored': return 'ERRORED';
    case 'stalled': return 'STALLED';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  const remSeconds = Math.round(s - minutes * 60);
  return `${minutes}m ${remSeconds}s`;
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
    case 'ui-orphan-entity':
    case 'ui-untriggered-endpoint':
    case 'ui-session-no-outcome':
    case 'ui-session-too-large':
      return 'block';
    case 'unmapped-section':
    case 'fidelity-drift':
    case 'missing-numeric':
    case 'placeholder-leaked':
    case 'byte-ratio-low':
    case 'ui-invisible-errors':
    case 'ui-foundation-missing-justification':
    case 'ui-foundation-non-contiguous':
    case 'ui-form-no-validation':
    case 'ui-list-no-states':
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
  uiOrphanEntity: number;
  uiUntriggeredEndpoint: number;
  uiInvisibleErrors: number;
  uiSessionNoOutcome: number;
  uiFoundationMissingJustification: number;
  uiFoundationNonContiguous: number;
  uiFormNoValidation: number;
  uiListNoStates: number;
  uiSessionTooLarge: number;
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
    uiOrphanEntity: 0,
    uiUntriggeredEndpoint: 0,
    uiInvisibleErrors: 0,
    uiSessionNoOutcome: 0,
    uiFoundationMissingJustification: 0,
    uiFoundationNonContiguous: 0,
    uiFormNoValidation: 0,
    uiListNoStates: 0,
    uiSessionTooLarge: 0,
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
      case 'ui-orphan-entity': c.uiOrphanEntity++; break;
      case 'ui-untriggered-endpoint': c.uiUntriggeredEndpoint++; break;
      case 'ui-invisible-errors': c.uiInvisibleErrors++; break;
      case 'ui-session-no-outcome': c.uiSessionNoOutcome++; break;
      case 'ui-foundation-missing-justification': c.uiFoundationMissingJustification++; break;
      case 'ui-foundation-non-contiguous': c.uiFoundationNonContiguous++; break;
      case 'ui-form-no-validation': c.uiFormNoValidation++; break;
      case 'ui-list-no-states': c.uiListNoStates++; break;
      case 'ui-session-too-large': c.uiSessionTooLarge++; break;
    }
  }
  return c;
}
