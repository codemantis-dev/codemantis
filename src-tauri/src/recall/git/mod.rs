//! Thin git plumbing for Recall.
//!
//! Phase 3 only needs `git show` (Harvester input). Phase 5 will add
//! `git log --name-only` for the cold-start hotspot seed. We don't
//! depend on libgit2 / git2-rs because: (a) the queries we run are
//! tiny and shell-out is reliable, and (b) keeping the codebase free
//! of a C dependency simplifies the macOS-only bundle.

pub mod show;

pub use show::{show_commit, ChangeKind, CommitInfo, FileChange};
