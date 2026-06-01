//! Step 2: candidate gather (RECALL-SPEC §6.1).
//!
//! Greedy + high-recall. We err on the side of pulling too many
//! candidates here; the LLM smart-select step (Phase 2 `select`) does the
//! prioritization. The job of this step is to make sure no obviously
//! relevant note is *missing* from the candidate pool.
//!
//! Sources, in priority order:
//! 1. **Mandatory landmines** — landmines whose `source_paths` overlap
//!    any extracted path. These must never be dropped; the select step
//!    is told they are mandatory.
//! 2. **Path overlap** — notes whose `source_paths` intersect extracted
//!    paths.
//! 3. **FTS5 matches** — keyword and symbol matches.
//! 4. **Backlinks** — one-hop graph walk from any note already pulled.
//! 5. **Always include** — MANIFEST.md and recent journal entries. These
//!    are surfaced separately from `candidates` since they're documents,
//!    not indexed notes.

use std::collections::HashMap;
use std::path::Path;

use chrono::Utc;

use super::entity_extraction::Entities;
use crate::recall::index::query::{
    backlinks_of, notes_by_path_overlap, search_notes_fts, IndexedNote,
};
use crate::recall::vault::Vault;
use crate::recall::RecallError;
use crate::storage::Database;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatherSource {
    /// Landmine note covering one of the extracted paths; must reach
    /// the brief regardless of budget.
    MandatoryLandmine,
    PathOverlap,
    FtsMatch,
    Backlink,
}

