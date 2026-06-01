//! §9.2.6 — turn `verify_action_parity` FAIL results into landmine
//! notes.
//!
//! Why this matters: a parity FAIL is *deterministic ground truth*
//! (caller declares an action, handler has no matching code) — there
//! is no LLM hallucination risk, so notes here start at `trust: high`
//! immediately. This is the primary mechanism by which "mock-only
//! PASS" failures permanently exit the codebase: the next session
//! that asks SpecWriter to write a spec touching the handler path
//! sees the landmine in the brief.

use std::collections::HashSet;
use std::path::Path;

use chrono::Utc;

use crate::recall::harvester::dedupe::{
    apply_recurrence, apply_supersede, decide, DedupeAction,
};
use crate::recall::index::ensure_vault_row;
use crate::recall::index::ingest::ingest_note;
use crate::recall::vault::{Note, NoteType, PriorOccurrence, Status, Trust, Vault};
use crate::recall::RecallError;
use crate::storage::Database;

/// Minimal projection of `commands::specwriter::ActionParityResult`
/// joined with the request inputs the FAIL refers to. Kept narrow
/// so the caller can construct it from either the live SpecWriter
/// types or from test fixtures without dragging the whole specwriter
/// module into Recall's compile graph.
#[derive(Debug, Clone)]
pub struct ParityFail<'a> {
    /// Action / wire identifier from the request.
    pub action: &'a str,
    /// Caller paths declared in the request (caller_path + caller_paths).
    pub caller_paths: &'a [String],
    /// Handler path declared in the request.
    pub handler_path: &'a str,
    /// The `detail` field of the FAIL result. Used for stub-marker
    /// detection.
    pub detail: &'a str,
    /// Optional pointer to the spec that declared this action — when
    /// supplied we add a wikilink so the chain "spec → declared
    /// action Y → handler missing/stubbed → note → next spec touching
    /// same paths sees the note" is traceable in the vault.
    pub spec_note_id: Option<&'a str>,
}

