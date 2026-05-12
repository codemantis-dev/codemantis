import { describe, it, expect } from "vitest";
import {
  inferVocab,
  renderVocabHint,
  vocabSubstitutionsFor,
} from "./self-drive-evidence-vocab";

describe("inferVocab", () => {
  it("picks MCP Supabase when cloud URL + MCP both present", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: true,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: false,
      hasMcpSupabase: true,
      supabaseCliLinked: true,
    });
    expect(v.sqlTransport).toMatch(/MCP/);
    expect(v.sqlCommandTemplate).toMatch(/mcp__supabase__execute_sql/);
    expect(v.sqlCommandTemplate).not.toMatch(/psql/);
  });

  it("picks cloud Supabase CLI when CLI linked but no MCP", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: true,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: false,
      hasMcpSupabase: false,
      supabaseCliLinked: true,
    });
    expect(v.sqlCommandTemplate).toMatch(/supabase db query --linked/);
    expect(v.sqlCommandTemplate).not.toMatch(/psql/);
  });

  it("falls back to CLI for cloud Supabase even when CLI linked flag is unknown", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: true,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: false,
      hasMcpSupabase: false,
      supabaseCliLinked: false,
    });
    expect(v.sqlCommandTemplate).toMatch(/supabase db query --linked/);
  });

  it("picks local Supabase when supabase/config.toml present", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: false,
      hasLocalSupabaseConfig: true,
      hasDatabaseUrl: false,
      hasMcpSupabase: false,
      supabaseCliLinked: false,
    });
    expect(v.sqlTransport).toMatch(/Local Supabase/);
  });

  it("picks raw Postgres only when DATABASE_URL set and no Supabase", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: false,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: true,
      hasMcpSupabase: false,
      supabaseCliLinked: false,
    });
    expect(v.sqlTransport).toMatch(/Raw Postgres/);
    expect(v.sqlCommandTemplate).toMatch(/psql \$DATABASE_URL/);
  });

  it("falls back to generic when nothing detected", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: false,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: false,
      hasMcpSupabase: false,
      supabaseCliLinked: false,
    });
    expect(v.sqlTransport).toMatch(/No SQL transport/);
  });
});

describe("renderVocabHint", () => {
  it("includes the SQL command template and migration list path", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: true,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: false,
      hasMcpSupabase: true,
      supabaseCliLinked: true,
    });
    const hint = renderVocabHint(v);
    expect(hint).toMatch(/EVIDENCE VOCABULARY/);
    expect(hint).toMatch(/mcp__supabase__execute_sql/);
    expect(hint).toMatch(/supabase_migrations\.schema_migrations|supabase migration list/);
  });

  it("uses 'supabase migration list' for CLI vocab", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: true,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: false,
      hasMcpSupabase: false,
      supabaseCliLinked: true,
    });
    const hint = renderVocabHint(v);
    expect(hint).toMatch(/supabase migration list/);
  });
});

describe("vocabSubstitutionsFor", () => {
  it("produces psql → vocab substitutions when vocab is not raw Postgres", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: true,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: false,
      hasMcpSupabase: true,
      supabaseCliLinked: false,
    });
    const subs = vocabSubstitutionsFor(v);
    expect(subs.length).toBeGreaterThan(0);
    const sample = 'psql $DATABASE_URL -c "SELECT 1"';
    let out = sample;
    for (const { needle, replacement } of subs) {
      out = out.replace(needle, replacement);
    }
    expect(out).not.toMatch(/psql \$DATABASE_URL/);
    expect(out).toMatch(/mcp__supabase__execute_sql/);
  });

  it("produces no substitutions when vocab is raw Postgres", () => {
    const v = inferVocab({
      hasSupabaseCloudUrl: false,
      hasLocalSupabaseConfig: false,
      hasDatabaseUrl: true,
      hasMcpSupabase: false,
      supabaseCliLinked: false,
    });
    const subs = vocabSubstitutionsFor(v);
    expect(subs.length).toBe(0);
  });
});
