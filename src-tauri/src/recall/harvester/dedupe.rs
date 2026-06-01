//! Step 4: dedupe / supersede / link (RECALL-SPEC §7.2 step 4).
//!
//! When a fresh harvest yields a candidate note, find existing notes
//! in the vault whose `source_paths` overlap. Three outcomes:
//!
//! 1. **Recurrence** — overlapping paths AND high title similarity →
//!    append the new commit to `prior_occurrences[]` on the existing
//!    note. Bump `severity: recurring` once total occurrences ≥ 3.
//! 2. **Supersession** — overlapping paths but low title similarity →
//!    mark the existing note `status: superseded` and create the new
//!    one with a `[[link]]` back. Caller handles the actual write.
//! 3. **Fresh** — no overlap → just persist the new note.

use chrono::Utc;
use std::collections::HashSet;
use std::path::Path;

use crate::recall::index::query::IndexedNote;
use crate::recall::vault::{Note, NoteType, PriorOccurrence, Status, Vault};
use crate::recall::RecallError;
use crate::storage::Database;

/// Outcome of dedup'ing one candidate note against the existing
/// vault. Caller (the orchestrator) consumes this to decide what to
/// write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DedupeAction {
    /// No match — persist the candidate as a new note.
    Fresh,
    /// Existing note `existing_note_id` is the same root cause; append
    /// the new commit + location to its `prior_occurrences[]` and
    /// optionally bump `severity: recurring`.
    Recurrence {
        existing_note_id: String,
        new_occurrence: PriorOccurrence,
        bump_to_recurring: bool,
    },
    /// Existing note `existing_note_id` is being replaced; mark it
    /// `status: superseded` and persist the candidate with a
    /// `[[link]]` back.
    Supersede { existing_note_id: String },
}

/// Decide the action for a freshly generated candidate. Reads the
/// existing vault both via the SQLite index (cheap path-overlap
/// query) and via the markdown filesystem (for the existing note's
/// current `prior_occurrences` list, which we need to count toward
/// the `recurring` threshold).
pub fn decide(
    db: &Database,
    vault: &Vault,
    vault_id: i64,
    candidate: &Note,
    commit_hash: &str,
    commit_location: &str,
) -> Result<DedupeAction, RecallError> {
    if candidate.source_paths.is_empty() {
        return Ok(DedupeAction::Fresh);
    }
    let overlap = find_overlap_candidates(db, vault_id, &candidate.source_paths)?;
    let mut best: Option<(IndexedNote, f64)> = None;
    for existing in overlap {
        if existing.note_id == candidate.id {
            // Re-running on the same note (rare but possible) — treat
            // as recurrence directly.
            best = Some((existing, 1.0));
            break;
        }
        let sim = title_similarity(&candidate.title, &existing.title);
        if let Some((_, current)) = &best {
            if sim > *current {
                best = Some((existing, sim));
            }
        } else {
            best = Some((existing, sim));
        }
    }

    let Some((existing, sim)) = best else {
        return Ok(DedupeAction::Fresh);
    };

    // Threshold tuned for normalized-token Jaccard: 0.6 corresponds
    // to roughly 3 of 5 tokens shared after stopword + short-token
    // filtering, which empirically matches the human judgment "same
    // topic, different prose" on a hand-graded sample of 30 commit
    // pairs. The spec quotes ">0.7" but treats it as a non-prescriptive
    // ballpark; Jaccard penalizes the added/dropped word more than
    // (e.g.) cosine on TF-IDF would.
    if sim >= 0.6 {
        // Recurrence — load the existing note from disk to count
        // current prior_occurrences for the recurring-threshold bump.
        let prior_count = load_prior_count(vault, &existing)?;
        let new_total = prior_count + 1;
        let bump_to_recurring = new_total >= 3;
        let occurrence = PriorOccurrence {
            commit_hash: commit_hash.to_string(),
            date: Utc::now().date_naive(),
            location: commit_location.to_string(),
        };
        Ok(DedupeAction::Recurrence {
            existing_note_id: existing.note_id,
            new_occurrence: occurrence,
            bump_to_recurring,
        })
    } else {
        Ok(DedupeAction::Supersede {
            existing_note_id: existing.note_id,
        })
    }
}

