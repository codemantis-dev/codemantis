//! Vault — on-disk markdown + frontmatter layer.
//!
//! Truth is in the files; SQLite is a cache. Notes are plain Markdown with
//! YAML frontmatter (§5.3) and `[[wikilinks]]` (§5.4). This module owns the
//! types, the parse/serialize round-trip, the wikilink extractor, and the
//! atomic filesystem layer.

pub mod filesystem;
pub mod markdown;
pub mod wikilinks;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::recall::RecallError;

pub use filesystem::Vault;

/// Note type, per §5.3 enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NoteType {
    Landmine,
    Pattern,
    Decision,
    DbTable,
    ProviderHandbook,
    Module,
}

impl NoteType {
    pub fn as_str(self) -> &'static str {
        match self {
            NoteType::Landmine => "landmine",
            NoteType::Pattern => "pattern",
            NoteType::Decision => "decision",
            NoteType::DbTable => "db-table",
            NoteType::ProviderHandbook => "provider-handbook",
            NoteType::Module => "module",
        }
    }

    pub fn vault_subdir(self) -> &'static str {
        match self {
            NoteType::Landmine => "notes/landmines",
            NoteType::Pattern => "notes/patterns",
            NoteType::Decision => "notes/decisions",
            NoteType::DbTable => "notes/db-tables",
            NoteType::ProviderHandbook => "notes/provider-handbooks",
            NoteType::Module => "notes/modules",
        }
    }
}

/// Trust signal — §5.3 frontmatter. Surfaces in the brief and gates whether
/// the enricher's smart-select can drop a note under budget pressure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Trust {
    High,
    Medium,
    Low,
    Inferred,
    /// Seeded from existing user artifacts (`.claude/memory/`, ADRs, etc.)
    /// during cold-start. Format on disk: `seeded:existing-memory` etc. —
    /// the colon-suffix is preserved in [`Note::trust_raw`] when needed,
    /// but most call sites only care about the bucket.
    Seeded,
}

impl Trust {
    pub fn as_str(self) -> &'static str {
        match self {
            Trust::High => "high",
            Trust::Medium => "medium",
            Trust::Low => "low",
            Trust::Inferred => "inferred",
            Trust::Seeded => "seeded",
        }
    }

    /// Parse the leading bucket from a frontmatter value. Accepts the
    /// extended `seeded:<source>` form and maps it to `Trust::Seeded`.
    pub fn parse(s: &str) -> Option<Self> {
        let head = s.split(':').next()?.trim();
        match head {
            "high" => Some(Trust::High),
            "medium" => Some(Trust::Medium),
            "low" => Some(Trust::Low),
            "inferred" => Some(Trust::Inferred),
            "seeded" => Some(Trust::Seeded),
            _ => None,
        }
    }
}

/// Active = surfaces in briefs. Superseded = link target only.
/// Archived = on disk but never injected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Active,
    Superseded,
    Archived,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Active => "active",
            Status::Superseded => "superseded",
            Status::Archived => "archived",
        }
    }
}

/// Recurrence ledger entry, §5.3 `prior_occurrences[]`. The harvester
/// appends here when it detects the same root cause hitting again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PriorOccurrence {
    #[serde(rename = "commit")]
    pub commit_hash: String,
    pub date: NaiveDate,
    pub location: String,
}

/// One markdown note. The on-disk representation is YAML frontmatter
/// (rendered by [`markdown::serialize_note`]) + markdown body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note {
    /// Stable kebab-case slug, immutable across the note's lifetime.
    pub id: String,
    pub note_type: NoteType,
    /// `null` (i.e. `None`) for meta-vault notes.
    pub project: Option<String>,
    pub status: Status,
    pub trust: Trust,
    /// Preserved raw trust value, including any `seeded:<source>` suffix.
    /// Empty when the parsed [`Trust`] is the canonical form.
    pub trust_raw: String,
    /// Optional severity (landmines mostly): "recurring" once 3+ prior
    /// occurrences are recorded.
    pub severity: Option<String>,
    pub discovered: NaiveDate,
    pub last_verified: NaiveDate,
    pub source_paths: Vec<String>,
    pub source_commits: Vec<String>,
    pub prior_occurrences: Vec<PriorOccurrence>,
    /// `[[wikilinks]]` listed convenience-style in frontmatter. The
    /// authoritative graph is extracted from the body via
    /// [`wikilinks::extract`].
    pub links: Vec<String>,
    pub tags: Vec<String>,
    /// Title from the first `# heading` in the body.
    pub title: String,
    /// Markdown body, minus the leading `# heading` line.
    pub body: String,
    /// On-disk path, set when the note was read from the vault. Newly
    /// constructed notes (pre-write) leave this `None`.
    pub file_path: Option<PathBuf>,
}

impl Note {
    /// Compute the SHA-256 hex digest of the body. Used by the indexer to
    /// detect content changes without re-parsing the whole frontmatter.
    pub fn body_hash(&self) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(self.body.as_bytes());
        let digest = hasher.finalize();
        let mut out = String::with_capacity(digest.len() * 2);
        for byte in digest {
            out.push_str(&format!("{:02x}", byte));
        }
        out
    }
}

/// Resolve the on-disk path for a note inside a vault. Used by
/// [`filesystem::Vault::write_note`] and by [`markdown::serialize_note`]
/// callers that need to know where the note *would* go.
pub fn note_relative_path(note: &Note) -> Result<PathBuf, RecallError> {
    if note.id.is_empty() {
        return Err(RecallError::Config(
            "note id cannot be empty".to_string(),
        ));
    }
    let subdir = note.note_type.vault_subdir();
    Ok(Path::new(subdir).join(format!("{}.md", note.id)))
}
