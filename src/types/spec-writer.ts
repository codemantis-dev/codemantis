export interface SpecConversation {
  id: string;
  project_path: string;
  messages: SpecMessage[];
  ai_provider: string;
  ai_model: string;
  status: 'gathering' | 'ready_to_write' | 'writing' | 'done';
  mode: 'new_application' | 'feature';
  context_loaded: boolean;
  templateCatalog?: string;
}

export interface SpecMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  displayContent?: string;
  attachments?: SpecAttachment[];
  message_type: 'conversation' | 'spec_document' | 'context_summary' | 'file_context';
  timestamp: string;
  parsedOptions?: string[];
}

export interface FileReadResult {
  path: string;
  found: boolean;
  content: string | null;
  totalLines: number;
  truncated: boolean;
}

export interface SpecAttachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  size: number;
  mime_type: string;
  preview_url?: string;
  text_content?: string;
  file_path: string;
}

export interface SpecDocumentInfo {
  filename: string;
  title: string;
  modified_at: string;
  size_bytes: number;
  path: string;
}

export interface SpecWriterUIState {
  is_open: boolean;
  chat_width: number;
  current_spec_content: string | null;
  selected_saved_spec: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Coverage audit — Stage 1 of SpecWriter quality enhancement.
// Detects when the produced spec drops, paraphrases, or silently rewrites
// content that was supplied verbatim in the user's input documents.
// ─────────────────────────────────────────────────────────────────────

/** Lightweight reference to one input document considered by the audit. */
export interface InputDocSummary {
  /** Display name (filename or `pasted-message-N`). */
  name: string;
  /** Total bytes of the input. */
  bytes: number;
  /** All H1/H2 headings parsed out of the input, in order. Empty string for unnumbered. */
  sections: InputSectionRef[];
}

/** One H1 / H2 from an input document. */
export interface InputSectionRef {
  /** "§3.2", "§16", "Overview" — whatever shows in the heading. */
  ref: string;
  /** The full heading text (without leading `#`). */
  title: string;
  level: 1 | 2;
  /** 0-based line index where the heading starts. */
  line: number;
}

/** A specific verbatim block found in the input that the output should reproduce. */
export interface FidelityZoneRef {
  /** What kind of content this is — controls how strict the comparison is. */
  kind:
    | 'sql'
    | 'code-block'
    | 'cost-figure'
    | 'model-name'
    | 'enum-value'
    | 'table-name'
    | 'copy-string'
    | 'numeric-bound';
  /** Source doc name. */
  source: string;
  /** A short, machine-comparable signature (e.g. table name, full INSERT, $-figure). */
  signature: string;
  /** Optional human label for the report ("21-row model_configurations INSERT"). */
  label?: string;
}

export type AuditFailure =
  | { kind: 'missing-section'; inputRef: string; title: string; source: string }
  | { kind: 'unmapped-section'; inputRef: string; title: string; source: string }
  | { kind: 'fidelity-drift'; zone: FidelityZoneRef }
  | { kind: 'schema-rename'; inputName: string; suspectedOutputName?: string }
  | { kind: 'missing-numeric'; what: 'cost' | 'timeout' | 'rate' | 'retention'; sample: string }
  | { kind: 'truncation'; lastHeading: string; tail: string }
  | { kind: 'placeholder-leaked'; quote: string }
  | { kind: 'byte-ratio-low'; ratio: number; floor: number };

export interface CoverageAuditReport {
  status: 'pass' | 'fail';
  inputDocs: InputDocSummary[];
  output: { sections: number; bytes: number };
  ratios: { byteRatio: number; sectionRatio: number };
  failures: AuditFailure[];
  /** Ready-to-send recheck prompts (one per failure cluster) for the LLM follow-up pass. */
  recheckPrompts: string[];
}

/** Mode-aware audit configuration. */
export interface CoverageAuditOptions {
  /** Floor for output_bytes / input_bytes. Default 0.6. Set 0 to disable. */
  byteRatioFloor?: number;
  /** Set true for new-application mode (no input doc to compare against). */
  skipForNewApp?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Input analyzer — Stage 2 of SpecWriter quality enhancement.
// Pre-flight check on user-provided input docs. Detects structural
// problems (doubled content, truncation, placeholders, dangling refs)
// and surfaces them so the user (and the AI) can resolve them BEFORE
// any spec is written. Compare to the coverage audit, which runs AFTER.
// ─────────────────────────────────────────────────────────────────────

export type AnalysisFinding =
  | {
      kind: 'doubled-input';
      source: string;
      duplicateHeading: string;
      occurrences: number;
      severity: 'block';
    }
  | {
      kind: 'truncated-input';
      source: string;
      lastHeading: string;
      tail: string;
      severity: 'warn';
    }
  | {
      kind: 'placeholder-in-input';
      source: string;
      quote: string;
      severity: 'warn';
    }
  | {
      kind: 'dangling-cross-ref';
      source: string;
      ref: string;
      severity: 'warn';
    }
  | {
      kind: 'thin-section';
      source: string;
      ref: string;
      title: string;
      bytes: number;
      severity: 'warn';
    }
  | {
      kind: 'fidelity-zone-summary';
      source: string;
      counts: { sql: number; cost: number; model: number; enum: number };
      severity: 'info';
    };

/** A clarifying question the analyzer wants surfaced via ?> options. */
export interface AnalyzerClarification {
  id: string;
  topic: string;
  question: string;
  options: string[];
  /** Lines from the input the user can reference. */
  excerpt?: string;
}

export interface InputAnalysis {
  /** Per-doc heading parse used by the audit and the report renderer. */
  docs: InputDocSummary[];
  /** All structural findings, ordered by severity (block → warn → info). */
  findings: AnalysisFinding[];
  /** Questions the analyzer wants the user to answer before SpecWriter proceeds. */
  clarifications: AnalyzerClarification[];
  /**
   * Markdown-ready report — embedded as a context_summary system message so
   * BOTH the user and the AI can see what the analyzer found.
   */
  report: string;
}

// ─────────────────────────────────────────────────────────────────────
// Stream stats — Stage 4 of SpecWriter quality enhancement.
// Per-project metadata about the most recent SpecWriter stream, so the
// user (and Coverage panel) can SEE silent truncation: tiny byte counts,
// stalled streams, server-side cuts.
// ─────────────────────────────────────────────────────────────────────

export type StreamStatus = 'ok' | 'cancelled' | 'errored' | 'stalled';

export interface StreamStats {
  /** Number of delta chunks received from the model/CLI. */
  chunks: number;
  /** Total bytes accumulated in the streamBuffer. */
  bytes: number;
  /** Wall-clock duration from first chunk to terminal event, ms. */
  durationMs: number;
  /** ISO timestamp of the first delta chunk. */
  startedAt: string;
  /** ISO timestamp of the terminal event (done/cancelled/error/stall watchdog). */
  endedAt: string;
  status: StreamStatus;
  /** Optional context (e.g. cancel reason, error message, stall threshold). */
  note?: string;
}