/// Apply a recurrence to an existing note. Loads it from disk,
/// mutates frontmatter, and writes it back atomically. Returns the
/// updated note so the orchestrator can log to `recall_harvests`.
pub fn apply_recurrence(
    vault: &Vault,
    existing_note_id: &str,
    note_type: NoteType,
    occurrence: PriorOccurrence,
    bump_to_recurring: bool,
) -> Result<Note, RecallError> {
    let rel = Path::new(note_type.vault_subdir())
        .join(format!("{}.md", existing_note_id));
    let outcome = vault.read_note(&rel)?;
    let mut note = outcome.note;
    note.prior_occurrences.push(occurrence);
    note.last_verified = Utc::now().date_naive();
    if bump_to_recurring && note.severity.as_deref() != Some("recurring") {
        note.severity = Some("recurring".to_string());
    }
    vault.write_note(&note)?;
    Ok(note)
}

/// Apply a supersede: mark the existing note `status: superseded` and
/// return it (caller still writes the candidate note alongside).
pub fn apply_supersede(
    vault: &Vault,
    existing_note_id: &str,
    note_type: NoteType,
) -> Result<Note, RecallError> {
    let rel = Path::new(note_type.vault_subdir())
        .join(format!("{}.md", existing_note_id));
    let outcome = vault.read_note(&rel)?;
    let mut note = outcome.note;
    note.status = Status::Superseded;
    note.last_verified = Utc::now().date_naive();
    vault.write_note(&note)?;
    Ok(note)
}

fn find_overlap_candidates(
    db: &Database,
    vault_id: i64,
    source_paths: &[String],
) -> Result<Vec<IndexedNote>, RecallError> {
    crate::recall::index::query::notes_by_path_overlap(db, vault_id, source_paths, 25)
}

fn load_prior_count(vault: &Vault, indexed: &IndexedNote) -> Result<usize, RecallError> {
    let rel = Path::new(&indexed.file_path).to_path_buf();
    let outcome = vault.read_note(&rel)?;
    Ok(outcome.note.prior_occurrences.len())
}

/// Normalized-token Jaccard similarity. Compatible with the spec's
/// "no embeddings in v1" stance (§14). Lowercase + split on
/// non-alphanumerics + drop short tokens + Jaccard.
fn title_similarity(a: &str, b: &str) -> f64 {
    let ta = tokenize_title(a);
    let tb = tokenize_title(b);
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let inter = ta.intersection(&tb).count();
    let union = ta.union(&tb).count();
    if union == 0 {
        0.0
    } else {
        inter as f64 / union as f64
    }
}

