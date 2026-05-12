// ═══════════════════════════════════════════════════════════════════════
// Self-Drive — Project Evidence Vocabulary
// ═══════════════════════════════════════════════════════════════════════
//
// Different projects have different ways to produce the SAME kind of
// evidence:
//
//   - Cloud Supabase project (CodeMantis pattern):
//       SQL evidence via `mcp__supabase__execute_sql` or
//       `supabase db query --linked "SELECT ..."`. No local psql.
//       No DATABASE_URL env var.
//
//   - Local Supabase + CLI project:
//       SQL evidence via `supabase db query "..."` or
//       `psql -h localhost -p 54322 -U postgres -c "..."`.
//
//   - Raw Postgres project:
//       SQL evidence via `psql $DATABASE_URL -c "..."`.
//
// Self-Drive's prompts used to hardcode `psql $DATABASE_URL -c` regardless
// of project shape. When the project didn't have that path, the worker
// correctly rebutted, the orchestrator interpreted the rebuttal as
// refusal, and the loop ran. This module fixes that by detecting the
// project's actual capabilities and choosing the right evidence command
// vocabulary.
//
// Pure module: detection inputs are passed in (so it stays testable in
// jsdom). The Tauri-facing wrapper that gathers detection signals lives
// in selfDriveStore.

/** Inputs the caller gathers from the project (env, files, MCP config). */
export interface EvidenceDetectionInputs {
  /** `VITE_SUPABASE_URL` or `SUPABASE_URL` is present in `.env.local`. */
  hasSupabaseCloudUrl: boolean;
  /** `supabase/config.toml` exists in the project (local Supabase stack). */
  hasLocalSupabaseConfig: boolean;
  /** `DATABASE_URL` (or `POSTGRES_URL` / `SUPABASE_DB_URL`) is set. */
  hasDatabaseUrl: boolean;
  /** An MCP server entry for Supabase is configured (`mcp__supabase__*`). */
  hasMcpSupabase: boolean;
  /** The Supabase CLI is on PATH and the project is linked. */
  supabaseCliLinked: boolean;
}

/**
 * The canonical evidence-command vocabulary for a project, used by every
 * prompt template that needs to suggest a command (verify/fix/recovery).
 * Each field returns the EXACT command string the worker should run —
 * pre-substituted with project-appropriate flags.
 */
export interface EvidenceVocab {
  /** Human-readable label for the SQL transport this project uses. */
  sqlTransport: string;
  /** Example SQL command — substitute {QUERY} for the SELECT/etc. */
  sqlCommandTemplate: string;
  /** Example command for listing applied migrations. */
  listMigrationsCommand: string;
  /** Example for applying pending migrations. */
  applyMigrationsCommand: string;
  /** Example for deploying an edge function: substitute {NAME}. */
  deployEdgeFunctionTemplate: string;
  /** Notes/caveats the prompt should print to the worker. */
  notes: string[];
}

const VOCAB_CLOUD_SUPABASE: EvidenceVocab = {
  sqlTransport: "Supabase CLI (linked, cloud project)",
  sqlCommandTemplate: 'supabase db query --linked "{QUERY}"',
  listMigrationsCommand: "supabase migration list",
  applyMigrationsCommand: "supabase db push",
  deployEdgeFunctionTemplate: "supabase functions deploy {NAME} --no-verify-jwt",
  notes: [
    "This project uses Supabase in the cloud. There is NO local Postgres and NO DATABASE_URL.",
    'Run SQL via `supabase db query --linked "<SQL>"` — NOT `psql $DATABASE_URL`.',
    "If the MCP Supabase tools are available (mcp__supabase__execute_sql), they hit the same cloud DB and produce equivalent evidence.",
  ],
};

const VOCAB_MCP_SUPABASE: EvidenceVocab = {
  sqlTransport: "MCP Supabase tools (cloud project)",
  sqlCommandTemplate:
    'mcp__supabase__execute_sql with body `{"query":"{QUERY}"}`',
  listMigrationsCommand:
    'mcp__supabase__execute_sql with body `{"query":"SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"}`',
  applyMigrationsCommand: "supabase db push",
  deployEdgeFunctionTemplate: "supabase functions deploy {NAME} --no-verify-jwt",
  notes: [
    "This project uses Supabase via MCP tools — `mcp__supabase__execute_sql` and `mcp__supabase__execute_sql_writer` target the cloud DB.",
    "DO NOT suggest `psql $DATABASE_URL` — the env var is not set in this project.",
    "Falling back to `supabase db query --linked` is also valid if the CLI is preferred.",
  ],
};

const VOCAB_LOCAL_SUPABASE: EvidenceVocab = {
  sqlTransport: "Local Supabase stack",
  sqlCommandTemplate:
    'supabase db query "{QUERY}"   # local stack, or use psql -h localhost -p 54322 -U postgres',
  listMigrationsCommand: "supabase migration list",
  applyMigrationsCommand: "supabase db push",
  deployEdgeFunctionTemplate: "supabase functions deploy {NAME} --no-verify-jwt",
  notes: [
    "This project uses a local Supabase stack (supabase/config.toml present).",
    "Local Postgres is at localhost:54322; the Supabase CLI wraps it.",
  ],
};

