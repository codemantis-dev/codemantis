//! Recall model-quality eval harness.
//!
//! Answers the question "is the configured model smart enough for
//! Recall's actual jobs?" by running the **real production prompts** —
//! the enricher `select` step and the harvester `generate` step — against
//! a hand-labelled golden set, then scoring the live output.
//!
//! Unlike the unit/integration suites (which mock the LLM and only test
//! the pipeline plumbing), this hits a real provider and measures the
//! model's *judgment*: which candidate notes it picks, the authority
//! label it assigns, whether the note it writes hallucinates symbols not
//! in the diff.
//!
//! Gated `#[ignore]` so it never runs in CI or affects the test-count
//! floors — it needs a live key and spends a few cents.
//!
//! Run (model-parameterized; defaults to gemini-3.1-flash-lite):
//! ```
//! GEMINI_API_KEY=… cargo test --test recall_model_eval \
//!   recall_model_quality_eval -- --ignored --nocapture
//! ```
//! Compare another model:
//! ```
//! RECALL_EVAL_MODEL=gemini-3.5-flash GEMINI_API_KEY=… cargo test … --ignored --nocapture
//! RECALL_EVAL_PROVIDER=openai RECALL_EVAL_MODEL=gpt-5.4-mini OPENAI_API_KEY=… cargo test … --ignored --nocapture
//! ```

use std::collections::HashMap;

use chrono::{TimeZone, Utc};
use codemantis_lib::recall::config::RecallConfig;
use codemantis_lib::recall::enricher::gather::{Candidate, GatherSource};
use codemantis_lib::recall::enricher::select::{select, AuthorityLabel};
use codemantis_lib::recall::git::{ChangeKind, CommitInfo, FileChange};
use codemantis_lib::recall::harvester::fidelity::{check as fidelity_check, FidelityStatus};
use codemantis_lib::recall::harvester::generate::generate;
use codemantis_lib::recall::index::query::IndexedNote;
use codemantis_lib::recall::llm_client::RealLlmClient;
use codemantis_lib::recall::vault::NoteType;

// ─────────────────────────── config / key ───────────────────────────

fn eval_provider() -> String {
    std::env::var("RECALL_EVAL_PROVIDER").unwrap_or_else(|_| "gemini".to_string())
}

fn eval_model() -> String {
    std::env::var("RECALL_EVAL_MODEL").unwrap_or_else(|_| "gemini-3.1-flash-lite".to_string())
}

fn eval_config() -> RecallConfig {
    let provider = eval_provider();
    let model = eval_model();
    RecallConfig {
        enabled: true,
        enricher_provider: provider.clone(),
        enricher_model: model.clone(),
        harvester_provider: provider,
        harvester_model: model,
        ..RecallConfig::default()
    }
}

fn api_key(provider: &str) -> String {
    if let Ok(k) = std::env::var("RECALL_EVAL_API_KEY") {
        if !k.is_empty() {
            return k;
        }
    }
    let var = match provider {
        "gemini" | "google" => "GEMINI_API_KEY",
        "openai" => "OPENAI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        _ => "GEMINI_API_KEY",
    };
    std::env::var(var).unwrap_or_default()
}

// ─────────────────────────── builders ───────────────────────────

fn idx_note(id: &str, ty: &str, trust: &str, title: &str) -> IndexedNote {
    IndexedNote {
        row_id: 0,
        vault_id: 1,
        note_id: id.to_string(),
        note_type: ty.to_string(),
        title: title.to_string(),
        status: "active".to_string(),
        trust: trust.to_string(),
        severity: None,
        last_verified: "2026-06-01".to_string(),
        file_path: format!("notes/{}/{}.md", ty, id),
    }
}

/// A non-mandatory candidate (FtsMatch) so the LLM actually has to judge
/// it — mandatory landmines bypass the model entirely.
fn cand(id: &str, ty: &str, title: &str, matched: &str) -> Candidate {
    Candidate {
        note: idx_note(id, ty, "high", title),
        source: GatherSource::FtsMatch,
        matched_on: matched.to_string(),
    }
}

