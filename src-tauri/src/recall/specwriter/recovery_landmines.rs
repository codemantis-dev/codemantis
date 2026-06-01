//! §9.2.2 third bullet — collect landmines for paths the Session
//! Plan references, so `recover_session_plan` can prepend them to
//! the recovery user prompt.
//!
//! No new LLM call. One cheap path-overlap query against the index,
//! filtered to `landmine` notes. The recovery system prompt then
//! quotes them so the model has the relevant pitfalls in front of
//! it while synthesizing the missing `Prompt for Claude Code:` block.

use std::path::Path;

use crate::recall::index::lookup_vault;
use crate::recall::index::query::notes_by_path_overlap;
use crate::recall::vault::Vault;
use crate::recall::RecallError;
use crate::storage::Database;

/// Rendered landmine block ready to prepend to a recovery prompt.
/// Empty string when no vault is registered or no landmines match.
pub fn render_landmine_block(
    db: &Database,
    project_path: &Path,
    paths: &[String],
) -> Result<String, RecallError> {
    if paths.is_empty() {
        return Ok(String::new());
    }
    let Some(vault_id) = lookup_vault(db, project_path, false)? else {
        return Ok(String::new());
    };
    let hits = notes_by_path_overlap(db, vault_id, paths, 25)?;
    let landmines: Vec<_> = hits.into_iter().filter(|n| n.note_type == "landmine").collect();
    if landmines.is_empty() {
        return Ok(String::new());
    }

    let vault_path = project_path.join(".recall");
    let vault = match Vault::open_or_create(&vault_path) {
        Ok(v) => v,
        // If the vault folder vanished after we registered it,
        // gracefully render titles only.
        Err(_) => {
            return Ok(render_titles_only(&landmines));
        }
    };

    let mut out = String::new();
    out.push_str("## Recall landmines covering this session's source paths\n\n");
    out.push_str("Read these before synthesizing the prompt; they describe pitfalls \
                  the dev agent should not re-introduce.\n\n");
    for n in &landmines {
        out.push_str(&format!("### [[{}]] — {}\n", n.note_id, n.title));
        if let Some(sev) = &n.severity {
            out.push_str(&format!("_severity: {} • trust: {}_\n\n", sev, n.trust));
        } else {
            out.push_str(&format!("_trust: {}_\n\n", n.trust));
        }
        // Pull a short excerpt from disk; fall back to title only on read failure.
        let rel = Path::new(&n.file_path).to_path_buf();
        match vault.read_note(&rel) {
            Ok(outcome) => {
                let body = outcome.note.body.trim();
                let excerpt: String = body.chars().take(500).collect();
                out.push_str(&excerpt);
                if body.chars().count() > 500 {
                    out.push('…');
                }
                out.push_str("\n\n");
            }
            Err(_) => {
                out.push_str("(landmine body unavailable — see vault)\n\n");
            }
        }
    }
    Ok(out)
}

fn render_titles_only(landmines: &[crate::recall::index::query::IndexedNote]) -> String {
    let mut out = String::new();
    out.push_str("## Recall landmines covering this session's source paths\n\n");
    for n in landmines {
        out.push_str(&format!("- [[{}]] — {}\n", n.note_id, n.title));
    }
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::index::ensure_vault_row;
    use crate::recall::index::ingest::ingest_note;
    use crate::recall::index::test_helpers::*;
    use crate::recall::vault::{Note, NoteType, Status, Trust, Vault};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, std::path::PathBuf, std::sync::Arc<crate::storage::Database>, i64) {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let project = tmp.path().to_path_buf();
        let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
        let vault_id = ensure_vault_row(&db, &project, vault.root(), false).unwrap();
        let _ = vault;
        (tmp, project, db, vault_id)
    }

    fn make_landmine(id: &str, title: &str, paths: &[&str], body: &str) -> Note {
        Note {
            id: id.to_string(),
            note_type: NoteType::Landmine,
            project: None,
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

    #[test]
    fn empty_paths_returns_empty_block() {
        let (_tmp, project, db, _vid) = fixture();
        let out = render_landmine_block(&db, &project, &[]).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn no_matching_landmines_returns_empty_block() {
        let (_tmp, project, db, vault_id) = fixture();
        // Pattern, not landmine, on the path.
        let mut p = make_landmine("pat", "not a landmine", &["src/x.rs"], "body");
        p.note_type = NoteType::Pattern;
        let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
        vault.write_note(&p).unwrap();
        ingest_note(&db, vault_id, &p, std::path::Path::new("notes/patterns/pat.md")).unwrap();

        let out = render_landmine_block(&db, &project, &["src/x.rs".to_string()]).unwrap();
        assert!(out.is_empty(), "no landmines = no block");
    }

    #[test]
    fn landmine_on_session_plan_path_renders_in_block() {
        let (_tmp, project, db, vault_id) = fixture();
        let n = make_landmine(
            "pgcrypto",
            "pgcrypto search path landmine",
            &["src/credentials.ts"],
            "Always schema-qualify pgcrypto. Has bitten us 4 times.",
        );
        let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
        vault.write_note(&n).unwrap();
        ingest_note(&db, vault_id, &n, std::path::Path::new("notes/landmines/pgcrypto.md")).unwrap();

        let out = render_landmine_block(&db, &project, &["src/credentials.ts".to_string()])
            .unwrap();
        assert!(out.contains("Recall landmines"));
        assert!(out.contains("[[pgcrypto]]"));
        assert!(out.contains("pgcrypto search path landmine"));
        assert!(out.contains("Always schema-qualify"));
        assert!(out.contains("trust: high"));
    }

    #[test]
    fn unregistered_vault_returns_empty_block() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        // No vault registered — lookup_vault returns None.
        let out = render_landmine_block(&db, tmp.path(), &["src/x.rs".to_string()]).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn severity_recurring_appears_in_rendered_block() {
        let (_tmp, project, db, vault_id) = fixture();
        let mut n = make_landmine("r", "recurring landmine", &["src/x.rs"], "body");
        n.severity = Some("recurring".to_string());
        let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
        vault.write_note(&n).unwrap();
        ingest_note(&db, vault_id, &n, std::path::Path::new("notes/landmines/r.md")).unwrap();
        let out = render_landmine_block(&db, &project, &["src/x.rs".to_string()]).unwrap();
        assert!(out.contains("severity: recurring"));
    }
}
