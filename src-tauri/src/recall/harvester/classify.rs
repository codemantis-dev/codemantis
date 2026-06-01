//! Step 2: classify a commit (RECALL-SPEC §7.2).
//!
//! Two-tier classifier:
//! 1. **Skip rules** (no LLM call): i18n-only, generated-files-only,
//!    lockfile-only, `[no-recall]`, pure formatting/lint, or no
//!    semantic delta.
//! 2. **Type inference** (no LLM call): commit-message prefix
//!    (`fix(`, `feat(`, `refactor(`, `docs:`, migration files
//!    present) → mapped note type.
//! 3. **LLM fallback** (Phase 3.1+, not implemented in Phase 3): when
//!    rules don't determine a type. For Phase 3 we default ambiguous
//!    commits to `decision` rather than calling an LLM, because the
//!    actual *generate* step already gets the full commit + diff and
//!    the type is metadata we can refine in dedupe.

use crate::recall::git::CommitInfo;
use crate::recall::vault::NoteType;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Classification {
    /// Skip this commit; harvester will not produce a note. Carries
    /// the reason for the audit log.
    Skip(SkipReason),
    /// Harvest as the given note type.
    Harvest(NoteType),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// Commit message contains `[no-recall]` (manual opt-out).
    NoRecallMarker,
    /// Every changed file is under an i18n / locales directory.
    I18nOnly,
    /// Every changed file is a known generated artifact (lockfiles,
    /// `*.gen.ts`, etc.).
    GeneratedOnly,
    /// No file changes at all (root commit with empty diff, or
    /// merge-commit with no conflict resolution noise).
    EmptyDiff,
    /// Commits whose every changed file is documentation
    /// (`docs/`, `*.md`, `*.mdx`) — useful changes but rarely
    /// surface a memory landmine. Phase 5's ADR ingestion picks up
    /// the docs side.
    DocsOnly,
}

impl SkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            SkipReason::NoRecallMarker => "no-recall-marker",
            SkipReason::I18nOnly => "i18n-only",
            SkipReason::GeneratedOnly => "generated-only",
            SkipReason::EmptyDiff => "empty-diff",
            SkipReason::DocsOnly => "docs-only",
        }
    }
}

pub fn classify(commit: &CommitInfo) -> Classification {
    // 1) Manual opt-out.
    if commit.has_no_recall_marker() {
        return Classification::Skip(SkipReason::NoRecallMarker);
    }
    // 2) Empty diff (root commit, merge with no conflicts).
    if commit.files.is_empty() {
        return Classification::Skip(SkipReason::EmptyDiff);
    }

    let paths: Vec<&str> = commit.files.iter().map(|f| f.path.as_str()).collect();

    if paths.iter().all(|p| is_generated(p)) {
        return Classification::Skip(SkipReason::GeneratedOnly);
    }
    if paths.iter().all(|p| is_i18n(p)) {
        return Classification::Skip(SkipReason::I18nOnly);
    }
    if paths.iter().all(|p| is_docs(p)) {
        return Classification::Skip(SkipReason::DocsOnly);
    }

    // 3) Type inference from message.
    Classification::Harvest(infer_type(&commit.subject, &paths))
}

fn infer_type(subject: &str, paths: &[&str]) -> NoteType {
    let s = subject.to_ascii_lowercase();
    // Database migrations always classify as decision regardless of prefix —
    // migration semantics deserve a durable note even on a fix commit.
    if paths.iter().any(|p| {
        p.contains("migrations/") || p.contains("/migrations/") || p.ends_with(".sql")
    }) {
        return NoteType::Decision;
    }
    if starts_with_prefix(&s, &["fix(", "fix:", "bug:", "bugfix:", "hotfix:", "revert:"]) {
        // Fix commits become landmine candidates; the harvester
        // dedupe step decides whether to mark `severity: recurring`.
        return NoteType::Landmine;
    }
    if starts_with_prefix(&s, &["refactor(", "refactor:"]) {
        return NoteType::Pattern;
    }
    if starts_with_prefix(&s, &["feat(", "feat:", "feature(", "feature:"]) {
        return NoteType::Decision;
    }
    // Default: treat as decision (the most general note type) so the
    // generate step has the broadest license to extract whatever the
    // diff actually shows.
    NoteType::Decision
}

fn starts_with_prefix(s: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|p| s.starts_with(p))
}

fn is_generated(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    const LOCKFILES: &[&str] = &[
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "cargo.lock",
        "poetry.lock",
        "gemfile.lock",
        "composer.lock",
        "go.sum",
        "bun.lockb",
    ];
    if let Some(name) = lower.split('/').next_back() {
        if LOCKFILES.contains(&name) {
            return true;
        }
    }
    // Common generated extensions / patterns.
    lower.contains(".gen.")
        || lower.contains(".generated.")
        || lower.ends_with(".min.js")
        || lower.ends_with(".min.css")
        || lower.starts_with("dist/")
        || lower.contains("/dist/")
        || lower.starts_with("build/")
        || lower.contains("/build/")
        || lower.starts_with("target/")
        || lower.contains("/target/")
}

fn is_i18n(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.contains("/i18n/")
        || lower.starts_with("i18n/")
        || lower.contains("/locales/")
        || lower.starts_with("locales/")
        || lower.contains("/translations/")
        || lower.starts_with("translations/")
}

