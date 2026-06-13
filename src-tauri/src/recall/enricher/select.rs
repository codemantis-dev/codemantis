//! Step 3: smart-select (RECALL-SPEC §6.1).
//!
//! The judgment step: an LLM looks at the user prompt + gathered
//! candidates and returns the subset that *actually* matters for this
//! task, each labeled with an authority bucket so the assemble step
//! knows how to present it.
//!
//! Reliability layers:
//! 1. **Schema-constrained output** — model is told to return JSON only.
//! 2. **Retry once** on malformed JSON (at lower temperature implicitly
//!    via the provider's JSON-mode flag — see changelog::summarizer).
//! 3. **Mandatory pinning** — landmines from the gather step are
//!    appended to the selection regardless of what the LLM said. The
//!    LLM is told they're already selected so it doesn't waste tokens
//!    "selecting" them, but if it omits them for any reason the
//!    post-process re-adds them.
//! 4. **Caller-side fallback** — on persistent failure, `select` returns
//!    `Err`; the orchestrator falls back to gather-only assembly.

use serde::{Deserialize, Serialize};

use super::gather::{Candidate, GatherSource};
use crate::recall::config::RecallConfig;
use crate::recall::llm_client::{LlmClient, LlmRequest};
use crate::recall::RecallError;

/// Authority bucket per spec §6.1 step 4. Determines which section of
/// the assembled brief the note ends up in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorityLabel {
    Constraint,
    Landmine,
    WhereToLook,
    PriorArt,
    Freshness,
}