impl<'a> ParityFail<'a> {
    /// Stub-marker detection per §9.2.2 point 4. Matches the actual
    /// FAIL detail strings produced by
    /// `commands::specwriter::check_one_action` and the handler-stub
    /// scan regex (`until then|NotImplementedError|TODO: implement|
    /// unknown action|pass  # stub|return 501`). The detection must
    /// distinguish FAIL details from the PASS message which contains
    /// "stub-free" — checked first.
    pub fn is_stub_marker(&self) -> bool {
        let lower = self.detail.to_ascii_lowercase();
        if lower.contains("stub-free") {
            return false;
        }
        lower.contains("does not reference")
            || lower.contains("has not been implemented")
            || lower.contains("notimplemented")
            || lower.contains("todo: implement")
            || lower.contains("unknown action")
            || lower.contains("return 501")
            || lower.contains("returns 501")
            || lower.contains("has a stub")
            || lower.contains("is a stub")
            || lower.contains("# stub")
            || lower.contains("missing handler")
            || lower.contains("no handler")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LandmineOutcome {
    /// Created a fresh landmine note.
    Created { note_id: String },
    /// Existing landmine matched; appended occurrence.
    Recurrence { note_id: String, bumped_to_recurring: bool },
    /// Existing landmine on the same paths but different framing;
    /// superseded it with this new one.
    Superseded { old_note_id: String, new_note_id: String },
    /// The FAIL didn't look like a stub-marker. No-op.
    Skipped,
}

/// Persist a landmine note for a single parity FAIL. Idempotent: a
/// repeat call on the same action + handler appends to
/// `prior_occurrences[]` rather than creating a duplicate, and bumps
/// `severity: recurring` at the third occurrence (mirrors §7.2).
pub fn landmine_from_fail(
    db: &Database,
    project_path: &Path,
    fail: &ParityFail<'_>,
) -> Result<LandmineOutcome, RecallError> {
    if !fail.is_stub_marker() {
        return Ok(LandmineOutcome::Skipped);
    }
    let vault_path = project_path.join(".recall");
    let vault = Vault::open_or_create(&vault_path)?;
    let vault_id = ensure_vault_row(db, project_path, &vault_path, false)?;

    let candidate = build_candidate(fail);

    // Re-use the harvester's dedupe to decide what to do.
    let occurrence_loc = fail.handler_path.to_string();
    let pseudo_commit_hash = format!(
        "parity-{}",
        Utc::now().format("%Y%m%d%H%M%S")
    );
    let action = decide(
        db,
        &vault,
        vault_id,
        &candidate,
        &pseudo_commit_hash,
        &occurrence_loc,
    )?;

    let outcome = match action {
        DedupeAction::Fresh => {
            let written_path = vault.write_note(&candidate)?;
            let rel = written_path
                .strip_prefix(vault.root())
                .map(|p| p.to_path_buf())
                .unwrap_or(written_path);
            ingest_note(db, vault_id, &candidate, &rel)?;
            LandmineOutcome::Created {
                note_id: candidate.id.clone(),
            }
        }
        DedupeAction::Recurrence { existing_note_id, new_occurrence, bump_to_recurring } => {
            let updated = apply_recurrence(
                &vault,
                &existing_note_id,
                NoteType::Landmine,
                new_occurrence,
                bump_to_recurring,
            )?;
            let rel = Path::new(NoteType::Landmine.vault_subdir())
                .join(format!("{}.md", updated.id));
            ingest_note(db, vault_id, &updated, &rel)?;
            LandmineOutcome::Recurrence {
                note_id: updated.id,
                bumped_to_recurring: bump_to_recurring,
            }
        }
        DedupeAction::Supersede { existing_note_id } => {
            let _superseded = apply_supersede(&vault, &existing_note_id, NoteType::Landmine)?;
            // Re-ingest superseded so the index reflects new status.
            let rel_old = Path::new(NoteType::Landmine.vault_subdir())
                .join(format!("{}.md", existing_note_id));
            let outcome = vault.read_note(&rel_old)?;
            ingest_note(db, vault_id, &outcome.note, &rel_old)?;
            // Link new note to the superseded one.
            let mut new_note = candidate;
            new_note.links.push(format!("[[{}]]", existing_note_id));
            let written_path = vault.write_note(&new_note)?;
            let rel = written_path
                .strip_prefix(vault.root())
                .map(|p| p.to_path_buf())
                .unwrap_or(written_path);
            ingest_note(db, vault_id, &new_note, &rel)?;
            LandmineOutcome::Superseded {
                old_note_id: existing_note_id,
                new_note_id: new_note.id,
            }
        }
    };

    let _ = occurrence_loc; // silence unused warning if dedupe path doesn't read it
    Ok(outcome)
}

fn build_candidate(fail: &ParityFail<'_>) -> Note {
    let title = if fail.detail.to_ascii_lowercase().contains("stub") {
        format!("Cross-system action `{}` has a stub handler", fail.action)
    } else {
        format!("Cross-system action `{}` has no handler", fail.action)
    };
    let id = slugify(&title);

    // source_paths = union(caller_paths, [handler_path]) — both sides
    // of the cross-system call must surface this landmine to the
    // Enricher in future runs.
    let mut paths: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for p in fail.caller_paths {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            paths.push(trimmed.to_string());
        }
    }
    if !fail.handler_path.trim().is_empty() && seen.insert(fail.handler_path.to_string()) {
        paths.push(fail.handler_path.to_string());
    }

    let mut links: Vec<String> = Vec::new();
    if let Some(spec_id) = fail.spec_note_id {
        if !spec_id.trim().is_empty() {
            links.push(format!("[[{}]]", spec_id));
        }
    }

    let now = Utc::now().date_naive();
    let body = render_body(fail);

    // Seed the initial FAIL as prior_occurrences[0] so the
    // "3 occurrences → severity: recurring" threshold counts the
    // original FAIL itself. The 2nd and 3rd parity FAIL calls then
    // bump correctly via the harvester's existing dedupe logic.
    let initial_occurrence = PriorOccurrence {
        commit_hash: format!("parity-{}", Utc::now().format("%Y%m%d%H%M%S%f")),
        date: now,
        location: fail.handler_path.to_string(),
    };

    Note {
        id,
        note_type: NoteType::Landmine,
        project: None,
        status: Status::Active,
        // §9.2.6: FAIL is ground truth → trust starts at high. No
        // fidelity step needed (we didn't pass through an LLM).
        trust: Trust::High,
        trust_raw: String::new(),
        severity: None,
        discovered: now,
        last_verified: now,
        source_paths: paths,
        source_commits: vec![],
        prior_occurrences: vec![initial_occurrence],
        links,
        tags: vec![
            "parity-fail".to_string(),
            "cross-system".to_string(),
        ],
        title,
        body,
        file_path: None,
    }
}

fn render_body(fail: &ParityFail<'_>) -> String {
    let mut out = String::new();
    out.push_str("## What the parity check found\n\n");
    out.push_str(fail.detail);
    out.push_str("\n\n## Future trigger\n\n");
    out.push_str(&format!(
        "Any spec touching the caller or handler path must verify that action `{}` is wired end-to-end. \
         Caller paths: {}; handler path: `{}`.\n",
        fail.action,
        format_path_list(fail.caller_paths),
        fail.handler_path,
    ));
    out
}

fn format_path_list(paths: &[String]) -> String {
    if paths.is_empty() {
        return "(none)".to_string();
    }
    paths
        .iter()
        .map(|p| format!("`{}`", p))
        .collect::<Vec<_>>()
        .join(", ")
}

fn slugify(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut prev_dash = false;
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::index::test_helpers::*;
    use tempfile::TempDir;

    fn fail<'a>(
        action: &'a str,
        callers: &'a [String],
        handler: &'a str,
        detail: &'a str,
    ) -> ParityFail<'a> {
        ParityFail {
            action,
            caller_paths: callers,
            handler_path: handler,
            detail,
            spec_note_id: None,
        }
    }

    fn project_with_vault() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let project = tmp.path().to_path_buf();
        Vault::open_or_create(&project.join(".recall")).unwrap();
        (tmp, project)
    }

    #[test]
    fn stub_marker_detail_creates_landmine_with_high_trust() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        let callers = vec!["src/api/client.ts".to_string()];
        let f = fail(
            "insert_note",
            &callers,
            "src/server/handlers.py",
            "handler path has no implementation: pass  # stub",
        );
        let outcome = landmine_from_fail(&db, &project, &f).unwrap();
        match outcome {
            LandmineOutcome::Created { note_id } => {
                let path = project
                    .join(".recall/notes/landmines")
                    .join(format!("{}.md", note_id));
                let body = std::fs::read_to_string(path).unwrap();
                assert!(body.contains("type: landmine"));
                assert!(body.contains("trust: high"));
                assert!(body.contains("src/api/client.ts"));
                assert!(body.contains("src/server/handlers.py"));
                assert!(body.contains("parity-fail"));
            }
            other => panic!("expected Created, got {:?}", other),
        }
    }

    #[test]
    fn pass_result_with_no_stub_marker_returns_skipped() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        let callers = vec!["src/x.rs".to_string()];
        let f = fail(
            "all_good",
            &callers,
            "src/y.rs",
            "caller + handler both reference 'all_good' and handler is stub-free",
        );
        let outcome = landmine_from_fail(&db, &project, &f).unwrap();
        assert_eq!(outcome, LandmineOutcome::Skipped);
    }

    #[test]
    fn second_call_for_same_action_appends_prior_occurrence() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        let callers = vec!["src/api/client.ts".to_string()];
        let f = fail(
            "insert_note",
            &callers,
            "src/server/handlers.py",
            "handler path 'src/server/handlers.py' does not reference action 'insert_note' — missing",
        );
        let first = landmine_from_fail(&db, &project, &f).unwrap();
        let note_id = match &first {
            LandmineOutcome::Created { note_id } => note_id.clone(),
            other => panic!("expected Created, got {:?}", other),
        };
        let second = landmine_from_fail(&db, &project, &f).unwrap();
        match second {
            LandmineOutcome::Recurrence { note_id: rec_id, .. } => assert_eq!(rec_id, note_id),
            other => panic!("expected Recurrence, got {:?}", other),
        }

        let path = project
            .join(".recall/notes/landmines")
            .join(format!("{}.md", note_id));
        let body = std::fs::read_to_string(path).unwrap();
        assert!(body.contains("prior_occurrences:"));
        let listing: Vec<_> = std::fs::read_dir(project.join(".recall/notes/landmines"))
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(listing.len(), 1, "no duplicate file");
    }

    #[test]
    fn third_occurrence_bumps_severity_to_recurring() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        let callers = vec!["src/api/client.ts".to_string()];
        let f = fail(
            "insert_note",
            &callers,
            "src/server/handlers.py",
            "missing handler",
        );
        landmine_from_fail(&db, &project, &f).unwrap();
        landmine_from_fail(&db, &project, &f).unwrap();
        let third = landmine_from_fail(&db, &project, &f).unwrap();
        match third {
            LandmineOutcome::Recurrence { bumped_to_recurring, .. } => {
                assert!(bumped_to_recurring);
            }
            other => panic!("expected Recurrence with bump, got {:?}", other),
        }
    }

    #[test]
    fn source_paths_include_both_caller_and_handler() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        let callers = vec!["a.rs".to_string(), "b.rs".to_string()];
        let f = fail("act", &callers, "c.rs", "handler is a stub");
        let outcome = landmine_from_fail(&db, &project, &f).unwrap();
        let note_id = match outcome {
            LandmineOutcome::Created { note_id } => note_id,
            other => panic!("expected Created, got {:?}", other),
        };
        let body = std::fs::read_to_string(
            project
                .join(".recall/notes/landmines")
                .join(format!("{}.md", note_id)),
        )
        .unwrap();
        assert!(body.contains("- a.rs"));
        assert!(body.contains("- b.rs"));
        assert!(body.contains("- c.rs"));
    }

    #[test]
    fn spec_note_id_creates_wikilink_in_note() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        let callers = vec!["a.rs".to_string()];
        let mut f = fail("act", &callers, "b.rs", "handler is a stub");
        f.spec_note_id = Some("spec-payments-v1");
        let outcome = landmine_from_fail(&db, &project, &f).unwrap();
        let note_id = match outcome {
            LandmineOutcome::Created { note_id } => note_id,
            other => panic!("expected Created, got {:?}", other),
        };
        let body = std::fs::read_to_string(
            project
                .join(".recall/notes/landmines")
                .join(format!("{}.md", note_id)),
        )
        .unwrap();
        assert!(body.contains("[[spec-payments-v1]]"));
    }

    #[test]
    fn is_stub_marker_covers_canonical_patterns() {
        let cases = [
            "handler returns 501",
            "NotImplementedError raised",
            "// TODO: implement",
            "unknown action",
            "pass  # stub",
            "handler does not reference action",
            "missing handler implementation",
        ];
        let callers = vec!["x.rs".to_string()];
        for c in cases {
            let f = fail("a", &callers, "h.rs", c);
            assert!(f.is_stub_marker(), "should detect: {}", c);
        }
    }

    #[test]
    fn slugify_produces_kebab_case_from_title() {
        // Note: underscores are NOT alphanumeric per `is_ascii_alphanumeric`
        // so `foo_bar` collapses to `foo-bar`. Backticks are also dropped.
        assert_eq!(
            slugify("Cross-system action `foo_bar` has a stub handler"),
            "cross-system-action-foo-bar-has-a-stub-handler"
        );
    }
}
