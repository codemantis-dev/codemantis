//! §9.2.3 first bullet — spec markdown → `decision` note.
//!
//! On `save_spec_document` (new spec, or significant update),
//! distill the spec into one atomic decision note pointing back to
//! the full file on disk. The note's body summarizes the *Why* /
//! *Approach* sections; the implementation checklist stays in the
//! spec file because it's volatile. Wikilinks to any landmines that
//! overlap the spec's declared source paths.
//!
//! Why pull this synchronously into Recall: the spec IS the durable
//! decision. Without harvesting, the next SpecWriter run can't link
//! back to it, and the §9.2.9 #8 DoD criterion fails.

use std::collections::HashSet;
use std::path::Path;

use chrono::Utc;

use crate::recall::index::ensure_vault_row;
use crate::recall::index::ingest::ingest_note;
use crate::recall::index::query::notes_by_path_overlap;
use crate::recall::vault::{Note, NoteType, Status, Trust, Vault};
use crate::recall::RecallError;
use crate::storage::Database;

/// One harvest pass on a spec file. Idempotent on (project, spec
/// filename): subsequent saves with the same path overwrite the same
/// note rather than producing a new one.
pub fn harvest(
    db: &Database,
    project_path: &Path,
    spec_filename: &str,
    spec_body: &str,
) -> Result<HarvestOutcome, RecallError> {
    let vault_path = project_path.join(".recall");
    let vault = Vault::open_or_create(&vault_path)?;
    let vault_id = ensure_vault_row(db, project_path, &vault_path, false)?;

    let parsed = parse_spec(spec_filename, spec_body);
    if parsed.title.trim().is_empty() {
        return Ok(HarvestOutcome::Skipped {
            reason: "spec lacks a # heading".to_string(),
        });
    }

    // Find overlapping landmines so we can link them.
    let landmine_links = if parsed.source_paths.is_empty() {
        Vec::new()
    } else {
        let hits = notes_by_path_overlap(db, vault_id, &parsed.source_paths, 25)?;
        hits.into_iter()
            .filter(|n| n.note_type == "landmine")
            .map(|n| format!("[[{}]]", n.note_id))
            .collect()
    };

    let note_id = derive_note_id(spec_filename, &parsed.title);
    let now = Utc::now().date_naive();
    let body = render_body(&parsed, &landmine_links, spec_filename);

    let note = Note {
        id: note_id.clone(),
        note_type: NoteType::Decision,
        project: None,
        status: Status::Active,
        // Specs are user-authored durable decisions → high trust.
        // Fidelity check doesn't apply (this isn't an LLM hallucination
        // surface; the user is the authority).
        trust: Trust::High,
        trust_raw: String::new(),
        severity: None,
        discovered: now,
        last_verified: now,
        source_paths: parsed.source_paths.clone(),
        source_commits: vec![],
        prior_occurrences: vec![],
        links: landmine_links.clone(),
        tags: vec![
            "spec".to_string(),
            "seeded:specwriter".to_string(),
        ],
        title: parsed.title.clone(),
        body,
        file_path: None,
    };

    let written_path = vault.write_note(&note)?;
    let rel = written_path
        .strip_prefix(vault.root())
        .map(|p| p.to_path_buf())
        .unwrap_or(written_path);
    ingest_note(db, vault_id, &note, &rel)?;

    Ok(HarvestOutcome::Written {
        note_id,
        linked_landmines: landmine_links,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HarvestOutcome {
    Written {
        note_id: String,
        linked_landmines: Vec<String>,
    },
    Skipped {
        reason: String,
    },
}

#[derive(Debug, Clone, Default)]
struct ParsedSpec {
    title: String,
    /// Files mentioned in a "Files to modify" / "Section 4" / similar
    /// table or bullet list. Best-effort: we accept several common
    /// section headings.
    source_paths: Vec<String>,
    /// Free-text "why" extracted from a Why / Motivation / Background
    /// section; capped to ~500 chars in the note body.
    why_excerpt: Option<String>,
    /// Free-text approach summary from Approach / Design / Solution.
    approach_excerpt: Option<String>,
}

fn parse_spec(filename: &str, body: &str) -> ParsedSpec {
    let mut spec = ParsedSpec::default();
    // Title: first `# ` heading.
    for line in body.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            spec.title = rest.trim().to_string();
            break;
        }
    }
    if spec.title.is_empty() {
        spec.title = filename
            .trim_end_matches(".md")
            .replace(['-', '_'], " ");
    }

    // Section walker: look for canonical headings.
    let sections = walk_sections(body);
    for (heading, content) in &sections {
        let h = heading.to_ascii_lowercase();
        if spec.source_paths.is_empty()
            && (h.contains("files to modify")
                || h.contains("files to touch")
                || h.contains("scope")
                || h.starts_with("section 4")
                || h.starts_with("4."))
        {
            spec.source_paths = extract_paths_from_section(content);
        }
        if spec.why_excerpt.is_none()
            && (h.contains("why")
                || h.contains("motivation")
                || h.contains("background")
                || h.contains("problem")
                || h.starts_with("section 2"))
        {
            spec.why_excerpt = Some(truncate(content.trim(), 500));
        }
        if spec.approach_excerpt.is_none()
            && (h.contains("approach")
                || h.contains("design")
                || h.contains("solution")
                || h.contains("plan")
                || h.starts_with("section 3"))
        {
            spec.approach_excerpt = Some(truncate(content.trim(), 500));
        }
    }

    // Fallback path-detection: if no recognised section yielded paths,
    // sweep the whole body for path-shaped tokens (codey/with-slash).
    if spec.source_paths.is_empty() {
        spec.source_paths = sweep_paths(body);
    }

    spec
}

/// Walk markdown headings (`##`, `###`) and pair each with the text
/// up to the next heading at any level.
fn walk_sections(body: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut current_body = String::new();
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("## ")
            || trimmed.starts_with("### ")
            || trimmed.starts_with("#### ")
        {
            if let Some(h) = current_heading.take() {
                out.push((h, std::mem::take(&mut current_body)));
            }
            current_heading = Some(
                trimmed
                    .trim_start_matches('#')
                    .trim()
                    .to_string(),
            );
        } else if current_heading.is_some() {
            current_body.push_str(line);
            current_body.push('\n');
        }
    }
    if let Some(h) = current_heading {
        out.push((h, current_body));
    }
    out
}

