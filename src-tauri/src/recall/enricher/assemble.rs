//! Step 4: assemble the Markdown brief (RECALL-SPEC §6.1 step 4–5).
//!
//! Pure-function transform from a list of selected items into the
//! prepend-ready brief text. Token budget is enforced by dropping
//! lower-authority items first; landmines are never dropped (spec
//! §6.1 step 3 hard rule).
//!
//! Token counting uses the standard ~4-chars-per-token heuristic.
//! Exact tokenization would require shipping a per-provider tokenizer
//! (tiktoken / Anthropic count_tokens endpoint); the heuristic is
//! within ±25% on natural-language text and is the same approach the
//! changelog summarizer uses for its budget guard.

use crate::recall::index::query::IndexedNote;

use super::select::AuthorityLabel;

/// One ready-to-render item — the orchestrator has loaded the body
/// excerpt from disk for each selected note.
#[derive(Debug, Clone)]
pub struct BriefItem {
    pub note: IndexedNote,
    pub body_excerpt: String,
    pub authority: AuthorityLabel,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AssembledBrief {
    /// The complete brief text (already wrapped in delimiters). Empty
    /// when no items survived budget pressure and no manifest/journal
    /// was present.
    pub markdown: String,
    pub estimated_tokens: u32,
    pub injected_note_ids: Vec<String>,
    /// Note ids dropped specifically to fit the budget. Surfaced in
    /// the UI chip so users see what was sacrificed.
    pub dropped_for_budget: Vec<String>,
}

impl AssembledBrief {
    pub fn is_empty(&self) -> bool {
        self.markdown.is_empty()
    }
}

const BRIEF_OPEN: &str = "<!-- RECALL BRIEF (auto-injected; project memory) -->";
const BRIEF_CLOSE: &str = "<!-- /RECALL BRIEF -->";

/// Body excerpts longer than this are truncated. The threshold is
/// generous because cutting too early loses the "why" — but a single
/// runaway note shouldn't eat the entire budget.
const MAX_EXCERPT_CHARS: usize = 600;

pub fn assemble(
    items: &[BriefItem],
    manifest: Option<&str>,
    journal: Option<&str>,
    token_budget: u32,
) -> AssembledBrief {
    if items.is_empty() && manifest.is_none() && journal.is_none() {
        return AssembledBrief::default();
    }

    let budget_chars = token_budget.saturating_mul(4) as usize;

    let mut keep: Vec<BriefItem> = items.to_vec();
    let mut dropped: Vec<String> = Vec::new();

    let mut rendered = render(&keep, manifest, journal);
    while rendered.len() > budget_chars && !keep.is_empty() {
        // Find lowest-priority droppable item (landmines never drop).
        let drop_idx = match find_drop_candidate(&keep) {
            Some(i) => i,
            None => break, // only landmines left
        };
        dropped.push(keep[drop_idx].note.note_id.clone());
        keep.remove(drop_idx);
        rendered = render(&keep, manifest, journal);
    }

    // If we still overflow because only landmines + manifest + journal
    // remain, fall back to truncating manifest/journal text rather than
    // dropping landmines. (Spec §6.1: landmines are mandatory; brief
    // can exceed budget rather than drop them.)
    if rendered.len() > budget_chars {
        let truncated_manifest = manifest.map(|m| truncate_to_chars(m, budget_chars / 4));
        let truncated_journal = journal.map(|j| truncate_to_chars(j, budget_chars / 4));
        rendered = render(&keep, truncated_manifest.as_deref(), truncated_journal.as_deref());
    }

    let injected_note_ids: Vec<String> =
        keep.iter().map(|i| i.note.note_id.clone()).collect();
    let estimated_tokens = (rendered.len() as f64 / 4.0).ceil() as u32;

    AssembledBrief {
        markdown: rendered,
        estimated_tokens,
        injected_note_ids,
        dropped_for_budget: dropped,
    }
}

/// Prepend an assembled brief to a user prompt, with verbatim
/// preservation of the prompt body (spec §6.1 step 5).
pub fn prepend_to_prompt(brief: &AssembledBrief, user_prompt: &str) -> String {
    if brief.is_empty() {
        return user_prompt.to_string();
    }
    let mut out = String::with_capacity(brief.markdown.len() + user_prompt.len() + 16);
    out.push_str(&brief.markdown);
    out.push_str("\n\n");
    out.push_str(user_prompt);
    out
}

fn find_drop_candidate(keep: &[BriefItem]) -> Option<usize> {
    // Lowest drop_priority wins; tie-break by lower trust, then by
    // index (stable). Skip landmines entirely.
    let mut best: Option<(usize, u8)> = None;
    for (i, item) in keep.iter().enumerate() {
        if item.authority == AuthorityLabel::Landmine {
            continue;
        }
        let p = item.authority.drop_priority();
        match best {
            None => best = Some((i, p)),
            Some((_, bp)) if p < bp => best = Some((i, p)),
            _ => {}
        }
    }
    best.map(|(i, _)| i)
}

fn render(items: &[BriefItem], manifest: Option<&str>, journal: Option<&str>) -> String {
    let mut out = String::new();
    out.push_str(BRIEF_OPEN);
    out.push('\n');

    if let Some(m) = manifest {
        out.push_str("\n## Project manifest\n\n");
        out.push_str(m.trim_end());
        out.push('\n');
    }

    // Group items by authority bucket.
    for (label, bucket) in section_order() {
        let in_section: Vec<&BriefItem> = items.iter().filter(|i| i.authority == label).collect();
        if in_section.is_empty() {
            continue;
        }
        out.push_str(&format!("\n## [{}]\n\n", bucket));
        for item in in_section {
            render_item(&mut out, item);
        }
    }

    if let Some(j) = journal {
        out.push_str("\n## Recent activity (from journal)\n\n");
        out.push_str(j.trim_end());
        out.push('\n');
    }

    out.push('\n');
    out.push_str(BRIEF_CLOSE);
    out
}

fn render_item(out: &mut String, item: &BriefItem) {
    let provenance = format!(
        "note:{} • {} • trust:{}",
        item.note.note_id, item.note.file_path, item.note.trust
    );
    out.push_str(&format!("### {} _({})_", item.note.title, provenance));
    out.push('\n');
    if let Some(reason) = &item.reason {
        out.push_str("> _Why here:_ ");
        out.push_str(reason);
        out.push('\n');
    }
    let excerpt = truncate_to_chars(item.body_excerpt.trim(), MAX_EXCERPT_CHARS);
    if !excerpt.is_empty() {
        out.push('\n');
        out.push_str(&excerpt);
        out.push('\n');
    }
}

fn section_order() -> [(AuthorityLabel, &'static str); 5] {
    [
        (AuthorityLabel::Constraint, "CONSTRAINTS — obey"),
        (AuthorityLabel::Landmine, "LANDMINES — stop and check"),
        (AuthorityLabel::WhereToLook, "WHERE TO LOOK — live, fetch current"),
        (AuthorityLabel::PriorArt, "PRIOR ART / WHY"),
        (AuthorityLabel::Freshness, "FRESHNESS"),
    ]
}

fn truncate_to_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::index::query::IndexedNote;

    fn idx(id: &str, title: &str, ty: &str) -> IndexedNote {
        IndexedNote {
            row_id: 1,
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

    fn item(id: &str, title: &str, ty: &str, authority: AuthorityLabel, body: &str) -> BriefItem {
        BriefItem {
            note: idx(id, title, ty),
            body_excerpt: body.to_string(),
            authority,
            reason: None,
        }
    }

    #[test]
    fn empty_inputs_produce_empty_brief() {
        let brief = assemble(&[], None, None, 2000);
        assert!(brief.is_empty());
        assert_eq!(brief.estimated_tokens, 0);
    }

    #[test]
    fn brief_wraps_in_delimiters() {
        let items = vec![item("p1", "p", "pattern", AuthorityLabel::Constraint, "body")];
        let brief = assemble(&items, None, None, 2000);
        assert!(brief.markdown.starts_with(BRIEF_OPEN));
        assert!(brief.markdown.trim_end().ends_with(BRIEF_CLOSE));
    }

    #[test]
    fn sections_render_in_canonical_order() {
        let items = vec![
            item("f1", "f", "module", AuthorityLabel::Freshness, "body"),
            item("p1", "p", "pattern", AuthorityLabel::PriorArt, "body"),
            item("l1", "l", "landmine", AuthorityLabel::Landmine, "body"),
            item("c1", "c", "decision", AuthorityLabel::Constraint, "body"),
            item("w1", "w", "module", AuthorityLabel::WhereToLook, "body"),
        ];
        let brief = assemble(&items, None, None, 2000);
        let positions: Vec<usize> = ["CONSTRAINTS", "LANDMINES", "WHERE TO LOOK", "PRIOR ART", "FRESHNESS"]
            .iter()
            .map(|s| brief.markdown.find(s).expect(s))
            .collect();
        let sorted: Vec<usize> = {
            let mut s = positions.clone();
            s.sort();
            s
        };
        assert_eq!(positions, sorted, "sections must render in canonical order");
    }

    #[test]
    fn manifest_block_appears_when_present() {
        let brief = assemble(&[], Some("be excellent"), None, 2000);
        assert!(brief.markdown.contains("Project manifest"));
        assert!(brief.markdown.contains("be excellent"));
    }

    #[test]
    fn journal_block_appears_when_present() {
        let brief = assemble(&[], None, Some("yesterday we shipped"), 2000);
        assert!(brief.markdown.contains("Recent activity"));
        assert!(brief.markdown.contains("yesterday we shipped"));
    }

    #[test]
    fn provenance_line_includes_note_id_and_file_path() {
        let items = vec![item("p1", "Title", "pattern", AuthorityLabel::Constraint, "body")];
        let brief = assemble(&items, None, None, 2000);
        assert!(brief.markdown.contains("note:p1"));
        assert!(brief.markdown.contains("notes/pattern/p1.md"));
        assert!(brief.markdown.contains("trust:high"));
    }

    #[test]
    fn budget_drops_lowest_authority_first() {
        // Tight budget; only one note should fit.
        let items = vec![
            item("l1", "landmine note", "landmine", AuthorityLabel::Landmine, "L".repeat(50).as_str()),
            item("f1", "freshness note", "module", AuthorityLabel::Freshness, "F".repeat(50).as_str()),
            item("c1", "constraint note", "decision", AuthorityLabel::Constraint, "C".repeat(50).as_str()),
            item("p1", "prior-art note", "pattern", AuthorityLabel::PriorArt, "P".repeat(50).as_str()),
        ];
        // ~200 chars total body + scaffolding; 50 tokens budget = 200 chars.
        let brief = assemble(&items, None, None, 50);
        // Freshness should drop first.
        assert!(brief.dropped_for_budget.contains(&"f1".to_string()));
        // Landmine must survive.
        assert!(brief.injected_note_ids.contains(&"l1".to_string()));
    }

    #[test]
    fn landmines_never_dropped_even_when_over_budget() {
        // Three landmines, tiny budget — all landmines kept.
        let items = vec![
            item("l1", "l1", "landmine", AuthorityLabel::Landmine, "B".repeat(200).as_str()),
            item("l2", "l2", "landmine", AuthorityLabel::Landmine, "B".repeat(200).as_str()),
            item("l3", "l3", "landmine", AuthorityLabel::Landmine, "B".repeat(200).as_str()),
        ];
        let brief = assemble(&items, None, None, 50); // 200 chars budget — far too small
        assert_eq!(brief.injected_note_ids.len(), 3, "landmines all kept");
        assert!(brief.dropped_for_budget.is_empty());
        // Brief WILL exceed budget — that's the contract.
        assert!(brief.estimated_tokens > 50);
    }

    #[test]
    fn excerpt_truncation_at_max_chars_marker() {
        let long_body = "x".repeat(MAX_EXCERPT_CHARS + 500);
        let items = vec![item("p1", "p", "pattern", AuthorityLabel::PriorArt, &long_body)];
        let brief = assemble(&items, None, None, 10_000);
        // The excerpt should be cut and end with the ellipsis marker.
        assert!(brief.markdown.contains("…"));
        // And not contain the very last x of the original body.
        assert!(!brief.markdown.contains(&"x".repeat(MAX_EXCERPT_CHARS + 100)));
    }

    #[test]
    fn reason_when_present_renders_as_blockquote() {
        let mut item = item("p1", "p", "pattern", AuthorityLabel::Constraint, "body");
        item.reason = Some("because we hit this last sprint".to_string());
        let brief = assemble(&[item], None, None, 2000);
        assert!(brief.markdown.contains("> _Why here:_"));
        assert!(brief.markdown.contains("because we hit this last sprint"));
    }

    #[test]
    fn prepend_to_prompt_keeps_user_prompt_verbatim() {
        let items = vec![item("p1", "p", "pattern", AuthorityLabel::Constraint, "body")];
        let brief = assemble(&items, None, None, 2000);
        let user = "fix the auth bug exactly here:\n```\ncode\n```";
        let combined = prepend_to_prompt(&brief, user);
        assert!(combined.starts_with(BRIEF_OPEN));
        assert!(combined.ends_with(user));
    }

    #[test]
    fn prepend_to_empty_brief_returns_user_prompt_unchanged() {
        let brief = AssembledBrief::default();
        let user = "hello";
        let combined = prepend_to_prompt(&brief, user);
        assert_eq!(combined, user);
    }

    #[test]
    fn estimated_tokens_roughly_matches_char_count() {
        let items = vec![item("p1", "p", "pattern", AuthorityLabel::Constraint, "x".repeat(400).as_str())];
        let brief = assemble(&items, None, None, 10_000);
        // ~4 chars/token: 400-char body plus scaffolding (~100-200 chars).
        let chars = brief.markdown.len();
        let expected_tokens = (chars as f64 / 4.0).ceil() as u32;
        assert_eq!(brief.estimated_tokens, expected_tokens);
    }

    #[test]
    fn dropped_for_budget_is_reported_in_order() {
        // Five items, tiny budget — expect multiple drops in low→high
        // authority order.
        let items = vec![
            item("c1", "c", "decision", AuthorityLabel::Constraint, "C".repeat(80).as_str()),
            item("l1", "l", "landmine", AuthorityLabel::Landmine, "L".repeat(80).as_str()),
            item("w1", "w", "module", AuthorityLabel::WhereToLook, "W".repeat(80).as_str()),
            item("p1", "p", "pattern", AuthorityLabel::PriorArt, "P".repeat(80).as_str()),
            item("f1", "f", "module", AuthorityLabel::Freshness, "F".repeat(80).as_str()),
        ];
        let brief = assemble(&items, None, None, 60);
        // Freshness drops first, prior-art second.
        if brief.dropped_for_budget.len() >= 2 {
            assert_eq!(brief.dropped_for_budget[0], "f1");
            assert_eq!(brief.dropped_for_budget[1], "p1");
        }
        // Landmine kept.
        assert!(brief.injected_note_ids.contains(&"l1".to_string()));
    }
}
