//! §10 step 1 — inventory the project for pre-existing knowledge
//! and import each as a seed note.
//!
//! Sources (in priority order; missing sources are silently skipped):
//! - `.claude/memory/*.md` — per-project memory the user (or an
//!   earlier Claude Code run) already wrote. Imported as `module`
//!   notes tagged `seeded:existing-memory`, trust **low** because
//!   most such files are structural / regeneratable.
//! - `docs/adr/*.md`, `docs/decisions/*.md`, `docs/*.adr.md` —
//!   architecture decision records. Imported as `decision` notes
//!   tagged `seeded:adr`, trust **medium**.
//! - `README.md` + `CLAUDE.md` — scanned for sections matching
//!   `## Rules`, `## Conventions`, `## Critical`, `## Gotchas`,
//!   `## Pitfalls`. Sections feed a starter `MANIFEST.md` (NOT
//!   ingested as a note here; manifest_starter.rs owns that).
//!
//! Returns counts so the orchestrator can include them in the seed
//! report.

use std::path::{Path, PathBuf};

use chrono::Utc;

use crate::recall::vault::{Note, NoteType, Status, Trust, Vault};
use crate::recall::RecallError;

#[derive(Debug, Clone, Default)]
pub struct IngestReport {
    /// Notes written via the `module` slug from `.claude/memory/`.
    pub memory_files_ingested: usize,
    /// Notes written via the `decision` slug from `docs/adr/`.
    pub adrs_ingested: usize,
    /// Concatenated sections pulled from README/CLAUDE — passed to
    /// `manifest_starter::generate` if the manifest LLM step is
    /// enabled.
    pub manifest_seed_sections: String,
}

/// Walk the project root and ingest every pre-existing knowledge
/// source we recognise. Idempotent: when a note with the same
/// derived slug already exists in the vault, the seed is skipped.
pub fn ingest(project_root: &Path, vault: &Vault) -> Result<IngestReport, RecallError> {
    let mut report = IngestReport::default();

    // 1) `.claude/memory/*.md`
    let memory_dir = project_root.join(".claude").join("memory");
    if memory_dir.is_dir() {
        for entry in std::fs::read_dir(&memory_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let stem = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let raw = match std::fs::read_to_string(&path) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if write_seed_note_if_absent(
                vault,
                &note_from_memory_file(&stem, &raw),
            )? {
                report.memory_files_ingested += 1;
            }
        }
    }

    // 2) ADRs in any of the conventional locations.
    let adr_candidates: [PathBuf; 2] = [
        project_root.join("docs").join("adr"),
        project_root.join("docs").join("decisions"),
    ];
    for adr_dir in &adr_candidates {
        if !adr_dir.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(adr_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let stem = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let raw = match std::fs::read_to_string(&path) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if write_seed_note_if_absent(vault, &note_from_adr_file(&stem, &raw))? {
                report.adrs_ingested += 1;
            }
        }
    }

    // 3) MANIFEST seed sections from README.md + CLAUDE.md.
    let mut combined_sections = String::new();
    for candidate in &["README.md", "CLAUDE.md"] {
        let path = project_root.join(candidate);
        if !path.is_file() {
            continue;
        }
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let extracted = extract_manifest_sections(&raw);
        if !extracted.is_empty() {
            combined_sections.push_str(&format!("--- from {} ---\n\n", candidate));
            combined_sections.push_str(&extracted);
            combined_sections.push_str("\n\n");
        }
    }
    report.manifest_seed_sections = combined_sections;

    Ok(report)
}

fn note_from_memory_file(stem: &str, body: &str) -> Note {
    let now = Utc::now().date_naive();
    let title = first_heading_or(body, stem);
    Note {
        id: slugify(stem),
        note_type: NoteType::Module,
        project: None,
        status: Status::Active,
        // Match the spec §10 trust call: "typically structural /
        // regeneratable" → low.
        trust: Trust::Low,
        trust_raw: "seeded:existing-memory".to_string(),
        severity: None,
        discovered: now,
        last_verified: now,
        source_paths: vec![],
        source_commits: vec![],
        prior_occurrences: vec![],
        links: vec![],
        tags: vec!["seeded:existing-memory".to_string(), "seed".to_string()],
        title,
        body: body_without_first_heading(body),
        file_path: None,
    }
}