/// Inside a "Files to modify"-style section, extract every path-shaped
/// token from list items. We look for:
/// - bullet list entries (`- `, `* `, `1. `) whose first token looks
///   path-shaped
/// - inline code spans (`` `path/here.rs` ``)
fn extract_paths_from_section(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    // 1) Backtick-quoted paths anywhere in the section.
    for (i, span) in content.split('`').enumerate() {
        if i % 2 == 1 && looks_like_path(span.trim()) {
            let p = span.trim().to_string();
            if seen.insert(p.clone()) {
                out.push(p);
            }
        }
    }
    // 2) Bullet/numbered list entries — first whitespace-delimited token.
    for line in content.lines() {
        let trimmed = line.trim_start();
        let after_marker = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| {
                trimmed
                    .split_once(". ")
                    .filter(|(prefix, _)| prefix.chars().all(|c| c.is_ascii_digit()))
                    .map(|(_, rest)| rest)
            });
        let Some(rest) = after_marker else {
            continue;
        };
        let first = rest
            .split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | ':' | '—' | '-'))
            .next()
            .unwrap_or("")
            .trim_matches(|c: char| matches!(c, '`' | '"' | '\'' | '(' | ')' | '[' | ']'));
        if looks_like_path(first) {
            let p = first.to_string();
            if seen.insert(p.clone()) {
                out.push(p);
            }
        }
    }
    out
}

/// Sweep the whole body for path tokens — used when no canonical
/// section was recognised. Same heuristic as
/// `enricher::entity_extraction::extract_paths` (path requires a
/// slash + known extension OR project-folder prefix).
fn sweep_paths(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for raw in body.split(|c: char| {
        c.is_whitespace() || matches!(c, ',' | ';' | '(' | ')' | '<' | '>' | '"' | '`')
    }) {
        let trimmed = raw.trim_matches(|c: char| matches!(c, '.' | ':' | '[' | ']' | '{' | '}'));
        if !looks_like_path(trimmed) {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
        }
    }
    out
}

const PATH_PREFIXES: &[&str] = &[
    "./", "../", "src/", "tests/", "docs/", "lib/", "app/", "pages/",
    "components/", "hooks/", "api/", "server/", "client/", "scripts/",
    "config/", "internal/", "pkg/", "cmd/", "src-tauri/", "supabase/",
    "migrations/",
];
const KNOWN_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "json", "toml", "yaml", "yml",
    "md", "py", "go", "java", "kt", "swift", "css", "scss", "html",
    "sh", "sql",
];

