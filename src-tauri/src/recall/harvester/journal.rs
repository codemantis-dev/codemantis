//! Step 6: append a one-line entry to the daily journal.
//!
//! Per spec §7.2 step 6 the harvester appends `<vault>/journal/YYYY-MM-DD.md`
//! with the commit hash, short title, and a wikilink to the
//! created-or-updated note. Built on [`Vault::append_journal`].

use chrono::NaiveDate;

use crate::recall::vault::{Note, Vault};
use crate::recall::RecallError;
use std::path::PathBuf;

/// Append one journal line for a freshly harvested commit.
pub fn append(
    vault: &Vault,
    date: NaiveDate,
    commit_hash_short: &str,
    note: &Note,
    action: HarvestAction,
) -> Result<PathBuf, RecallError> {
    let prefix = match action {
        HarvestAction::Created => "added",
        HarvestAction::Recurrence => "recurrence",
        HarvestAction::Superseded => "superseded",
    };
    let line = format!(
        "- `{}` — {}: [[{}]] — {}",
        commit_hash_short, prefix, note.id, note.title
    );
    vault.append_journal(date, &line)
}

/// What the harvester ended up doing — used to render the journal
/// line and to drive the audit-log entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarvestAction {
    Created,
    Recurrence,
    Superseded,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::vault::{NoteType, Status, Trust};
    use tempfile::TempDir;

    fn make_note(id: &str, title: &str) -> Note {
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
            source_paths: vec![],
            source_commits: vec![],
            prior_occurrences: vec![],
            links: vec![],
            tags: vec![],
            title: title.to_string(),
            body: String::new(),
            file_path: None,
        }
    }

    #[test]
    fn append_creates_journal_file_and_writes_line() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        let n = make_note("l1", "pgcrypto landmine");
        let path = append(&vault, date, "abc1234", &n, HarvestAction::Created).unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("# Journal — 2026-06-01"));
        assert!(body.contains("`abc1234` — added: [[l1]] — pgcrypto landmine"));
    }

    #[test]
    fn append_uses_action_prefix() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        let n = make_note("l1", "x");
        append(&vault, date, "h1", &n, HarvestAction::Created).unwrap();
        append(&vault, date, "h2", &n, HarvestAction::Recurrence).unwrap();
        append(&vault, date, "h3", &n, HarvestAction::Superseded).unwrap();
        let body = std::fs::read_to_string(tmp.path().join("journal/2026-06-01.md")).unwrap();
        assert!(body.contains("added"));
        assert!(body.contains("recurrence"));
        assert!(body.contains("superseded"));
    }

    #[test]
    fn append_to_same_day_keeps_one_header() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        for i in 0..5 {
            let n = make_note(&format!("n{}", i), &format!("note {}", i));
            append(&vault, date, &format!("h{}", i), &n, HarvestAction::Created).unwrap();
        }
        let body = std::fs::read_to_string(tmp.path().join("journal/2026-06-01.md")).unwrap();
        assert_eq!(body.matches("# Journal —").count(), 1);
        for i in 0..5 {
            assert!(body.contains(&format!("h{}", i)));
        }
    }
}
