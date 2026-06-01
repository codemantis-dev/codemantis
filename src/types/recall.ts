/**
 * Frontend mirrors of the recall_* Tauri command payloads.
 *
 * Kept narrow on purpose: we only model the fields the sidebar and
 * Settings panel render. The full Note/Vault types live in Rust; this
 * layer just types the wire surface.
 */

export type RecallMode = "off" | "suggested" | "enforced";

export type LoggingLevel = "silent" | "summary" | "full";

export interface RecallConfig {
  enabled: boolean;
  mode: RecallMode;
  enricherProvider: string;
  enricherModel: string;
  enricherThinking: string;
  harvesterProvider: string;
  harvesterModel: string;
  harvesterThinking: string;
  metaVaultPath: string | null;
  crossProjectLinking: boolean;
  autoHarvestTriggers: string[];
  autoEnrichSources: string[];
  loggingLevel: LoggingLevel;
  tokenBudgetPerBrief: number;
  staleThresholdDays: number;
  showRecallPanel: boolean;
  commitVaultToGit: boolean;
}

export interface RecallIndexStatus {
  vaultId: number;
  projectPath: string;
  vaultPath: string;
  isMeta: boolean;
  noteCount: number;
  lastIndexedAt: string | null;
}

export interface RecallStatusResponse {
  registered: boolean;
  status: RecallIndexStatus | null;
}

export interface RecallReindexResponse {
  notesIndexed: number;
  partialParses: number;
  status: RecallIndexStatus | null;
}

export interface RecallEnrichmentRow {
  occurredAt: string;
  promptSummary: string | null;
  /** JSON-encoded array of note slugs that were injected. */
  notesInjectedJson: string;
  briefTokens: number | null;
  modelUsed: string | null;
  costUsd: number | null;
}

export interface RecallHarvestRow {
  occurredAt: string;
  commitHash: string | null;
  fidelityStatus: string | null;
  noteSlug: string | null;
  modelUsed: string | null;
  costUsd: number | null;
}

export interface RecallIndexedNote {
  rowId: number;
  vaultId: number;
  noteId: string;
  noteType: string;
  title: string;
  status: string;
  trust: string;
  severity: string | null;
  filePath: string;
}

export interface RecallHealth {
  noteCount: number;
  /** Tuple list `[type, count]` from `recall_notes_by_type`. */
  noteCountsByType: Array<[string, number]>;
  harvestsTotal: number;
  lastIndexedAt: string | null;
  vaultPath: string | null;
}

export interface RecallSeedReport {
  ingestExistingMemoryFiles: number;
  ingestAdrs: number;
  seededHotspotLandmines: number;
  seededCochangePatterns: number;
  manifestOutcome: string;
  notesIndexed: number;
  elapsedMs: number;
}

export interface RecallSeedResponse {
  report: RecallSeedReport;
  status: RecallIndexStatus | null;
}

export function defaultRecallConfig(): RecallConfig {
  return {
    enabled: false,
    mode: "suggested",
    enricherProvider: "google",
    enricherModel: "gemini-3.1-flash-lite",
    enricherThinking: "off",
    harvesterProvider: "google",
    harvesterModel: "gemini-3.1-flash-lite",
    harvesterThinking: "off",
    metaVaultPath: null,
    crossProjectLinking: true,
    autoHarvestTriggers: ["on_commit", "on_session_end"],
    autoEnrichSources: ["agent_prompts"],
    loggingLevel: "summary",
    tokenBudgetPerBrief: 2000,
    staleThresholdDays: 30,
    showRecallPanel: true,
    commitVaultToGit: false,
  };
}