fn note_from_adr_file(stem: &str, body: &str) -> Note {
    let now = Utc::now().date_naive();
    let title = first_heading_or(body, stem);
    Note {
        id: slugify(stem),
        note_type: NoteType::Decision,
        project: None,
        status: Status::Active,
        trust: Trust::Medium,
        trust_raw: "seeded:adr".to_string(),
        severity: None,
        discovered: now,
        last_verified: now,
        source_paths: vec![],
        source_commits: vec![],
        prior_occurrences: vec![],
        links: vec![],
        tags: vec!["seeded:adr".to_string(), "seed".to_string(), "adr".to_string()],
        title,
        body: body_without_first_heading(body),
        file_path: None,
    }
}

/// Write a seed note iff no note with the same id already exists in
/// the vault. Returns true if a write happened.
fn write_seed_note_if_absent(vault: &Vault, note: &Note) -> Result<bool, RecallError> {
    let rel = crate::recall::vault::note_relative_path(note)?;
    let abs = vault.resolve(&rel)?;
    if abs.exists() {
        return Ok(false);
    }
    vault.write_note(note)?;
    Ok(true)
}

fn first_heading_or(body: &str, fallback: &str) -> String {
    for line in body.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            return rest.trim().to_string();
        }
    }
    slug_to_title(fallback)
}

fn body_without_first_heading(body: &str) -> String {
    let mut lines = body.lines();
    let mut found_heading = false;
    let mut out = String::new();
    for line in &mut lines {
        if !found_heading && line.trim_start().starts_with("# ") {
            found_heading = true;
            continue;
        }
        if found_heading {
            out.push_str(line);
            out.push('\n');
        }
    }
    if !found_heading {
        return body.to_string();
    }
    out.trim_start_matches('\n').to_string()
}

const MANIFEST_HEADERS: &[&str] = &[
    "## rules",
    "## conventions",
    "## critical",
    "## gotchas",
    "## pitfalls",
    "## landmines",
    "## constraints",
    "## must",
    "## non-negotiable",
];

/// Pull sections whose `## heading` matches MANIFEST_HEADERS,
/// preserving heading + body up to the next `##` heading.
fn extract_manifest_sections(body: &str) -> String {
    let mut out = String::new();
    let mut emit = false;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("## ") {
            let lower = trimmed.to_ascii_lowercase();
            emit = MANIFEST_HEADERS.iter().any(|h| lower.starts_with(h));
            if emit {
                out.push_str(line);
                out.push('\n');
            }
            continue;
        }
        if emit {
            out.push_str(line);
            out.push('\n');
        }
    }
    out.trim_end().to_string()
}

fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for c in s.chars() {
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

fn slug_to_title(slug: &str) -> String {
    slug.replace(['-', '_'], " ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn project_with_vault() -> (TempDir, std::path::PathBuf, Vault) {
        let tmp = TempDir::new().unwrap();
        let project = tmp.path().to_path_buf();
        let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
        (tmp, project, vault)
    }

    #[test]
    fn no_existing_sources_returns_empty_report() {
        let (_tmp, project, vault) = project_with_vault();
        let report = ingest(&project, &vault).unwrap();
        assert_eq!(report.memory_files_ingested, 0);
        assert_eq!(report.adrs_ingested, 0);
        assert!(report.manifest_seed_sections.is_empty());
    }

    #[test]
    fn claude_memory_files_imported_as_low_trust_module_notes() {
        let (_tmp, project, vault) = project_with_vault();
        let mem_dir = project.join(".claude/memory");
        std::fs::create_dir_all(&mem_dir).unwrap();
        std::fs::write(
            mem_dir.join("auth-flow.md"),
            "# Auth flow\n\nUses cookie sessions.\n",
        )
        .unwrap();

        let report = ingest(&project, &vault).unwrap();
        assert_eq!(report.memory_files_ingested, 1);

        let note_path = project.join(".recall/notes/modules/auth-flow.md");
        assert!(note_path.exists());
        let body = std::fs::read_to_string(note_path).unwrap();
        assert!(body.contains("type: module"));
        assert!(body.contains("trust: seeded:existing-memory"));
        assert!(body.contains("# Auth flow"));
        assert!(body.contains("Uses cookie sessions"));
    }

    #[test]
    fn adr_files_imported_as_medium_trust_decision_notes() {
        let (_tmp, project, vault) = project_with_vault();
        let adr_dir = project.join("docs/adr");
        std::fs::create_dir_all(&adr_dir).unwrap();
        std::fs::write(
            adr_dir.join("001-pick-rust.md"),
            "# 001: Pick Rust\n\nWe chose Rust for the backend because…\n",
        )
        .unwrap();

        let report = ingest(&project, &vault).unwrap();
        assert_eq!(report.adrs_ingested, 1);

        let note_path = project.join(".recall/notes/decisions/001-pick-rust.md");
        assert!(note_path.exists());
        let body = std::fs::read_to_string(note_path).unwrap();
        assert!(body.contains("type: decision"));
        assert!(body.contains("trust: seeded:adr"));
        assert!(body.contains("# 001: Pick Rust"));
    }

    #[test]
    fn docs_decisions_directory_also_recognised_as_adrs() {
        let (_tmp, project, vault) = project_with_vault();
        let dir = project.join("docs/decisions");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("rfc-1.md"), "# RFC 1\n\nbody").unwrap();
        let report = ingest(&project, &vault).unwrap();
        assert_eq!(report.adrs_ingested, 1);
    }

    #[test]
    fn ingest_is_idempotent_skipping_existing_seeds() {
        let (_tmp, project, vault) = project_with_vault();
        let mem_dir = project.join(".claude/memory");
        std::fs::create_dir_all(&mem_dir).unwrap();
        std::fs::write(mem_dir.join("x.md"), "# X\nbody").unwrap();

        let first = ingest(&project, &vault).unwrap();
        assert_eq!(first.memory_files_ingested, 1);
        let second = ingest(&project, &vault).unwrap();
        assert_eq!(second.memory_files_ingested, 0, "re-run skips existing seeds");
    }

    #[test]
    fn readme_rules_section_pulled_into_manifest_seed() {
        let (_tmp, project, vault) = project_with_vault();
        std::fs::write(
            project.join("README.md"),
            "# Project\n\n## Rules\n\n- Be excellent\n\n## Setup\n\nrun foo\n",
        )
        .unwrap();
        let report = ingest(&project, &vault).unwrap();
        assert!(report.manifest_seed_sections.contains("## Rules"));
        assert!(report.manifest_seed_sections.contains("Be excellent"));
        assert!(
            !report.manifest_seed_sections.contains("## Setup"),
            "unrecognised sections should not bleed in"
        );
    }

    #[test]
    fn claude_md_gotchas_section_pulled_into_manifest_seed() {
        let (_tmp, project, vault) = project_with_vault();
        std::fs::write(
            project.join("CLAUDE.md"),
            "# CodeMantis\n\n## Gotchas\n\n- Mutex held across await",
        )
        .unwrap();
        let report = ingest(&project, &vault).unwrap();
        assert!(report.manifest_seed_sections.contains("Gotchas"));
        assert!(report.manifest_seed_sections.contains("Mutex held across await"));
    }

    #[test]
    fn multiple_recognised_sections_all_appear() {
        let (_tmp, project, vault) = project_with_vault();
        std::fs::write(
            project.join("README.md"),
            "## Rules\n- a\n\n## Conventions\n- b\n\n## Critical\n- c\n",
        )
        .unwrap();
        let report = ingest(&project, &vault).unwrap();
        assert!(report.manifest_seed_sections.contains("- a"));
        assert!(report.manifest_seed_sections.contains("- b"));
        assert!(report.manifest_seed_sections.contains("- c"));
    }

    #[test]
    fn title_falls_back_to_filename_when_no_heading() {
        let (_tmp, project, vault) = project_with_vault();
        let mem_dir = project.join(".claude/memory");
        std::fs::create_dir_all(&mem_dir).unwrap();
        std::fs::write(mem_dir.join("no-heading.md"), "just body\n").unwrap();
        ingest(&project, &vault).unwrap();
        let body = std::fs::read_to_string(project.join(".recall/notes/modules/no-heading.md"))
            .unwrap();
        // Title rendered as "# no heading" in the note's body section.
        assert!(body.contains("# no heading"));
    }

    #[test]
    fn non_md_files_in_memory_dir_are_ignored() {
        let (_tmp, project, vault) = project_with_vault();
        let mem_dir = project.join(".claude/memory");
        std::fs::create_dir_all(&mem_dir).unwrap();
        std::fs::write(mem_dir.join("config.json"), "{}").unwrap();
        std::fs::write(mem_dir.join("real.md"), "# real\nbody").unwrap();
        let report = ingest(&project, &vault).unwrap();
        assert_eq!(report.memory_files_ingested, 1);
    }
}