fn looks_like_path(s: &str) -> bool {
    if s.is_empty() || s.len() < 3 {
        return false;
    }
    if !s.contains('/') {
        return false;
    }
    if s.starts_with("http") || s.contains("://") {
        return false;
    }
    if s.starts_with('/') {
        return true;
    }
    for prefix in PATH_PREFIXES {
        if s.starts_with(prefix) {
            return true;
        }
    }
    if let Some(ext) = s.rsplit('.').next() {
        if KNOWN_EXTENSIONS.contains(&ext) {
            return true;
        }
    }
    false
}

fn render_body(parsed: &ParsedSpec, landmine_links: &[String], spec_filename: &str) -> String {
    let mut out = String::new();
    out.push_str("## Source\n\n");
    out.push_str(&format!(
        "Full spec on disk: `docs/specs/{}`. This note is a pointer; \
         the implementation checklist stays in the spec file because \
         it's volatile.\n\n",
        spec_filename
    ));
    if let Some(why) = &parsed.why_excerpt {
        out.push_str("## Why\n\n");
        out.push_str(why);
        out.push_str("\n\n");
    }
    if let Some(approach) = &parsed.approach_excerpt {
        out.push_str("## Approach\n\n");
        out.push_str(approach);
        out.push_str("\n\n");
    }
    if !landmine_links.is_empty() {
        out.push_str("## Related landmines\n\n");
        for link in landmine_links {
            out.push_str(&format!("- {}\n", link));
        }
        out.push('\n');
    }
    out
}

fn derive_note_id(filename: &str, title: &str) -> String {
    // Prefer filename-derived slug because the spec filename is
    // stable across saves; title may drift.
    let stem = filename
        .trim_end_matches(".md")
        .trim_end_matches(".markdown");
    if !stem.is_empty() {
        return slugify(stem);
    }
    slugify(title)
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

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::index::ingest::ingest_note;
    use crate::recall::index::test_helpers::*;
    use crate::recall::vault::{Note as VNote, NoteType as VType, Status as VStatus, Trust as VTrust};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn project_with_vault() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().unwrap();
        let project = tmp.path().to_path_buf();
        Vault::open_or_create(&project.join(".recall")).unwrap();
        (tmp, project)
    }

    const FIXTURE_SPEC: &str = "\
# Add the new credentials helper

## 1. Why

We need to support per-tenant key rotation. Existing helper assumes a
single global key, which breaks the multi-tenant rollout.

## 2. Approach

Introduce a TenantKey struct and route every credential helper call
through it. Migration runs over existing rows on app boot.

## 3. Files to modify

- `src/credentials.ts` — main helper
- `src/auth/tenant.ts` — new TenantKey introduction
- `supabase/migrations/20260601_tenant_keys.sql` — schema add

## 4. Tests

