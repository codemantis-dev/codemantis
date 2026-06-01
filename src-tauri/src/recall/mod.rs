//! Recall — project-and-cross-project memory layer for coding agents.
//!
//! Recall sits *around* the dev-agent invocation. Two halves:
//!
//!   * **Enricher** (Phase 2): composes a focused brief from the project's
//!     accumulated knowledge before a prompt reaches the agent.
//!   * **Harvester** (Phase 3): on commit, distills one atomic memory note
//!     anchored to the diff as ground truth.
//!
//! Phase 1 (this PR) lands the substrate: a vault filesystem layer
//! (markdown, wikilinks, atomic write), a SQLite index (8 tables and
//! an FTS5 virtual table), config loading, and two read-only Tauri
//! commands (`recall_status`, `recall_reindex`). No LLM pipelines, no
//! UI, no behavior change for existing flows — everything ships behind
//! a default-off feature flag.
//!
//! Spec: `_guidance/requirements/CodeMantis_RECALL-SPEC.md` v1.0
//! Plan: `_guidance/plans/recall-implementation-plan.md`

// Phase 1 lays the substrate; many items here are consumed by Phases 2-5
// (Enricher, Harvester, SpecWriter integration, UI). Dead-code suppression
// is scoped to this module so the surface is reviewable without churn at
// every phase boundary.
#![allow(dead_code)]

pub mod commands;
pub mod config;
pub mod enricher;
pub mod git;
pub mod harvester;
pub mod index;
pub mod llm_client;
pub mod vault;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;

use crate::storage::Database;

pub use vault::Vault;

/// Per-project Recall handle.
///
/// One instance per opened project. Owns the on-disk vault and a reference
/// to the shared SQLite database (the recall_* tables live in CodeMantis's
/// main `codemantis.db`, not a separate file — `.recall-index.db` mentioned
/// in spec §5.1 is conceptual; the actual rows live alongside everything
/// else for transactional consistency with the harvester audit log).
pub struct Recall {
    project_path: PathBuf,
    vault: Vault,
    db: Arc<Database>,
}

impl Recall {
    /// Open (or initialize) the Recall handle for a project. Creates the
    /// `<project_root>/.recall/` directory if it doesn't exist; registers
    /// the vault in `recall_vaults` on first use. Does *not* perform any
    /// LLM calls or seeding — Phase 5 owns cold-start.
    pub fn for_project(project_path: &Path, db: Arc<Database>) -> Result<Self, RecallError> {
        let project_path = project_path.to_path_buf();
        let vault_path = project_path.join(".recall");
        let vault = Vault::open_or_create(&vault_path)?;
        index::ensure_vault_row(db.as_ref(), &project_path, &vault_path, false)?;
        Ok(Self {
            project_path,
            vault,
            db,
        })
    }

    pub fn project_path(&self) -> &Path {
        &self.project_path
    }

    pub fn vault(&self) -> &Vault {
        &self.vault
    }

    pub fn db(&self) -> &Database {
        self.db.as_ref()
    }
}

/// Error surface for Recall. Kept narrow on purpose: Phase 2+ pipelines map
/// LLM/IO/parse errors into one of these variants so the agent integration
/// layer has a single thing to match on.
#[derive(Debug, Error)]
pub enum RecallError {
    #[error("vault path is invalid or not accessible: {0}")]
    InvalidVaultPath(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("markdown parse error in {file}: {message}")]
    MarkdownParse { file: String, message: String },

    #[error("yaml frontmatter parse error: {0}")]
    YamlParse(String),

    #[error("database error: {0}")]
    Database(String),

    #[error("note not found: {0}")]
    NoteNotFound(String),

    #[error("config error: {0}")]
    Config(String),
}

impl From<rusqlite::Error> for RecallError {
    fn from(e: rusqlite::Error) -> Self {
        RecallError::Database(e.to_string())
    }
}

impl From<serde_yaml_ng::Error> for RecallError {
    fn from(e: serde_yaml_ng::Error) -> Self {
        RecallError::YamlParse(e.to_string())
    }
}