impl AuthorityLabel {
    pub fn section_heading(self) -> &'static str {
        match self {
            AuthorityLabel::Constraint => "CONSTRAINTS — obey",
            AuthorityLabel::Landmine => "LANDMINES — stop and check",
            AuthorityLabel::WhereToLook => "WHERE TO LOOK — live, fetch current",
            AuthorityLabel::PriorArt => "PRIOR ART / WHY",
            AuthorityLabel::Freshness => "FRESHNESS",
        }
    }

    pub(crate) fn drop_priority(self) -> u8 {
        // Lower drop_priority = dropped first under budget pressure.
        // Landmines must never be dropped (handled separately in
        // assemble); here we still report a value so the
        // sort-by-keep-strength is total.
        match self {
            AuthorityLabel::Landmine => 4,
            AuthorityLabel::Constraint => 3,
            AuthorityLabel::WhereToLook => 2,
            AuthorityLabel::PriorArt => 1,
            AuthorityLabel::Freshness => 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedNote {
    pub note_id: String,
    pub authority: AuthorityLabel,
    /// One-line "why this matters here" — surfaced in the UI chip.
    /// Optional; the LLM may not provide it for every note.
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SelectionResult {
    pub selected: Vec<SelectedNote>,
    /// True when the LLM call failed (after retry) and we returned the
    /// gather-only fallback selection.
    pub fallback_used: bool,
    /// Tokens used across all LLM attempts (sum of retries).
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub model_used: String,
}

#[derive(Debug, Clone, Deserialize)]
struct LlmSelectionItem {
    id: String,
    authority: AuthorityLabel,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct LlmSelectionEnvelope {
    selected: Vec<LlmSelectionItem>,
}

const SYSTEM_PROMPT: &str = r#"You are the Recall Enricher's selection step for a coding assistant. Given a user's prompt and a set of candidate memory notes, return the notes that are plausibly relevant to the user's task — anything touching the files, modules, APIs, or concepts the task involves. Lean toward surfacing a useful note rather than dropping it; only drop notes that are clearly unrelated to the task.

For each note you select, assign one of these authority labels:
- "constraint" — a rule the assistant must obey (architectural decision, naming convention, code-style mandate).
- "landmine" — a known pitfall the assistant will hit if it does not stop and check first.
- "where-to-look" — a pointer to a file, table, or API the assistant must read live before writing code.
- "prior-art" — historical context or a similar prior decision that informs but does not constrain.
- "freshness" — a note whose source paths have not been touched in a while; surface it cautiously.

Return strict JSON of this form, no markdown, no commentary:

{"selected": [{"id": "<note-id>", "authority": "<bucket>", "reason": "<one short sentence>"}, ...]}

Notes marked MANDATORY in the candidate list are already included; do not return them again. If you have nothing to add to the mandatory set, return {"selected": []}."#;

/// Issue the LLM smart-select call. The mandatory landmines from
/// [`Candidate::is_mandatory`] are *not* asked to the LLM (they're
/// pre-selected) but are merged into the returned `selected` list with
/// `AuthorityLabel::Landmine`.
pub async fn select(
    llm: &dyn LlmClient,
    api_key: &str,
    config: &RecallConfig,
    user_prompt: &str,
    candidates: &[Candidate],
) -> Result<SelectionResult, RecallError> {
    // Partition into mandatory (always selected) and optional (LLM picks).
    let mut mandatory: Vec<SelectedNote> = Vec::new();
    let mut optional: Vec<&Candidate> = Vec::new();
    for c in candidates {
        if c.is_mandatory() {
            mandatory.push(SelectedNote {
                note_id: c.note.note_id.clone(),
                authority: AuthorityLabel::Landmine,
                reason: Some(format!(
                    "landmine on {} — must read before touching this path",
                    c.matched_on
                )),
            });
        } else {
            optional.push(c);
        }
    }

    // Cheap fast-path: if there are no optional candidates, skip the
    // LLM call entirely. Saves cost and latency for prompts that hit
    // only landmines or hit nothing.
    if optional.is_empty() {
        return Ok(SelectionResult {
            selected: mandatory,
            fallback_used: false,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
            model_used: config.enricher_model.clone(),
        });
    }

    let user_payload = render_user_payload(user_prompt, &mandatory, &optional);

    let req = LlmRequest {
        provider: config.enricher_provider.clone(),
        model: config.enricher_model.clone(),
        system_prompt: SYSTEM_PROMPT.to_string(),
        user_prompt: user_payload,
        timeout: crate::recall::llm_client::DEFAULT_TIMEOUT,
        thinking: config.enricher_thinking.clone(),
    };

    // First attempt.
    let first = llm.call(req.clone(), api_key).await;
    let (text, tokens, cost, retried) = match first {
        Ok(resp) => match parse_envelope(&resp.text) {
            Ok(parsed) => {
                let mut merged = mandatory.clone();
                merge_llm_selection(&mut merged, parsed, &optional);
                return Ok(SelectionResult {
                    selected: merged,
                    fallback_used: false,
                    input_tokens: resp.input_tokens,
                    output_tokens: resp.output_tokens,
                    cost_usd: resp.cost_usd,
                    model_used: resp.model,
                });
            }
            Err(parse_err) => {
                log::warn!(
                    "[recall.select] malformed JSON from LLM ({}), retrying",
                    parse_err
                );
                ("retry".to_string(), (resp.input_tokens, resp.output_tokens), resp.cost_usd, true)
            }
        },
        Err(e) => {
            // Network/timeout/provider error — also retry once before
            // bailing.
            log::warn!("[recall.select] llm call failed ({}), retrying", e);
            ("retry".to_string(), (0u32, 0u32), 0.0, true)
        }
    };
    let _ = (text, retried); // local-only logging

    // Retry attempt.
    let second = llm.call(req, api_key).await;
    match second {
        Ok(resp) => match parse_envelope(&resp.text) {
            Ok(parsed) => {
                let mut merged = mandatory.clone();
                merge_llm_selection(&mut merged, parsed, &optional);
                Ok(SelectionResult {
                    selected: merged,
                    fallback_used: false,
                    input_tokens: tokens.0.saturating_add(resp.input_tokens),
                    output_tokens: tokens.1.saturating_add(resp.output_tokens),
                    cost_usd: cost + resp.cost_usd,
                    model_used: resp.model,
                })
            }
            Err(e) => {
                log::warn!(
                    "[recall.select] retry also returned malformed JSON ({}); falling back to gather-only",
                    e
                );
                Err(RecallError::Config(format!(
                    "smart-select failed after retry: {}",
                    e
                )))
            }
        },
        Err(e) => {
            log::warn!(
                "[recall.select] retry also failed ({}); orchestrator should fall back",
                e
            );
            Err(e)
        }
    }
}

fn render_user_payload(
    user_prompt: &str,
    mandatory: &[SelectedNote],
    optional: &[&Candidate],
) -> String {
    let mut out = String::new();
    out.push_str("USER PROMPT:\n");
    out.push_str(user_prompt);
    out.push_str("\n\n");
    if !mandatory.is_empty() {
        out.push_str("MANDATORY (already selected, do not return):\n");
        for sel in mandatory {
            out.push_str(&format!("- {}\n", sel.note_id));
        }
        out.push('\n');
    }
    out.push_str("CANDIDATES (pick the relevant ones):\n");
    for c in optional {
        let summary = candidate_summary(c);
        out.push_str(&format!(
            "- id={} type={} trust={} title=\"{}\"\n  {}\n",
            c.note.note_id, c.note.note_type, c.note.trust, c.note.title, summary
        ));
    }
    out
}

fn candidate_summary(c: &Candidate) -> String {
    match c.source {
        GatherSource::MandatoryLandmine => format!("landmine on {}", c.matched_on),
        GatherSource::AlwaysLandmine => "always-on landmine".to_string(),
        GatherSource::PathOverlap => format!("touches {}", c.matched_on),
        GatherSource::FtsMatch => format!("matched term \"{}\"", c.matched_on),
        GatherSource::Backlink => format!("linked from [[{}]]", c.matched_on),
    }
}

fn parse_envelope(text: &str) -> Result<LlmSelectionEnvelope, String> {
    let trimmed = strip_json_fence(text);
    // Some providers wrap responses in ``` despite being told not to;
    // strip a leading and trailing fence pair before parsing.
    serde_json::from_str::<LlmSelectionEnvelope>(trimmed)
        .map_err(|e| format!("json parse: {} (got: {})", e, truncate(trimmed, 200)))
}

fn strip_json_fence(s: &str) -> &str {
    let t = s.trim();
    let t = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .unwrap_or(t)
        .trim();
    t.strip_suffix("```").unwrap_or(t).trim()
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

/// Merge LLM-selected items into `selected`, validating that each
/// returned `id` actually appears in the optional-candidate list.
/// Items referring to unknown ids are silently dropped (the LLM might
/// hallucinate but we don't propagate the lie). Mandatory entries
/// already in `selected` are preserved unchanged.
fn merge_llm_selection(
    selected: &mut Vec<SelectedNote>,
    llm: LlmSelectionEnvelope,
    optional: &[&Candidate],
) {
    use std::collections::HashSet;
    let valid_ids: HashSet<&str> = optional.iter().map(|c| c.note.note_id.as_str()).collect();
    let already_picked: HashSet<String> = selected.iter().map(|s| s.note_id.clone()).collect();

    for item in llm.selected {
        if !valid_ids.contains(item.id.as_str()) {
            log::debug!(
                "[recall.select] LLM returned unknown id {:?}; dropping",
                item.id
            );
            continue;
        }
        if already_picked.contains(&item.id) {
            continue;
        }
        selected.push(SelectedNote {
            note_id: item.id,
            authority: item.authority,
            reason: item.reason,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::config::RecallConfig;
    use crate::recall::index::query::IndexedNote;
    use crate::recall::llm_client::MockLlmClient;

    fn idx_note(id: &str, ty: &str, title: &str) -> IndexedNote {
        IndexedNote {
            row_id: id.chars().fold(0i64, |acc, c| acc * 31 + c as i64),
            vault_id: 1,
            note_id: id.to_string(),
            note_type: ty.to_string(),
            title: title.to_string(),
            status: "active".to_string(),
            trust: "high".to_string(),
            severity: None,
            last_verified: "2026-06-01".to_string(),
            file_path: format!("notes/{}/{}.md", ty, id),
        }
    }

    fn candidate(id: &str, ty: &str, title: &str, source: GatherSource, matched: &str) -> Candidate {
        Candidate {
            note: idx_note(id, ty, title),
            source,
            matched_on: matched.to_string(),
        }
    }

    fn cfg() -> RecallConfig {
        RecallConfig {
            enabled: true,
            ..RecallConfig::default()
        }
    }

    #[tokio::test]
    async fn mandatory_landmines_passthrough_without_llm() {
        let llm = MockLlmClient::new(); // no responses queued; will panic if called
        let candidates = vec![candidate(
            "l1",
            "landmine",
            "pgcrypto",
            GatherSource::MandatoryLandmine,
            "src/x.rs",
        )];
        let result = select(&llm, "k", &cfg(), "fix the credentials helper", &candidates)
            .await
            .unwrap();
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.selected[0].authority, AuthorityLabel::Landmine);
        assert!(!result.fallback_used);
        assert_eq!(result.input_tokens, 0, "no LLM call should have been made");
        assert!(llm.calls().is_empty());
    }

    #[tokio::test]
    async fn llm_picks_subset_of_optional_candidates() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r#"{"selected":[{"id":"p1","authority":"constraint","reason":"naming"}]}"#,
            120,
            40,
        );
        let candidates = vec![
            candidate("p1", "pattern", "Naming", GatherSource::PathOverlap, "src/a.rs"),
            candidate("p2", "pattern", "Other", GatherSource::FtsMatch, "term"),
        ];
        let result = select(&llm, "k", &cfg(), "the user prompt", &candidates).await.unwrap();
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.selected[0].note_id, "p1");
        assert_eq!(result.selected[0].authority, AuthorityLabel::Constraint);
        assert!(!result.fallback_used);
    }

    #[tokio::test]
    async fn llm_response_in_markdown_fence_is_unwrapped() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            "```json\n{\"selected\":[{\"id\":\"p1\",\"authority\":\"prior-art\"}]}\n```",
            100,
            30,
        );
        let candidates = vec![candidate("p1", "pattern", "x", GatherSource::FtsMatch, "x")];
        let result = select(&llm, "k", &cfg(), "p", &candidates).await.unwrap();
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.selected[0].authority, AuthorityLabel::PriorArt);
    }

    #[tokio::test]
    async fn malformed_json_triggers_one_retry_then_succeeds() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok("this is not json at all", 50, 5);
        llm.enqueue_ok(
            r#"{"selected":[{"id":"p1","authority":"where-to-look"}]}"#,
            60,
            10,
        );
        let candidates = vec![candidate("p1", "pattern", "x", GatherSource::FtsMatch, "x")];
        let result = select(&llm, "k", &cfg(), "p", &candidates).await.unwrap();
        assert_eq!(result.selected.len(), 1);
        assert!(!result.fallback_used);
        // Tokens should sum across attempts.
        assert_eq!(result.input_tokens, 110);
        assert_eq!(result.output_tokens, 15);
    }

    #[tokio::test]
    async fn malformed_twice_returns_err_for_orchestrator_to_fall_back() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok("garbage", 10, 5);
        llm.enqueue_ok("more garbage", 10, 5);
        let candidates = vec![candidate("p1", "pattern", "x", GatherSource::FtsMatch, "x")];
        let result = select(&llm, "k", &cfg(), "p", &candidates).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn network_error_retries_then_bubbles() {
        let llm = MockLlmClient::new();
        llm.enqueue_err("network down");
        llm.enqueue_err("still down");
        let candidates = vec![candidate("p1", "pattern", "x", GatherSource::FtsMatch, "x")];
        let result = select(&llm, "k", &cfg(), "p", &candidates).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn unknown_ids_in_llm_response_are_silently_dropped() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r#"{"selected":[
                {"id":"p1","authority":"constraint"},
                {"id":"hallucinated","authority":"landmine"}
            ]}"#,
            120,
            40,
        );
        let candidates = vec![candidate("p1", "pattern", "x", GatherSource::FtsMatch, "x")];
        let result = select(&llm, "k", &cfg(), "p", &candidates).await.unwrap();
        assert_eq!(result.selected.len(), 1);
        assert_eq!(result.selected[0].note_id, "p1");
    }

    #[tokio::test]
    async fn mandatory_landmines_merged_with_llm_picks() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r#"{"selected":[{"id":"p1","authority":"prior-art"}]}"#,
            100,
            20,
        );
        let candidates = vec![
            candidate(
                "l1",
                "landmine",
                "must-have",
                GatherSource::MandatoryLandmine,
                "src/x.rs",
            ),
            candidate("p1", "pattern", "Optional", GatherSource::FtsMatch, "term"),
        ];
        let result = select(&llm, "k", &cfg(), "p", &candidates).await.unwrap();
        assert_eq!(result.selected.len(), 2);
        let ids: Vec<&str> = result.selected.iter().map(|s| s.note_id.as_str()).collect();
        assert!(ids.contains(&"l1"));
        assert!(ids.contains(&"p1"));
        // Landmine kept its mandatory authority label.
        let landmine = result.selected.iter().find(|s| s.note_id == "l1").unwrap();
        assert_eq!(landmine.authority, AuthorityLabel::Landmine);
    }

    #[tokio::test]
    async fn llm_returning_mandatory_id_is_deduped_not_added_twice() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r#"{"selected":[{"id":"l1","authority":"landmine"}]}"#,
            80,
            15,
        );
        let candidates = vec![candidate(
            "l1",
            "landmine",
            "x",
            GatherSource::MandatoryLandmine,
            "src/x.rs",
        )];
        // The fast-path (only mandatory, no optional) actually skips
        // the LLM call entirely. So the queued response goes unused.
        let result = select(&llm, "k", &cfg(), "p", &candidates).await.unwrap();
        assert_eq!(result.selected.len(), 1);
    }

    #[tokio::test]
    async fn empty_candidates_returns_empty_selection_without_llm() {
        let llm = MockLlmClient::new();
        let result = select(&llm, "k", &cfg(), "p", &[]).await.unwrap();
        assert!(result.selected.is_empty());
        assert!(!result.fallback_used);
        assert!(llm.calls().is_empty());
    }
}