- unit tests in tests/credentials.test.ts
";

    #[test]
    fn harvest_creates_a_decision_note_from_fixture_spec() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        let outcome = harvest(&db, &project, "add-credentials-helper.md", FIXTURE_SPEC).unwrap();
        let note_id = match outcome {
            HarvestOutcome::Written { note_id, .. } => note_id,
            other => panic!("expected Written, got {:?}", other),
        };
        assert_eq!(note_id, "add-credentials-helper");

        let path = project
            .join(".recall/notes/decisions")
            .join(format!("{}.md", note_id));
        assert!(path.exists());
        let body = std::fs::read_to_string(path).unwrap();
        assert!(body.contains("type: decision"));
        assert!(body.contains("# Add the new credentials helper"));
        assert!(body.contains("src/credentials.ts"));
        assert!(body.contains("seeded:specwriter"));
        // Why + Approach sections present.
        assert!(body.contains("## Why"));
        assert!(body.contains("per-tenant key rotation"));
        assert!(body.contains("## Approach"));
        assert!(body.contains("TenantKey"));
    }

    #[test]
    fn harvest_links_overlapping_landmines() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
        let vault_id = ensure_vault_row(&db, &project, vault.root(), false).unwrap();
        // Seed a landmine on the credentials helper.
        let landmine = VNote {
            id: "credentials-landmine".to_string(),
            note_type: VType::Landmine,
            project: None,
            status: VStatus::Active,
            trust: VTrust::High,
            trust_raw: String::new(),
            severity: None,
            discovered: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            last_verified: NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            source_paths: vec!["src/credentials.ts".to_string()],
            source_commits: vec![],
            prior_occurrences: vec![],
            links: vec![],
            tags: vec![],
            title: "credentials landmine".to_string(),
            body: "watch out".to_string(),
            file_path: None,
        };
        vault.write_note(&landmine).unwrap();
        ingest_note(
            &db,
            vault_id,
            &landmine,
            Path::new("notes/landmines/credentials-landmine.md"),
        )
        .unwrap();

        let outcome = harvest(&db, &project, "add-credentials-helper.md", FIXTURE_SPEC).unwrap();
        match outcome {
            HarvestOutcome::Written { linked_landmines, .. } => {
                assert!(linked_landmines.iter().any(|l| l.contains("credentials-landmine")));
            }
            other => panic!("expected Written, got {:?}", other),
        }
        // And the link is in the note body on disk.
        let body = std::fs::read_to_string(
            project.join(".recall/notes/decisions/add-credentials-helper.md"),
        )
        .unwrap();
        assert!(body.contains("[[credentials-landmine]]"));
    }

    #[test]
    fn repeated_harvest_overwrites_same_note_file() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        harvest(&db, &project, "x.md", "# First title\n\n## 3. Files to modify\n- src/x.rs\n").unwrap();
        harvest(&db, &project, "x.md", "# Second title\n\n## 3. Files to modify\n- src/x.rs\n").unwrap();
        let body = std::fs::read_to_string(project.join(".recall/notes/decisions/x.md")).unwrap();
        assert!(body.contains("# Second title"), "second save should overwrite");
        assert!(!body.contains("# First title"));
        // Only one note exists.
        let count = std::fs::read_dir(project.join(".recall/notes/decisions"))
            .unwrap()
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn spec_with_no_heading_returns_skipped() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        // Empty filename so the title fallback is also empty.
        let outcome = harvest(&db, &project, ".md", "just body, no heading at all").unwrap();
        match outcome {
            HarvestOutcome::Skipped { reason } => {
                assert!(reason.contains("heading"));
            }
            other => panic!("expected Skipped, got {:?}", other),
        }
    }

    #[test]
    fn paths_are_extracted_from_bullet_list_with_inline_code() {
        let spec = "# T\n\n## Files\n\n- `src/a.rs` — main file\n- `tests/a.test.ts` — tests\n";
        let parsed = parse_spec("t.md", spec);
        assert!(parsed.source_paths.contains(&"src/a.rs".to_string()));
        assert!(parsed.source_paths.contains(&"tests/a.test.ts".to_string()));
    }

    #[test]
    fn paths_are_extracted_from_section_4_heading() {
        let spec = "# T\n\n## 4. Files to modify\n\n- src/x.rs\n- src/y.rs\n";
        let parsed = parse_spec("t.md", spec);
        assert_eq!(
            parsed.source_paths,
            vec!["src/x.rs".to_string(), "src/y.rs".to_string()]
        );
    }

    #[test]
    fn paths_fall_back_to_sweep_when_no_section_recognized() {
        let spec = "# T\n\nThe change touches src/a.rs and tests/b.test.ts in passing.\n";
        let parsed = parse_spec("t.md", spec);
        assert!(parsed.source_paths.contains(&"src/a.rs".to_string()));
        assert!(parsed.source_paths.contains(&"tests/b.test.ts".to_string()));
    }

    #[test]
    fn title_falls_back_to_filename_when_no_heading() {
        let parsed = parse_spec("add-payments-flow.md", "no heading here at all");
        assert_eq!(parsed.title, "add payments flow");
    }

    #[test]
    fn body_contains_pointer_back_to_full_spec_file() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        harvest(&db, &project, "spec-x.md", "# Spec X\n\n## 4. Files\n- src/x.rs\n").unwrap();
        let body = std::fs::read_to_string(project.join(".recall/notes/decisions/spec-x.md")).unwrap();
        assert!(body.contains("docs/specs/spec-x.md"));
    }

    #[test]
    fn harvest_with_no_overlapping_landmines_writes_note_without_links_section() {
        let db = fresh_db();
        let (_tmp, project) = project_with_vault();
        harvest(&db, &project, "x.md", "# T\n\n## 4. Files\n- src/unknown.rs\n").unwrap();
        let body = std::fs::read_to_string(project.join(".recall/notes/decisions/x.md")).unwrap();
        assert!(!body.contains("Related landmines"));
    }
}