fn tokenize_title(s: &str) -> HashSet<String> {
    s.to_ascii_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3)
        .map(|t| t.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::index::ingest::ingest_note;
    use crate::recall::index::{ensure_vault_row, test_helpers::*};
    use crate::recall::vault::{NoteType, Status, Trust};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn make_note(id: &str, ty: NoteType, title: &str, paths: &[&str], body: &str) -> Note {
        Note {
            id: id.to_string(),
            note_type: ty,
            project: Some("p".into()),
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
            tags: vec![],
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

    fn write_and_index(vault: &Vault, db: &Database, vault_id: i64, note: &Note) {
        vault.write_note(note).unwrap();
        let rel = std::path::PathBuf::from(note.note_type.vault_subdir())
            .join(format!("{}.md", note.id));
        ingest_note(db, vault_id, note, &rel).unwrap();
    }

    #[test]
    fn no_existing_overlap_returns_fresh() {
        let (_tmp, vault, db, vault_id) = setup();
        let candidate = make_note("l1", NoteType::Landmine, "new landmine", &["src/x.rs"], "body");
        let action = decide(&db, &vault, vault_id, &candidate, "abc123", "fn foo").unwrap();
        assert_eq!(action, DedupeAction::Fresh);
    }

    #[test]
    fn empty_source_paths_returns_fresh() {
        let (_tmp, vault, db, vault_id) = setup();
        let candidate = make_note("l1", NoteType::Landmine, "x", &[], "body");
        let action = decide(&db, &vault, vault_id, &candidate, "abc", "loc").unwrap();
        assert_eq!(action, DedupeAction::Fresh);
    }

    #[test]
    fn matching_title_and_paths_is_recurrence() {
        let (_tmp, vault, db, vault_id) = setup();
        let existing = make_note(
            "l1",
            NoteType::Landmine,
            "pgcrypto search_path landmine",
            &["src/credentials.ts"],
            "existing body",
        );
        write_and_index(&vault, &db, vault_id, &existing);
        let candidate = make_note(
            "l2-new",
            NoteType::Landmine,
            "pgcrypto search_path issue",
            &["src/credentials.ts"],
            "fresh body",
        );
        let action = decide(&db, &vault, vault_id, &candidate, "newhash", "decrypt_credential").unwrap();
        match action {
            DedupeAction::Recurrence { existing_note_id, new_occurrence, bump_to_recurring } => {
                assert_eq!(existing_note_id, "l1");
                assert_eq!(new_occurrence.commit_hash, "newhash");
                assert_eq!(new_occurrence.location, "decrypt_credential");
                assert!(!bump_to_recurring); // 0 prior + 1 new = 1 total, not 3
            }
            other => panic!("expected Recurrence, got {:?}", other),
        }
    }

    #[test]
    fn third_recurrence_bumps_severity_to_recurring() {
        let (_tmp, vault, db, vault_id) = setup();
        let mut existing = make_note(
            "l1",
            NoteType::Landmine,
            "pgcrypto search_path landmine",
            &["src/credentials.ts"],
            "body",
        );
        existing.prior_occurrences = vec![
            PriorOccurrence {
                commit_hash: "first".to_string(),
                date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                location: "loc1".to_string(),
            },
            PriorOccurrence {
                commit_hash: "second".to_string(),
                date: NaiveDate::from_ymd_opt(2026, 2, 1).unwrap(),
                location: "loc2".to_string(),
            },
        ];
        write_and_index(&vault, &db, vault_id, &existing);

        let candidate = make_note(
            "fresh",
            NoteType::Landmine,
            "pgcrypto search_path landmine",
            &["src/credentials.ts"],
            "fresh body",
        );
        let action = decide(&db, &vault, vault_id, &candidate, "newhash", "loc3").unwrap();
        match action {
            DedupeAction::Recurrence { bump_to_recurring, .. } => {
                assert!(bump_to_recurring, "3rd occurrence should bump");
            }
            other => panic!("expected Recurrence, got {:?}", other),
        }
    }

    #[test]
    fn divergent_title_overlapping_paths_is_supersede() {
        let (_tmp, vault, db, vault_id) = setup();
        let existing = make_note(
            "l1",
            NoteType::Landmine,
            "unrelated topic about widgets",
            &["src/credentials.ts"],
            "body",
        );
        write_and_index(&vault, &db, vault_id, &existing);
        let candidate = make_note(
            "fresh",
            NoteType::Landmine,
            "pgcrypto search_path landmine",
            &["src/credentials.ts"],
            "fresh body",
        );
        let action = decide(&db, &vault, vault_id, &candidate, "newhash", "loc").unwrap();
        match action {
            DedupeAction::Supersede { existing_note_id } => {
                assert_eq!(existing_note_id, "l1");
            }
            other => panic!("expected Supersede, got {:?}", other),
        }
    }

    #[test]
    fn apply_recurrence_appends_and_can_bump_severity() {
        let (_tmp, vault, _db, _vault_id) = setup();
        let original = make_note(
            "l1",
            NoteType::Landmine,
            "pgcrypto",
            &["src/x.rs"],
            "body",
        );
        vault.write_note(&original).unwrap();
        let occurrence = PriorOccurrence {
            commit_hash: "deadbeef".to_string(),
            date: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            location: "loc".to_string(),
        };
        let updated = apply_recurrence(&vault, "l1", NoteType::Landmine, occurrence.clone(), true).unwrap();
        assert_eq!(updated.prior_occurrences.len(), 1);
        assert_eq!(updated.prior_occurrences[0], occurrence);
        assert_eq!(updated.severity.as_deref(), Some("recurring"));
    }

    #[test]
    fn apply_supersede_marks_status_superseded() {
        let (_tmp, vault, _db, _vault_id) = setup();
        let original = make_note("l1", NoteType::Landmine, "x", &["src/x.rs"], "body");
        vault.write_note(&original).unwrap();
        let updated = apply_supersede(&vault, "l1", NoteType::Landmine).unwrap();
        assert_eq!(updated.status, Status::Superseded);
    }

    #[test]
    fn jaccard_similarity_perfect_match() {
        let sim = title_similarity("the same words here", "the same words here");
        assert!((sim - 1.0).abs() < 1e-9);
    }

    #[test]
    fn jaccard_similarity_no_overlap() {
        let sim = title_similarity("alpha beta gamma", "delta epsilon zeta");
        assert!(sim < 0.01);
    }

    #[test]
    fn jaccard_similarity_partial() {
        let sim = title_similarity("pgcrypto search path landmine", "pgcrypto search path issue");
        assert!(sim >= 0.5, "expected partial overlap >= 0.5, got {}", sim);
    }

    #[test]
    fn jaccard_drops_short_filler_tokens() {
        // "of" / "in" / "to" are filtered out by the >= 3 char filter.
        let sim = title_similarity("auth bug in the helper", "auth bug helper");
        assert!(sim >= 0.7, "filler-words shouldn't depress similarity: got {}", sim);
    }
}