impl GatherSource {
    /// Higher score wins when the same note is hit by multiple sources.
    fn priority(self) -> u8 {
        match self {
            GatherSource::MandatoryLandmine => 4,
            GatherSource::PathOverlap => 3,
            GatherSource::FtsMatch => 2,
            GatherSource::Backlink => 1,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub note: IndexedNote,
    pub source: GatherSource,
    /// Origin detail — e.g. the matched path or the FTS term. Used for
    /// the per-candidate "why injected" surface in the UI chip.
    pub matched_on: String,
}

impl Candidate {
    pub fn is_mandatory(&self) -> bool {
        self.source == GatherSource::MandatoryLandmine
    }
}

#[derive(Debug, Clone, Default)]
pub struct GatherResult {
    pub candidates: Vec<Candidate>,
    /// MANIFEST.md body (if present at vault root).
    pub manifest: Option<String>,
    /// Concatenated tail of today's + yesterday's journal entries.
    pub recent_journal: Option<String>,
}

impl GatherResult {
    pub fn is_empty(&self) -> bool {
        self.candidates.is_empty()
            && self.manifest.is_none()
            && self.recent_journal.is_none()
    }
}

/// Hard cap on candidates per source. Prevents pathological prompts
/// (one path mentioned that's on a hotspot with 200 notes) from
/// blowing up the LLM context. Tuned conservatively for v1; revisit
/// when miss-log data is in.
const PER_SOURCE_CAP: usize = 25;

pub fn gather(
    db: &Database,
    vault: &Vault,
    vault_id: i64,
    entities: &Entities,
) -> Result<GatherResult, RecallError> {
    let mut merged: HashMap<i64, Candidate> = HashMap::new();

    // 1) Mandatory landmines on touched paths.
    if !entities.paths.is_empty() {
        let path_hits = notes_by_path_overlap(db, vault_id, &entities.paths, PER_SOURCE_CAP)?;
        for note in path_hits {
            let matched_path = entities
                .paths
                .iter()
                .find(|_p| true)
                .cloned()
                .unwrap_or_default();
            let source = if note.note_type == "landmine" {
                GatherSource::MandatoryLandmine
            } else {
                GatherSource::PathOverlap
            };
            insert_or_promote(
                &mut merged,
                Candidate {
                    note,
                    source,
                    matched_on: matched_path,
                },
            );
        }
    }

    // 2) FTS5 matches on each extracted symbol + keyword.
    let mut fts_seen: usize = 0;
    let fts_terms = fts_query_terms(entities);
    for term in &fts_terms {
        if fts_seen >= PER_SOURCE_CAP {
            break;
        }
        let remaining = PER_SOURCE_CAP - fts_seen;
        let safe_term = sanitize_fts_query(term);
        if safe_term.is_empty() {
            continue;
        }
        let hits = match search_notes_fts(db, vault_id, &safe_term, remaining) {
            Ok(h) => h,
            Err(e) => {
                // FTS5 MATCH syntax can reject odd inputs even after
                // sanitization. Skip the term rather than aborting the
                // entire gather pass.
                log::debug!("[recall.gather] fts term {:?} rejected: {}", safe_term, e);
                continue;
            }
        };
        for note in hits {
            fts_seen += 1;
            insert_or_promote(
                &mut merged,
                Candidate {
                    note,
                    source: GatherSource::FtsMatch,
                    matched_on: term.clone(),
                },
            );
        }
    }

    // 3) Backlinks of everything pulled so far (one hop).
    let seed_ids: Vec<(i64, String)> = merged
        .values()
        .map(|c| (c.note.row_id, c.note.note_id.clone()))
        .collect();
    let mut backlink_count = 0usize;
    for (seed_id, seed_note_id) in seed_ids {
        if backlink_count >= PER_SOURCE_CAP {
            break;
        }
        let backs = backlinks_of(db, seed_id)?;
        for note in backs {
            if backlink_count >= PER_SOURCE_CAP {
                break;
            }
            backlink_count += 1;
            insert_or_promote(
                &mut merged,
                Candidate {
                    note,
                    source: GatherSource::Backlink,
                    matched_on: seed_note_id.clone(),
                },
            );
        }
    }

    let mut candidates: Vec<Candidate> = merged.into_values().collect();
    // Stable ordering: source priority desc, then title asc for
    // deterministic tests.
    candidates.sort_by(|a, b| {
        b.source
            .priority()
            .cmp(&a.source.priority())
            .then_with(|| a.note.title.cmp(&b.note.title))
    });

    let manifest = read_optional_file(vault.root(), "MANIFEST.md");
    let recent_journal = read_recent_journal(vault.root());

    Ok(GatherResult {
        candidates,
        manifest,
        recent_journal,
    })
}

fn insert_or_promote(merged: &mut HashMap<i64, Candidate>, new: Candidate) {
    match merged.get_mut(&new.note.row_id) {
        Some(existing) => {
            if new.source.priority() > existing.source.priority() {
                existing.source = new.source;
                existing.matched_on = new.matched_on;
            }
        }
        None => {
            merged.insert(new.note.row_id, new);
        }
    }
}

/// Compose the list of FTS5 query terms from extracted entities. Symbols
/// take priority over keywords; we cap total terms because each one is a
/// separate SQL query.
fn fts_query_terms(entities: &Entities) -> Vec<String> {
    let mut terms = Vec::new();
    for s in entities.symbols.iter().take(15) {
        terms.push(s.clone());
    }
    for k in entities.keywords.iter().take(15) {
        if !terms.iter().any(|t| t.eq_ignore_ascii_case(k)) {
            terms.push(k.clone());
        }
    }
    terms
}

/// FTS5 MATCH accepts a small query language. Symbols with `_` and `-`
/// can confuse the tokenizer; the safest cross-input strategy is to
/// quote the term as a phrase. Quotes inside the term get stripped to
/// avoid breaking the phrase delimiters.
fn sanitize_fts_query(term: &str) -> String {
    let cleaned: String = term.chars().filter(|c| *c != '"').collect();
    if cleaned.trim().is_empty() {
        return String::new();
    }
    format!("\"{}\"", cleaned)
}

fn read_optional_file(root: &Path, relative: &str) -> Option<String> {
    let path = root.join(relative);
    if !path.is_file() {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn read_recent_journal(root: &Path) -> Option<String> {
    let dir = root.join("journal");
    if !dir.is_dir() {
        return None;
    }
    let today = Utc::now().date_naive();
    let yesterday = today.pred_opt()?;
    let mut combined = String::new();
    let today_path = dir.join(format!("{}.md", today));
    if today_path.is_file() {
        if let Ok(s) = std::fs::read_to_string(&today_path) {
            combined.push_str("## Journal — today\n\n");
            combined.push_str(&s);
            combined.push('\n');
        }
    }
    let yest_path = dir.join(format!("{}.md", yesterday));
    if yest_path.is_file() {
        if let Ok(s) = std::fs::read_to_string(&yest_path) {
            combined.push_str("\n## Journal — yesterday\n\n");
            combined.push_str(&s);
            combined.push('\n');
        }
    }
    if combined.is_empty() {
        None
    } else {
        Some(combined)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::index::ingest::ingest_note;
    use crate::recall::index::{ensure_vault_row, test_helpers::*};
    use crate::recall::vault::{Note, NoteType, Status, Trust};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn make_note(id: &str, ty: NoteType, title: &str, body: &str, paths: &[&str], tags: &[&str]) -> Note {
        Note {
            id: id.to_string(),
            note_type: ty,
            project: Some("proj".to_string()),
            status: Status::Active,
            trust: Trust::High,
            trust_raw: String::new(),
            severity: None,
            discovered: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            last_verified: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            source_paths: paths.iter().map(|s| s.to_string()).collect(),
            source_commits: vec![],
            prior_occurrences: vec![],
            links: vec![],
            tags: tags.iter().map(|s| s.to_string()).collect(),
            title: title.to_string(),
            body: body.to_string(),
            file_path: None,
        }
    }

    fn setup() -> (TempDir, Vault, std::sync::Arc<crate::storage::Database>, i64) {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let project = dummy_project_path();
        let vault_id = ensure_vault_row(&db, &project, vault.root(), false).unwrap();
        (tmp, vault, db, vault_id)
    }

    fn entities(paths: &[&str], symbols: &[&str], keywords: &[&str]) -> Entities {
        Entities {
            paths: paths.iter().map(|s| s.to_string()).collect(),
            symbols: symbols.iter().map(|s| s.to_string()).collect(),
            keywords: keywords.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn landmine_on_extracted_path_is_mandatory_include() {
        let (_tmp, vault, db, vault_id) = setup();
        let note = make_note(
            "l1",
            NoteType::Landmine,
            "pgcrypto landmine",
            "body",
            &["src/credentials.ts"],
            &["security"],
        );
        ingest_note(
            &db,
            vault_id,
            &note,
            std::path::Path::new("notes/landmines/l1.md"),
        )
        .unwrap();

        let ents = entities(&["src/credentials.ts"], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert_eq!(result.candidates.len(), 1);
        assert!(result.candidates[0].is_mandatory());
        assert_eq!(result.candidates[0].source, GatherSource::MandatoryLandmine);
    }

    #[test]
    fn non_landmine_on_extracted_path_uses_path_overlap_source() {
        let (_tmp, vault, db, vault_id) = setup();
        let note = make_note(
            "p1",
            NoteType::Pattern,
            "naming convention",
            "body",
            &["src/lib.rs"],
            &[],
        );
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/patterns/p1.md")).unwrap();

        let ents = entities(&["src/lib.rs"], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].source, GatherSource::PathOverlap);
        assert!(!result.candidates[0].is_mandatory());
    }

    #[test]
    fn fts_hit_surfaces_note_that_no_path_overlap_would() {
        let (_tmp, vault, db, vault_id) = setup();
        let note = make_note(
            "p1",
            NoteType::Pattern,
            "Diff is truth",
            "Harvested notes must anchor to the diff. distinguishing_keyword shows up only here.",
            &[],
            &[],
        );
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/patterns/p1.md")).unwrap();

        let ents = entities(&[], &[], &["distinguishing_keyword"]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].source, GatherSource::FtsMatch);
    }

    #[test]
    fn duplicate_hit_uses_higher_priority_source() {
        let (_tmp, vault, db, vault_id) = setup();
        // Landmine with `pgcrypto` in title (FTS) AND on the path (overlap).
        let note = make_note(
            "l1",
            NoteType::Landmine,
            "pgcrypto search path landmine",
            "body",
            &["src/credentials.ts"],
            &[],
        );
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        let ents = entities(&["src/credentials.ts"], &[], &["pgcrypto"]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert_eq!(result.candidates.len(), 1, "duplicate hit should merge");
        assert_eq!(
            result.candidates[0].source,
            GatherSource::MandatoryLandmine,
            "highest-priority source wins"
        );
    }

    #[test]
    fn backlinks_are_pulled_at_one_hop() {
        let (_tmp, vault, db, vault_id) = setup();
        // Target note referenced via wikilink.
        let target = make_note("target", NoteType::Pattern, "target", "I am referenced", &["src/x.rs"], &[]);
        ingest_note(&db, vault_id, &target, std::path::Path::new("notes/patterns/target.md")).unwrap();
        // Linker note with no path overlap but a wikilink to target.
        let linker = make_note("linker", NoteType::Pattern, "linker", "see [[target]]", &[], &[]);
        ingest_note(&db, vault_id, &linker, std::path::Path::new("notes/patterns/linker.md")).unwrap();

        // Query for path that only matches target.
        let ents = entities(&["src/x.rs"], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        let note_ids: Vec<&str> = result.candidates.iter().map(|c| c.note.note_id.as_str()).collect();
        assert!(note_ids.contains(&"target"), "path-overlap pulls target");
        assert!(note_ids.contains(&"linker"), "backlink walk pulls linker");
        let linker_candidate = result
            .candidates
            .iter()
            .find(|c| c.note.note_id == "linker")
            .unwrap();
        assert_eq!(linker_candidate.source, GatherSource::Backlink);
    }

    #[test]
    fn ordering_is_priority_desc_then_title() {
        let (_tmp, vault, db, vault_id) = setup();
        let l = make_note("l", NoteType::Landmine, "zz landmine", "x", &["src/a.rs"], &[]);
        let p1 = make_note("p1", NoteType::Pattern, "aaa pattern", "x", &["src/a.rs"], &[]);
        let p2 = make_note("p2", NoteType::Pattern, "bbb pattern", "x", &["src/a.rs"], &[]);
        ingest_note(&db, vault_id, &l, std::path::Path::new("notes/landmines/l.md")).unwrap();
        ingest_note(&db, vault_id, &p1, std::path::Path::new("notes/patterns/p1.md")).unwrap();
        ingest_note(&db, vault_id, &p2, std::path::Path::new("notes/patterns/p2.md")).unwrap();

        let ents = entities(&["src/a.rs"], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert_eq!(result.candidates.len(), 3);
        // Landmine first (priority 4 vs path-overlap priority 3).
        assert_eq!(result.candidates[0].note.note_id, "l");
        // Then patterns alphabetical by title.
        assert_eq!(result.candidates[1].note.note_id, "p1");
        assert_eq!(result.candidates[2].note.note_id, "p2");
    }

    #[test]
    fn manifest_is_surfaced_when_present() {
        let (tmp, vault, db, vault_id) = setup();
        std::fs::write(tmp.path().join("MANIFEST.md"), b"# Manifest\nbe excellent").unwrap();
        let ents = entities(&[], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert!(result.manifest.is_some());
        assert!(result.manifest.unwrap().contains("be excellent"));
    }

    #[test]
    fn manifest_absent_returns_none() {
        let (_tmp, vault, db, vault_id) = setup();
        let ents = entities(&[], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert!(result.manifest.is_none());
    }

    #[test]
    fn recent_journal_pulled_when_today_file_exists() {
        let (tmp, vault, db, vault_id) = setup();
        let today = Utc::now().date_naive();
        let journal_dir = tmp.path().join("journal");
        std::fs::create_dir_all(&journal_dir).unwrap();
        std::fs::write(
            journal_dir.join(format!("{}.md", today)),
            b"# Today\nthings happened",
        )
        .unwrap();
        let ents = entities(&[], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        let journal = result.recent_journal.expect("journal should be present");
        assert!(journal.contains("things happened"));
    }

    #[test]
    fn empty_entities_returns_empty_candidates() {
        let (_tmp, vault, db, vault_id) = setup();
        let note = make_note("n1", NoteType::Pattern, "x", "y", &["src/a.rs"], &[]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/patterns/n1.md")).unwrap();
        let ents = entities(&[], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert!(result.candidates.is_empty());
    }

    #[test]
    fn malformed_fts_term_does_not_abort_pipeline() {
        let (_tmp, vault, db, vault_id) = setup();
        let note = make_note("n1", NoteType::Pattern, "real", "body about real thing", &["src/a.rs"], &[]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/patterns/n1.md")).unwrap();

        // Use a quote-containing keyword that would normally crash the query.
        let ents = entities(&[], &[], &["\"\"\"", "real"]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert_eq!(result.candidates.len(), 1, "malformed term skipped, real term still hits");
    }

    #[test]
    fn per_source_cap_enforced() {
        let (_tmp, vault, db, vault_id) = setup();
        // Insert PER_SOURCE_CAP + 5 path-matching notes.
        for i in 0..(PER_SOURCE_CAP + 5) {
            let id = format!("p{}", i);
            let n = make_note(
                &id,
                NoteType::Pattern,
                &format!("note {}", i),
                "body",
                &["src/a.rs"],
                &[],
            );
            ingest_note(
                &db,
                vault_id,
                &n,
                std::path::Path::new(&format!("notes/patterns/{}.md", id)),
            )
            .unwrap();
        }
        let ents = entities(&["src/a.rs"], &[], &[]);
        let result = gather(&db, &vault, vault_id, &ents).unwrap();
        assert!(
            result.candidates.len() <= PER_SOURCE_CAP,
            "per-source cap limits returned candidates, got {}",
            result.candidates.len()
        );
    }
}