fn is_docs(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if lower.starts_with("docs/") || lower.contains("/docs/") {
        return true;
    }
    lower.ends_with(".md") || lower.ends_with(".mdx") || lower.ends_with(".rst")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::git::{ChangeKind, FileChange};
    use chrono::TimeZone;

    fn ci(subject: &str, files: &[(&str, ChangeKind)]) -> CommitInfo {
        let files = files
            .iter()
            .map(|(p, k)| FileChange {
                path: p.to_string(),
                kind: *k,
                added_lines: vec!["x".to_string()],
                removed_lines: vec![],
                diff_text: format!("diff --git a/{p} b/{p}\n+ x\n", p = p),
            })
            .collect();
        CommitInfo {
            hash: "abc123".to_string(),
            author_name: "T".to_string(),
            author_email: "t@example.com".to_string(),
            timestamp: chrono::Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
            subject: subject.to_string(),
            full_message: subject.to_string(),
            files,
        }
    }

    #[test]
    fn no_recall_marker_skips() {
        let mut c = ci("chore: bump [no-recall]", &[("a.rs", ChangeKind::Modified)]);
        c.full_message = "chore: bump [no-recall]".to_string();
        c.subject = "chore: bump [no-recall]".to_string();
        assert_eq!(classify(&c), Classification::Skip(SkipReason::NoRecallMarker));
    }

    #[test]
    fn empty_diff_skips() {
        let c = ci("merge", &[]);
        assert_eq!(classify(&c), Classification::Skip(SkipReason::EmptyDiff));
    }

    #[test]
    fn locales_only_skips_as_i18n() {
        let c = ci(
            "feat: translations",
            &[
                ("src/locales/en.json", ChangeKind::Modified),
                ("src/locales/de.json", ChangeKind::Modified),
            ],
        );
        assert_eq!(classify(&c), Classification::Skip(SkipReason::I18nOnly));
    }

    #[test]
    fn lockfile_only_skips_as_generated() {
        let c = ci(
            "chore: update deps",
            &[("Cargo.lock", ChangeKind::Modified)],
        );
        assert_eq!(classify(&c), Classification::Skip(SkipReason::GeneratedOnly));
    }

    #[test]
    fn dist_directory_changes_skip_as_generated() {
        let c = ci("chore: rebuild", &[("dist/main.js", ChangeKind::Modified)]);
        assert_eq!(classify(&c), Classification::Skip(SkipReason::GeneratedOnly));
    }

    #[test]
    fn docs_only_skips_as_docs() {
        let c = ci(
            "docs: tidy README",
            &[("README.md", ChangeKind::Modified), ("docs/setup.md", ChangeKind::Modified)],
        );
        assert_eq!(classify(&c), Classification::Skip(SkipReason::DocsOnly));
    }

    #[test]
    fn fix_prefix_becomes_landmine() {
        let c = ci("fix(auth): handle empty session", &[("src/auth.rs", ChangeKind::Modified)]);
        assert_eq!(classify(&c), Classification::Harvest(NoteType::Landmine));
    }

    #[test]
    fn feat_prefix_becomes_decision() {
        let c = ci("feat(api): new endpoint", &[("src/api.rs", ChangeKind::Modified)]);
        assert_eq!(classify(&c), Classification::Harvest(NoteType::Decision));
    }

    #[test]
    fn refactor_prefix_becomes_pattern() {
        let c = ci("refactor(core): split module", &[("src/core.rs", ChangeKind::Modified)]);
        assert_eq!(classify(&c), Classification::Harvest(NoteType::Pattern));
    }

    #[test]
    fn migration_file_overrides_prefix_to_decision() {
        let c = ci(
            "fix: schema constraint",
            &[("supabase/migrations/20260601_x.sql", ChangeKind::Added)],
        );
        // Even though it's a fix(, migration semantics dominate.
        assert_eq!(classify(&c), Classification::Harvest(NoteType::Decision));
    }

    #[test]
    fn unknown_prefix_defaults_to_decision() {
        let c = ci("update something", &[("src/lib.rs", ChangeKind::Modified)]);
        assert_eq!(classify(&c), Classification::Harvest(NoteType::Decision));
    }

    #[test]
    fn mixed_locale_and_code_does_not_skip_as_i18n() {
        let c = ci(
            "feat: i18n + code",
            &[
                ("src/locales/en.json", ChangeKind::Modified),
                ("src/feature.rs", ChangeKind::Modified),
            ],
        );
        // i18n-only rule requires all paths to match.
        assert!(matches!(classify(&c), Classification::Harvest(_)));
    }

    #[test]
    fn no_recall_marker_takes_priority_over_other_rules() {
        let mut c = ci(
            "fix: hotfix [no-recall]",
            &[("src/x.rs", ChangeKind::Modified)],
        );
        c.full_message = "fix: hotfix [no-recall]".to_string();
        c.subject = "fix: hotfix [no-recall]".to_string();
        assert_eq!(classify(&c), Classification::Skip(SkipReason::NoRecallMarker));
    }

    #[test]
    fn generated_files_in_a_subpath_skip() {
        let c = ci(
            "chore: regen",
            &[("src/proto.gen.ts", ChangeKind::Modified)],
        );
        assert_eq!(classify(&c), Classification::Skip(SkipReason::GeneratedOnly));
    }

    #[test]
    fn build_directory_skips_as_generated() {
        let c = ci(
            "chore: build",
            &[("frontend/build/main.js", ChangeKind::Modified)],
        );
        assert_eq!(classify(&c), Classification::Skip(SkipReason::GeneratedOnly));
    }
}