const VOCAB_RAW_POSTGRES: EvidenceVocab = {
  sqlTransport: "Raw Postgres (psql)",
  sqlCommandTemplate: 'psql $DATABASE_URL -c "{QUERY}"',
  listMigrationsCommand:
    'psql $DATABASE_URL -c "SELECT version FROM schema_migrations ORDER BY version"',
  applyMigrationsCommand:
    "Apply migrations using whichever migration tool the project ships (alembic, drizzle, prisma, knex, etc.)",
  deployEdgeFunctionTemplate: "(no edge function concept for this project)",
  notes: [
    "Raw Postgres setup: DATABASE_URL is the canonical SQL transport.",
  ],
};

const VOCAB_GENERIC: EvidenceVocab = {
  sqlTransport: "No SQL transport detected",
  sqlCommandTemplate:
    "(no SQL transport detected — suggest a non-SQL evidence path or quote the relevant file)",
  listMigrationsCommand: "(N/A — no SQL DB detected for this project)",
  applyMigrationsCommand: "(N/A — no SQL DB detected for this project)",
  deployEdgeFunctionTemplate: "(no edge function concept for this project)",
  notes: [
    "No SQL transport was detected for this project. Don't suggest SQL evidence in prompts; use filesystem or test-output evidence instead.",
  ],
};

/**
 * Pure inference: given detection inputs, pick the most appropriate
 * vocab. Order matters — MCP wins over CLI when both available, because
 * MCP is the path Self-Drive can actually exercise on the user's behalf
 * via tool calls.
 */
export function inferVocab(d: EvidenceDetectionInputs): EvidenceVocab {
  // 1. Cloud Supabase via MCP tools wins (no DATABASE_URL required).
  if (d.hasSupabaseCloudUrl && d.hasMcpSupabase) {
    return VOCAB_MCP_SUPABASE;
  }
  // 2. Cloud Supabase via CLI link.
  if (d.hasSupabaseCloudUrl && d.supabaseCliLinked) {
    return VOCAB_CLOUD_SUPABASE;
  }
  // 3. Cloud Supabase URL but neither MCP nor CLI link signal — assume
  //    CLI is available because that's how Supabase users typically work.
  if (d.hasSupabaseCloudUrl && !d.hasLocalSupabaseConfig) {
    return VOCAB_CLOUD_SUPABASE;
  }
  // 4. Local Supabase stack.
  if (d.hasLocalSupabaseConfig) {
    return VOCAB_LOCAL_SUPABASE;
  }
  // 5. Raw Postgres (DATABASE_URL set, no Supabase).
  if (d.hasDatabaseUrl) {
    return VOCAB_RAW_POSTGRES;
  }
  // 6. No SQL.
  return VOCAB_GENERIC;
}

/**
 * Render the vocab as a prompt-snippet describing how the worker should
 * produce SQL evidence in this project. Suitable for splicing into
 * VERIFY/FIX/RECOVERY prompts in place of hardcoded `psql` examples.
 */
export function renderVocabHint(vocab: EvidenceVocab): string {
  return [
    `EVIDENCE VOCABULARY for this project (${vocab.sqlTransport}):`,
    `- SQL: \`${vocab.sqlCommandTemplate}\``,
    `- Migrations list: \`${vocab.listMigrationsCommand}\``,
    `- Apply migrations: \`${vocab.applyMigrationsCommand}\``,
    `- Deploy edge function: \`${vocab.deployEdgeFunctionTemplate}\``,
    ...vocab.notes.map((n) => `- ${n}`),
  ].join("\n");
}

/**
 * Vocab substitution rules for the blocker satisfiability validator. If
 * a blocker's resolutionCriteria references a command not available in
 * this project's vocab, swap it to the correct one.
 */
export function vocabSubstitutionsFor(vocab: EvidenceVocab): Array<{
  needle: RegExp;
  replacement: string;
}> {
  const out: Array<{ needle: RegExp; replacement: string }> = [];
  // If this project doesn't use raw psql, swap any `psql $DATABASE_URL`
  // mention to the project's vocab.
  if (!vocab.sqlCommandTemplate.startsWith("psql $DATABASE_URL")) {
    out.push({
      needle: /psql\s+\$\{?DATABASE_URL\}?\s+-c\s+["'][^"']+["']/g,
      replacement: vocab.sqlCommandTemplate.replace("{QUERY}", "<SQL>"),
    });
    out.push({
      needle: /psql\s+\$\{?DATABASE_URL\}?/g,
      replacement: vocab.sqlCommandTemplate.replace(' "{QUERY}"', "").replace("{QUERY}", "<SQL>"),
    });
  }
  return out;
}
