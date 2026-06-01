//! Vault filesystem: open/create a per-project `.recall/` tree, read/write
//! notes atomically, and walk the tree to list every note for indexing.

use std::path::{Path, PathBuf};

use super::markdown::{parse_note, serialize_note, ParseOutcome};
use super::{note_relative_path, Note};
use crate::recall::RecallError;

/// On-disk vault handle.
///
/// The vault is opened lazily — the directory is created on first open
/// but the README/MANIFEST scaffolding is not populated here. Phase 5's
/// cold-start owns user-facing seeding; Phase 1 only guarantees that the
/// vault path exists and the subdirectories for each note type are
/// reachable by [`write_note`].
#[derive(Debug)]
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    /// Open the vault at `root`, creating the directory tree if needed.
    pub fn open_or_create(root: &Path) -> Result<Self, RecallError> {
        if !root.exists() {
            std::fs::create_dir_all(root)?;
        }
        if !root.is_dir() {
            return Err(RecallError::InvalidVaultPath(format!(
                "{} exists but is not a directory",
                root.display()
            )));
        }
        Ok(Self {
            root: root.to_path_buf(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve `<vault>/<relative>`. Caller guarantees `relative` is not
    /// an absolute path; we return an error if it is, to defend against
    /// path-traversal via crafted note ids.
    pub fn resolve(&self, relative: &Path) -> Result<PathBuf, RecallError> {
        if relative.is_absolute() {
            return Err(RecallError::InvalidVaultPath(format!(
                "absolute path not allowed: {}",
                relative.display()
            )));
        }
        if relative
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(RecallError::InvalidVaultPath(format!(
                "path traversal via .. not allowed: {}",
                relative.display()
            )));
        }
        Ok(self.root.join(relative))
    }

    /// Read and parse a note. The relative path must include the
    /// `notes/<type>/<id>.md` segments.
    pub fn read_note(&self, relative: &Path) -> Result<ParseOutcome, RecallError> {
        let abs = self.resolve(relative)?;
        let raw = std::fs::read_to_string(&abs)?;
        let fallback_id = abs
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let mut outcome = parse_note(&raw, fallback_id)?;
        outcome.note.file_path = Some(abs);
        Ok(outcome)
    }

    /// Atomically write a note. Uses tmp-file + rename so concurrent
    /// readers never observe a partial write.
    pub fn write_note(&self, note: &Note) -> Result<PathBuf, RecallError> {
        let rel = note_relative_path(note)?;
        let abs = self.resolve(&rel)?;
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let serialized = serialize_note(note);

        let tmp = abs.with_extension("md.tmp");
        std::fs::write(&tmp, serialized.as_bytes())?;
        std::fs::rename(&tmp, &abs)?;
        Ok(abs)
    }

    /// Walk `<vault>/notes/**/*.md` and return every note path, relative
    /// to the vault root. Returns paths in a stable sorted order so the
    /// indexer's runs are deterministic.
    pub fn list_notes(&self) -> Result<Vec<PathBuf>, RecallError> {
        let notes_root = self.root.join("notes");
        let mut out = Vec::new();
        if !notes_root.exists() {
            return Ok(out);
        }
        walk_md(&notes_root, &mut out)?;
        // Convert each path back to vault-relative form.
        let mut rels: Vec<PathBuf> = out
            .into_iter()
            .filter_map(|p| p.strip_prefix(&self.root).ok().map(|p| p.to_path_buf()))
            .collect();
        rels.sort();
        Ok(rels)
    }

    /// Append a one-line entry to the vault's journal for today. Creates
    /// the journal directory and the daily file as needed. The harvester
    /// (Phase 3) drives this; Phase 1 only ships the plumbing.
    pub fn append_journal(&self, date: chrono::NaiveDate, line: &str) -> Result<PathBuf, RecallError> {
        let dir = self.root.join("journal");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{}.md", date));
        let exists = path.exists();
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        if !exists {
            // Tiny daily header so Obsidian renders it cleanly.
            writeln!(file, "# Journal — {}\n", date)?;
        }
        writeln!(file, "{}", line)?;
        Ok(path)
    }
}

fn walk_md(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let path = entry.path();
        if ty.is_dir() {
            walk_md(&path, out)?;
        } else if ty.is_file()
            && path.extension().and_then(|s| s.to_str()) == Some("md")
            // Skip .tmp leftovers from an interrupted atomic write.
            && !path
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.ends_with(".md.tmp"))
        {
            out.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::vault::{NoteType, Status, Trust};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn sample_note(id: &str, note_type: NoteType) -> Note {
        Note {
            id: id.to_string(),
            note_type,
            project: Some("test".to_string()),
            status: Status::Active,
            trust: Trust::High,
            trust_raw: String::new(),
            severity: None,
            discovered: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            last_verified: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            source_paths: vec!["src/lib.rs".to_string()],
            source_commits: vec![],
            prior_occurrences: vec![],
            links: vec![],
            tags: vec!["test".to_string()],
            title: format!("Test note {}", id),
            body: "body content".to_string(),
            file_path: None,
        }
    }

    #[test]
    fn open_or_create_creates_missing_directory() {
        let tmp = TempDir::new().unwrap();
        let vault_path = tmp.path().join(".recall");
        let vault = Vault::open_or_create(&vault_path).unwrap();
        assert!(vault_path.exists());
        assert_eq!(vault.root(), vault_path);
    }

    #[test]
    fn open_fails_when_path_is_a_file() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("not-a-dir");
        std::fs::write(&file_path, b"hi").unwrap();
        let err = Vault::open_or_create(&file_path).unwrap_err();
        assert!(matches!(err, RecallError::InvalidVaultPath(_)));
    }

    #[test]
    fn write_then_read_round_trip() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let note = sample_note("landmine-pgcrypto", NoteType::Landmine);
        let written = vault.write_note(&note).unwrap();
        assert!(written.exists());
        let rel = written.strip_prefix(tmp.path()).unwrap();
        let outcome = vault.read_note(rel).unwrap();
        assert!(!outcome.partial);
        assert_eq!(outcome.note.id, "landmine-pgcrypto");
        assert_eq!(outcome.note.note_type, NoteType::Landmine);
        assert!(outcome.note.file_path.is_some());
    }

    #[test]
    fn write_is_atomic_no_partial_tmp_file_remains() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let note = sample_note("p-1", NoteType::Pattern);
        let final_path = vault.write_note(&note).unwrap();
        let tmp_path = final_path.with_extension("md.tmp");
        assert!(!tmp_path.exists(), "tmp file should be renamed away");
    }

    #[test]
    fn list_notes_walks_all_subdirs() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        vault.write_note(&sample_note("l-1", NoteType::Landmine)).unwrap();
        vault.write_note(&sample_note("p-1", NoteType::Pattern)).unwrap();
        vault.write_note(&sample_note("d-1", NoteType::Decision)).unwrap();
        let listed = vault.list_notes().unwrap();
        assert_eq!(listed.len(), 3);
        // All paths start with "notes/<type>/".
        for p in &listed {
            assert!(p.starts_with("notes"));
            assert_eq!(p.extension().and_then(|s| s.to_str()), Some("md"));
        }
    }

    #[test]
    fn list_notes_skips_tmp_leftovers() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let dir = tmp.path().join("notes/landmines");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("real.md"), b"# real\n").unwrap();
        std::fs::write(dir.join("orphan.md.tmp"), b"interrupted").unwrap();
        let listed = vault.list_notes().unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].ends_with("real.md"));
    }

    #[test]
    fn list_notes_returns_empty_when_no_notes_dir() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let listed = vault.list_notes().unwrap();
        assert!(listed.is_empty());
    }

    #[test]
    fn resolve_rejects_absolute_paths() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let abs = if cfg!(windows) {
            Path::new("C:\\evil.md")
        } else {
            Path::new("/etc/passwd")
        };
        let err = vault.resolve(abs).unwrap_err();
        assert!(matches!(err, RecallError::InvalidVaultPath(_)));
    }

    #[test]
    fn resolve_rejects_parent_dir_traversal() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let err = vault.resolve(Path::new("../escape.md")).unwrap_err();
        assert!(matches!(err, RecallError::InvalidVaultPath(_)));
    }

    #[test]
    fn append_journal_creates_file_with_header_on_first_write() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open_or_create(tmp.path()).unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        let path = vault.append_journal(date, "first entry").unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("# Journal — 2026-06-01"));
        assert!(body.contains("first entry"));

        // Second append: no duplicate header.
        let path2 = vault.append_journal(date, "second entry").unwrap();
        assert_eq!(path, path2);
        let body2 = std::fs::read_to_string(&path).unwrap();
        let header_count = body2.matches("# Journal —").count();
        assert_eq!(header_count, 1, "header should only appear once");
        assert!(body2.contains("second entry"));
    }
}