struct SelectCase {
    name: &'static str,
    prompt: &'static str,
    candidates: Vec<Candidate>,
    /// note_ids that a competent model should select.
    expected: Vec<&'static str>,
    /// Optional authority-label expectations for selected notes.
    expected_authority: Vec<(&'static str, AuthorityLabel)>,
}

fn select_cases() -> Vec<SelectCase> {
    vec![
        SelectCase {
            name: "relevant_vs_irrelevant",
            prompt: "Add rate limiting to the content generation API endpoint.",
            candidates: vec![
                cand("api-gen", "module", "generate-content edge function: request budget and timeout limits", "generate"),
                cand("auth-cookie", "decision", "Auth middleware uses cookie-only sessions; bearer tokens rejected", "auth"),
                cand("css-cards", "pattern", "Tailwind spacing scale convention for card components", "content"),
            ],
            expected: vec!["api-gen"],
            expected_authority: vec![],
        },
        SelectCase {
            name: "constraint_surfaces",
            prompt: "Refactor the session handling in the auth layer to support refresh.",
            candidates: vec![
                cand("auth-cookie", "decision", "DECISION: auth uses cookie-only sessions; bearer tokens are rejected", "session"),
                cand("css-cards", "pattern", "Tailwind spacing scale convention for cards", "layer"),
            ],
            expected: vec!["auth-cookie"],
            expected_authority: vec![("auth-cookie", AuthorityLabel::Constraint)],
        },
        SelectCase {
            name: "where_to_look",
            prompt: "Add a published_at column to the content_pages table and surface it in the editor.",
            candidates: vec![
                cand("schema-pages", "module", "WHERE TO LOOK: content_pages schema + migrations live in supabase/migrations", "content_pages"),
                cand("retry-fly", "pattern", "Edge functions use exponential backoff for Fly dispatch", "editor"),
            ],
            expected: vec!["schema-pages"],
            expected_authority: vec![("schema-pages", AuthorityLabel::WhereToLook)],
        },
        SelectCase {
            name: "prior_art",
            prompt: "Implement retry logic for the Fly.io processor dispatch.",
            candidates: vec![
                cand("retry-fly", "pattern", "PRIOR ART: edge functions already use exponential backoff with jitter for Fly dispatch", "fly"),
                cand("auth-cookie", "decision", "Auth uses cookie-only sessions", "dispatch"),
            ],
            expected: vec!["retry-fly"],
            expected_authority: vec![("retry-fly", AuthorityLabel::PriorArt)],
        },
        SelectCase {
            name: "all_irrelevant_returns_empty",
            prompt: "Update the README badges and fix a typo in the docs.",
            candidates: vec![
                cand("api-gen", "module", "generate-content edge function request budget", "readme"),
                cand("auth-cookie", "decision", "Auth uses cookie-only sessions", "docs"),
                cand("retry-fly", "pattern", "Exponential backoff for Fly dispatch", "fix"),
            ],
            expected: vec![],
            expected_authority: vec![],
        },
        SelectCase {
            name: "multiple_relevant",
            prompt: "Fix the bug where generate-content returns 500 on an empty prompt, and update the dashboard error toast.",
            candidates: vec![
                cand("api-gen", "module", "generate-content edge function: input validation and error responses", "generate-content"),
                cand("dash-toast", "module", "Dashboard error toast component and error surfacing", "dashboard"),
                cand("auth-cookie", "decision", "Auth uses cookie-only sessions", "empty"),
            ],
            expected: vec!["api-gen", "dash-toast"],
            expected_authority: vec![],
        },
        SelectCase {
            name: "test_task_picks_hook_and_test_convention",
            prompt: "Add unit tests for the content generation hook.",
            candidates: vec![
                cand("hook-gen", "module", "useContentCreation hook orchestrates the generation flow", "content"),
                cand("test-conv", "pattern", "Testing convention: vitest, co-located *.test.ts, reset stores in beforeEach", "tests"),
                cand("dns-domain", "module", "Domain page DNS verification flow", "generation"),
            ],
            expected: vec!["hook-gen", "test-conv"],
            expected_authority: vec![],
        },
        SelectCase {
            name: "settings_page_styling",
            prompt: "Style the dropdown on the customer settings page to match the theme.",
            candidates: vec![
                cand("settings-page", "module", "CustomerSettings page layout and form structure", "settings"),
                cand("css-dropdown", "pattern", "Tailwind: use bg-bg-elevated + border-border for dropdowns", "dropdown"),
                cand("api-gen", "module", "generate-content edge function request budget", "page"),
            ],
            expected: vec!["settings-page", "css-dropdown"],
            expected_authority: vec![],
        },
    ]
}

struct HarvestCase {
    name: &'static str,
    note_type: NoteType,
    subject: &'static str,
    message: &'static str,
    /// (path, added_lines, removed_lines)
    files: Vec<(&'static str, Vec<&'static str>, Vec<&'static str>)>,
}

fn build_commit(c: &HarvestCase) -> CommitInfo {
    let files = c
        .files
        .iter()
        .map(|(path, added, removed)| {
            let mut diff = format!("diff --git a/{p} b/{p}\n--- a/{p}\n+++ b/{p}\n", p = path);
            for l in removed {
                diff.push_str(&format!("-{}\n", l));
            }
            for l in added {
                diff.push_str(&format!("+{}\n", l));
            }
            FileChange {
                path: path.to_string(),
                kind: ChangeKind::Modified,
                added_lines: added.iter().map(|s| s.to_string()).collect(),
                removed_lines: removed.iter().map(|s| s.to_string()).collect(),
                diff_text: diff,
            }
        })
        .collect();
    CommitInfo {
        hash: "evalcommit0001".to_string(),
        author_name: "Eval".to_string(),
        author_email: "eval@example.com".to_string(),
        timestamp: Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
        subject: c.subject.to_string(),
        full_message: c.message.to_string(),
        files,
    }
}

fn harvest_cases() -> Vec<HarvestCase> {
    vec![
        HarvestCase {
            name: "bugfix_empty_guard",
            note_type: NoteType::Landmine,
            subject: "fix(generate-content): 500 on empty prompt",
            message: "fix(generate-content): 500 on empty prompt\n\nThe handler dereferenced prompt before the null check; guard it and return a 400 instead.",
            files: vec![(
                "supabase/functions/generate-content/index.ts",
                vec![
                    "  if (!body.prompt || body.prompt.trim() === \"\") {",
                    "    return new Response(JSON.stringify({ error: \"prompt required\" }), { status: 400 });",
                    "  }",
                    "  const result = await generateContent(body.prompt);",
                ],
                vec!["  const result = await generateContent(body.prompt);"],
            )],
        },
        HarvestCase {
            name: "feature_new_endpoint",
            note_type: NoteType::Module,
            subject: "feat(api): add cms-public-api list endpoint",
            message: "feat(api): add cms-public-api list endpoint\n\nExposes published pages over a read-only public API keyed by domain.",
            files: vec![(
                "supabase/functions/cms-public-api/index.ts",
                vec![
                    "export async function handleListPages(req: Request): Promise<Response> {",
                    "  const domain = new URL(req.url).searchParams.get(\"domain\");",
                    "  const pages = await listPublishedPages(domain);",
                    "  return Response.json({ pages });",
                    "}",
                ],
                vec![],
            )],
        },
        HarvestCase {
            name: "refactor_extract_hook",
            note_type: NoteType::Pattern,
            subject: "refactor(content): extract useContentCreation hook",
            message: "refactor(content): extract useContentCreation hook\n\nPull the generation orchestration out of ContentPageEditor into a reusable hook.",
            files: vec![
                (
                    "src/hooks/useContentCreation.ts",
                    vec![
                        "export function useContentCreation(pageId: string) {",
                        "  const [status, setStatus] = useState<GenStatus>(\"idle\");",
                        "  const generate = useCallback(async () => { /* ... */ }, [pageId]);",
                        "  return { status, generate };",
                        "}",
                    ],
                    vec![],
                ),
                (
                    "src/components/content/ContentPageEditor.tsx",
                    vec!["  const { status, generate } = useContentCreation(pageId);"],
                    vec![
                        "  const [status, setStatus] = useState<GenStatus>(\"idle\");",
                        "  const generate = async () => { /* inline */ };",
                    ],
                ),
            ],
        },
        HarvestCase {
            name: "migration_add_column",
            note_type: NoteType::Module,
            subject: "feat(db): add published_at to content_pages",
            message: "feat(db): add published_at to content_pages\n\nTrack first-publish time for the public API ordering.",
            files: vec![(
                "supabase/migrations/20260601_published_at.sql",
                vec![
                    "ALTER TABLE content_pages ADD COLUMN published_at timestamptz;",
                    "CREATE INDEX idx_content_pages_published_at ON content_pages(published_at);",
                ],
                vec![],
            )],
        },
    ]
}

// ─────────────────────────── the eval ───────────────────────────

#[tokio::test]
#[ignore = "live-model quality eval — set GEMINI_API_KEY (or RECALL_EVAL_*) and run with --ignored --nocapture"]
async fn recall_model_quality_eval() {
    let provider = eval_provider();
    let model = eval_model();
    let key = api_key(&provider);
    if key.is_empty() {
        println!(
            "\n[recall-eval] SKIPPED — no API key. Set GEMINI_API_KEY (or RECALL_EVAL_API_KEY) and re-run with --ignored --nocapture.\n"
        );
        return;
    }
    let cfg = eval_config();
    let pricing: HashMap<String, codemantis_lib::commands::settings::ModelPricing> = HashMap::new();
    let llm = RealLlmClient::new(pricing);

    println!("\n══════════════════════════════════════════════════════════════");
    println!(" RECALL MODEL QUALITY EVAL");
    println!(" provider={provider}  model={model}");
    println!("══════════════════════════════════════════════════════════════");

    // ── Part A: enricher selection ──
    println!("\n── A. ENRICHER · selection judgment ──\n");
    let (mut tp, mut fp, mut fn_) = (0u32, 0u32, 0u32);
    let (mut auth_total, mut auth_ok) = (0u32, 0u32);
    let (mut sel_in_tok, mut sel_out_tok) = (0u32, 0u32);
    let mut sel_errors = 0u32;

    for case in select_cases() {
        let result = select(&llm, &key, &cfg, case.prompt, &case.candidates).await;
        match result {
            Ok(sel) => {
                sel_in_tok += sel.input_tokens;
                sel_out_tok += sel.output_tokens;
                let picked: Vec<&str> = sel.selected.iter().map(|s| s.note_id.as_str()).collect();
                let (mut c_tp, mut c_fp, mut c_fn) = (0u32, 0u32, 0u32);
                for id in &picked {
                    if case.expected.contains(id) {
                        c_tp += 1;
                    } else {
                        c_fp += 1;
                    }
                }
                for id in &case.expected {
                    if !picked.contains(id) {
                        c_fn += 1;
                    }
                }
                tp += c_tp;
                fp += c_fp;
                fn_ += c_fn;
                // Authority accuracy on correctly-selected notes.
                for (eid, eauth) in &case.expected_authority {
                    if let Some(s) = sel.selected.iter().find(|s| &s.note_id.as_str() == eid) {
                        auth_total += 1;
                        if s.authority == *eauth {
                            auth_ok += 1;
                        }
                    }
                }
                let verdict = if c_fp == 0 && c_fn == 0 { "✓" } else { "✗" };
                println!(
                    "  {verdict} {:<34} picked={:?} expected={:?}",
                    case.name, picked, case.expected
                );
            }
            Err(e) => {
                sel_errors += 1;
                println!("  ! {:<34} LLM ERROR: {}", case.name, e);
            }
        }
    }

    let precision = if tp + fp == 0 { 1.0 } else { tp as f64 / (tp + fp) as f64 };
    let recall = if tp + fn_ == 0 { 1.0 } else { tp as f64 / (tp + fn_) as f64 };
    let f1 = if precision + recall == 0.0 {
        0.0
    } else {
        2.0 * precision * recall / (precision + recall)
    };
    let auth_acc = if auth_total == 0 { 1.0 } else { auth_ok as f64 / auth_total as f64 };

    println!("\n  selection:  precision={:.2}  recall={:.2}  F1={:.2}  (TP={tp} FP={fp} FN={fn_})", precision, recall, f1);
    println!("  authority:  accuracy={:.2}  ({auth_ok}/{auth_total} correct labels)", auth_acc);
    println!("  llm calls:  {} errors, ~{} in / {} out tokens", sel_errors, sel_in_tok, sel_out_tok);

    // ── Part B: harvester generation ──
    println!("\n── B. HARVESTER · note generation + fidelity ──\n");
    let mut h_total = 0u32;
    let mut h_ok = 0u32;
    let mut h_clean = 0u32;
    let mut h_structural = 0u32;
    let mut h_platitude = 0u32;
    let (mut h_in_tok, mut h_out_tok) = (0u32, 0u32);

    for case in harvest_cases() {
        h_total += 1;
        let commit = build_commit(&case);
        match generate(&llm, &key, &cfg, &commit, case.note_type).await {
            Ok(gen) => {
                h_ok += 1;
                h_in_tok += gen.usage.input_tokens;
                h_out_tok += gen.usage.output_tokens;
                let fid = fidelity_check(&gen.note.body, &commit);
                let clean = fid.status == FidelityStatus::Clean;
                if clean {
                    h_clean += 1;
                }
                let structural = !gen.note.title.is_empty()
                    && gen.note.title.chars().count() <= 90
                    && gen.note.body.contains("## ")
                    && gen.note.body.len() > 40;
                if structural {
                    h_structural += 1;
                }
                let low = gen.note.body.to_ascii_lowercase();
                let platitude = ["best practice", "maintainability", "clean code", "readability"]
                    .iter()
                    .any(|p| low.contains(p));
                if platitude {
                    h_platitude += 1;
                }
                println!(
                    "  {} {:<24} title=\"{}\"",
                    if clean && structural { "✓" } else { "✗" },
                    case.name,
                    gen.note.title
                );
                println!(
                    "      fidelity={:?}  flagged={:?}  structural={}  platitude={}",
                    fid.status, fid.flagged_tokens, structural, platitude
                );
            }
            Err(e) => {
                println!("  ! {:<24} GENERATE ERROR: {}", case.name, e);
            }
        }
    }

    let h_ok_rate = h_ok as f64 / h_total as f64;
    let h_clean_rate = if h_ok == 0 { 0.0 } else { h_clean as f64 / h_ok as f64 };
    let h_struct_rate = if h_ok == 0 { 0.0 } else { h_structural as f64 / h_ok as f64 };

    println!("\n  generation: produced {}/{} notes (rate={:.2})", h_ok, h_total, h_ok_rate);
    println!("  fidelity:   {}/{} hallucination-clean (rate={:.2})", h_clean, h_ok, h_clean_rate);
    println!("  structure:  {}/{} well-formed (rate={:.2})", h_structural, h_ok, h_struct_rate);
    println!("  platitudes: {} notes contained generic filler (lower is better)", h_platitude);
    println!("  llm calls:  ~{} in / {} out tokens", h_in_tok, h_out_tok);

    // ── verdict ──
    println!("\n══════════════════════════════════════════════════════════════");
    println!(
        " VERDICT ({model}):  select F1={:.2} · authority={:.2} · harvest clean={:.2} · structure={:.2}",
        f1, auth_acc, h_clean_rate, h_struct_rate
    );
    println!("══════════════════════════════════════════════════════════════\n");

    // Catch catastrophic breakage only; the numbers above are the point.
    assert!(sel_errors < select_cases().len() as u32, "every selection call errored — provider/key/model misconfigured");
    assert!(h_ok > 0, "harvester produced zero notes — provider/key/model misconfigured");
}
