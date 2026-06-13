//! §9.2.1 — assemble the Recall Context section appended to
//! `gather_spec_context` output.
//!
//! Composition:
//! - MANIFEST.md (always; small, global project context)
//! - All Recall notes whose `source_paths` overlap files SpecWriter
//!   detected as relevant (routes / top-changed / hotspot landmines).
//! - Transitive `[[meta:...]]` notes linked from those project notes
//!   (depth 1).
//! - Each note rendered as:
//!   `[NOTE-TYPE: title] (trust: X, source: <path>) <body summary>`
//!
//! Cap: 8000 chars by default (SpecWriter context allowed larger than
//! the dev-agent brief because spec generation is high-leverage).
//! When the cap is hit, drop order per spec: low-trust → meta →
//! patterns → decisions → landmines. Landmines are NEVER dropped.

use std::collections::HashSet;
use std::path::Path;

use crate::recall::index::query::{notes_by_path_overlap, IndexedNote};
use crate::recall::index::{ensure_vault_row, lookup_vault};
use crate::recall::vault::Vault;
use crate::recall::RecallError;
use crate::storage::Database;

const SECTION_HEADER: &str = "Recall Context";
pub const DEFAULT_CHAR_CAP: usize = 8_000;
const PER_NOTE_BODY_CAP: usize = 400;

/// Append the Recall Context section to `existing_context` and return
/// the combined string. When Recall has no notes (or is disabled), the
/// existing context is returned unchanged.
///
/// `detected_paths` is the set of files SpecWriter detected as
/// relevant (routes, hotspots, etc.) and is the seed for the
/// path-overlap query. `relevant_paths()` below is a helper SpecWriter
/// can use to derive a reasonable set when it has no direct list.
pub fn append_section(
    db: &Database,
    project_path: &Path,
    existing_context: &str,
    detected_paths: &[String],
) -> Result<String, RecallError> {
    let assembled = assemble(db, project_path, detected_paths, DEFAULT_CHAR_CAP)?;
    if assembled.is_empty() {
        return Ok(existing_context.to_string());
    }
    let mut out = String::with_capacity(existing_context.len() + assembled.len() + 16);
    out.push_str(existing_context);
    if !existing_context.ends_with("\n\n") {
        if existing_context.ends_with('\n') {
            out.push('\n');
        } else {
            out.push_str("\n\n");
        }
    }
    out.push_str(&assembled);
    Ok(out)
}

/// Build the Recall Context section as a standalone string. Returns
/// `""` when there's nothing to surface (no vault registered, no
/// matching notes, no manifest).
pub fn assemble(
    db: &Database,
    project_path: &Path,
    detected_paths: &[String],
    char_cap: usize,
) -> Result<String, RecallError> {
    let vault_path = project_path.join(".recall");
    if !vault_path.is_dir() {
        return Ok(String::new());
    }
    let vault = Vault::open_or_create(&vault_path)?;
    let vault_id = match lookup_vault(db, project_path, false)? {
        Some(id) => id,
        None => ensure_vault_row(db, project_path, &vault_path, false)?,
    };

    let manifest = std::fs::read_to_string(vault.root().join("MANIFEST.md")).ok();
    let mut overlapping = if detected_paths.is_empty() {
        Vec::new()
    } else {
        notes_by_path_overlap(db, vault_id, detected_paths, 50)?
    };

    // Pull transitive meta-links (depth 1).
    let meta_notes = if overlapping.is_empty() {
        Vec::new()
    } else {
        load_meta_links(db, &overlapping)?
    };

    // Compose the prioritized list (landmines first, then by trust
    // tier, then meta). Apply cap.
    let prioritized = prioritize(&mut overlapping, meta_notes);
    let rendered = render_with_cap(manifest.as_deref(), prioritized, &vault, char_cap);

    Ok(rendered)
}

#[derive(Debug, Clone)]
struct Entry {
    note: IndexedNote,
    /// True for `[[meta:...]]` notes pulled in via depth-1 link walk.
    /// They live in the meta-vault rather than the project vault.
    is_meta: bool,
}

impl Entry {
    fn drop_priority(&self) -> u8 {
        // Higher = kept longer under budget pressure.
        // Landmines never drop (handled via the never_drop filter in
        // render_with_cap), but they still get the highest value here
        // so the ordering inside the cap is deterministic.
        if self.note.note_type == "landmine" {
            return 5;
        }
        match self.note.trust.as_str() {
            "high" => 4,
            "medium" => 3,
            "inferred" => 2,
            "seeded" => 1,
            _ => 0, // low + unknown buckets drop first
        }
    }

    fn type_drop_priority(&self) -> u8 {
        // Secondary tier order from spec §9.2.2: meta drops before
        // pattern; pattern drops before decision; landmine never drops.
        if self.is_meta {
            return 1;
        }
        match self.note.note_type.as_str() {
            "pattern" => 2,
            "decision" => 3,
            "db-table" | "provider-handbook" | "module" => 3,
            "landmine" => 5,
            _ => 0,
        }
    }
}

fn prioritize(overlap: &mut Vec<IndexedNote>, meta: Vec<IndexedNote>) -> Vec<Entry> {
    let mut entries: Vec<Entry> = overlap
        .drain(..)
        .map(|note| Entry { note, is_meta: false })
        .collect();
    let mut seen: HashSet<i64> = entries.iter().map(|e| e.note.row_id).collect();
    for m in meta {
        if seen.insert(m.row_id) {
            entries.push(Entry { note: m, is_meta: true });
        }
    }
    // Sort: drop_priority desc, then type tier desc, then alpha title.
    entries.sort_by(|a, b| {
        b.drop_priority()
            .cmp(&a.drop_priority())
            .then_with(|| b.type_drop_priority().cmp(&a.type_drop_priority()))
            .then_with(|| a.note.title.cmp(&b.note.title))
    });
    entries
}

fn render_with_cap(
    manifest: Option<&str>,
    entries: Vec<Entry>,
    vault: &Vault,
    cap: usize,
) -> String {
    if manifest.is_none() && entries.is_empty() {
        return String::new();
    }
    // Always-include landmines so the cap-trim logic below skips them.
    let mut keep: Vec<Entry> = entries.clone();
    let mut rendered = render(manifest, &keep, vault);
    // Drop from the tail (lowest priority) until under the cap.
    while rendered.len() > cap && !keep.is_empty() {
        let last_drop_idx = match find_drop_candidate(&keep) {
            Some(i) => i,
            None => break,
        };
        keep.remove(last_drop_idx);
        rendered = render(manifest, &keep, vault);
    }
    rendered
}

fn find_drop_candidate(entries: &[Entry]) -> Option<usize> {
    // Walk from the end (lowest combined priority sort key); skip
    // landmines.
    let mut idx: Option<usize> = None;
    let mut idx_priority: u8 = u8::MAX;
    for (i, e) in entries.iter().enumerate() {
        if e.note.note_type == "landmine" {
            continue;
        }
        let p = e.drop_priority().saturating_add(e.type_drop_priority());
        if idx.is_none() || p < idx_priority {
            idx = Some(i);
            idx_priority = p;
        }
    }
    idx
}

fn render(manifest: Option<&str>, entries: &[Entry], vault: &Vault) -> String {
    let mut out = String::new();
    out.push_str("## ");
    out.push_str(SECTION_HEADER);
    out.push_str(" (from Recall)\n\n");

    if let Some(m) = manifest {
        out.push_str("### MANIFEST.md\n\n");
        out.push_str(m.trim_end());
        out.push_str("\n\n");
    }

    if entries.is_empty() {
        return out;
    }

    for entry in entries {
        let body_summary = body_excerpt(vault, &entry.note);
        let meta_marker = if entry.is_meta { " (meta-vault)" } else { "" };
        out.push_str(&format!(
            "- [{}: {}] (trust: {}, source: {}{})\n  {}\n",
            entry.note.note_type,
            entry.note.title,
            entry.note.trust,
            entry.note.file_path,
            meta_marker,
            body_summary
        ));
    }
    out
}

fn body_excerpt(vault: &Vault, note: &IndexedNote) -> String {
    let rel = Path::new(&note.file_path).to_path_buf();
    let outcome = match vault.read_note(&rel) {
        Ok(o) => o,
        Err(_) => return note.title.clone(),
    };
    let body = outcome.note.body;
    let trimmed = body.trim();
    if trimmed.chars().count() <= PER_NOTE_BODY_CAP {
        trimmed.replace('\n', " ")
    } else {
        let truncated: String = trimmed.chars().take(PER_NOTE_BODY_CAP).collect();
        format!("{}…", truncated.replace('\n', " "))
    }
}

/// Best-effort meta-link walker. For each candidate, look at its
/// `recall_note_links` rows where `is_meta = 1`; resolve to a node
/// in the meta-vault if cross-project linking is enabled. Phase 4
/// returns an empty Vec when no meta-vault is configured — the
/// cross-vault path resolution lands with the meta-vault UI in
/// Phase 5.
fn load_meta_links(
    db: &Database,
    candidates: &[IndexedNote],
) -> Result<Vec<IndexedNote>, RecallError> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    // Pull the dst_text labels from recall_note_links where is_meta=1
    // for the candidate source notes. These point at the meta-vault.
    let src_ids: Vec<i64> = candidates.iter().map(|c| c.row_id).collect();
    let placeholders: Vec<String> = (0..src_ids.len()).map(|i| format!("?{}", i + 1)).collect();
    let sql = format!(
        "SELECT DISTINCT dst_text FROM recall_note_links
          WHERE is_meta = 1 AND src_note_id IN ({})",
        placeholders.join(", ")
    );
    let labels: Vec<String> = {
        let guard = db.conn().lock().unwrap();
        let mut stmt = guard.prepare(&sql)?;
        let params: Vec<rusqlite::types::Value> = src_ids
            .iter()
            .map(|id| rusqlite::types::Value::from(*id))
            .collect();
        let collected: Vec<String> = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                r.get::<_, String>(0)
            })?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };

    // For Phase 4, look up each label as a note id in the meta-vault
    // (is_meta = 1) without restricting to a single project: a
    // user's meta-vault is registered as a separate `recall_vaults`
    // row with `is_meta = 1`. The first such vault we see is "the
    // meta-vault". Phase 5 makes this configurable per-project.
    let meta_vault_id: Option<i64> = {
        let guard = db.conn().lock().unwrap();
        guard
            .query_row(
                "SELECT id FROM recall_vaults WHERE is_meta = 1 LIMIT 1",
                [],
                |r| r.get::<_, i64>(0),
            )
            .ok()
    };
    let Some(meta_vault_id) = meta_vault_id else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for raw in labels {
        let target = raw
            .trim_start_matches("[[")
            .trim_end_matches("]]")
            .strip_prefix("meta:")
            .unwrap_or(&raw)
            .trim()
            .to_string();
        if target.is_empty() {
            continue;
        }
        let guard = db.conn().lock().unwrap();
        let row = guard
            .query_row(
                "SELECT id, vault_id, note_id, type, title, status, trust, severity, last_verified_at, file_path
                   FROM recall_notes WHERE vault_id = ?1 AND note_id = ?2",
                rusqlite::params![meta_vault_id, target],
                |r| {
                    Ok(IndexedNote {
                        row_id: r.get(0)?,
                        vault_id: r.get(1)?,
                        note_id: r.get(2)?,
                        note_type: r.get(3)?,
                        title: r.get(4)?,
                        status: r.get(5)?,
                        trust: r.get(6)?,
                        severity: r.get(7)?,
                        last_verified: r.get(8)?,
                        file_path: r.get(9)?,
                    })
                },
            )
            .ok();
        if let Some(n) = row {
            out.push(n);
        }
    }
    Ok(out)
}

/// SpecWriter helper: turn a list of "interesting files" (routes,
/// hotspot files, top-changed) into a path set suitable for the
/// path-overlap query. Currently a passthrough; lives here so the
/// SpecWriter side has a stable seam if we tighten heuristics later
/// (e.g. dedupe with a tree-aware overlap check).
pub fn relevant_paths(detected: &[String]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::with_capacity(detected.len());
    for p in detected {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::index::ingest::ingest_note;
    use crate::recall::index::test_helpers::*;
    use crate::recall::vault::{Note, NoteType, Status, Trust, Vault};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn make_note(id: &str, ty: NoteType, title: &str, paths: &[&str], body: &str) -> Note {
        Note {
            id: id.to_string(),
            note_type: ty,
            project: Some("p".into()),
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

    /// Build a project tempdir with a .recall vault inside; register
    /// it in `recall_vaults`. Returns `(tempdir, project_path,
    /// vault_id)`.
    fn fixture(db: &crate::storage::Database) -> (TempDir, std::path::PathBuf, i64) {
        let tmp = TempDir::new().unwrap();
        let project = tmp.path().to_path_buf();
        let vault = Vault::open_or_create(&project.join(".recall")).unwrap();
        let vault_id = ensure_vault_row(db, &project, vault.root(), false).unwrap();
        let _ = vault;
        (tmp, project, vault_id)
    }

    fn vault_of(project: &Path) -> Vault {
        Vault::open_or_create(&project.join(".recall")).unwrap()
    }

    #[test]
    fn empty_vault_appends_nothing() {
        let db = fresh_db();
        let (_tmp, project, _vid) = fixture(&db);
        let existing = "Project: foo\nFramework: Rust";
        let result = append_section(&db, &project, existing, &[]).unwrap();
        assert_eq!(result, existing);
    }

    #[test]
    fn missing_recall_dir_is_passthrough() {
        let db = fresh_db();
        let tmp = TempDir::new().unwrap();
        let project = tmp.path().to_path_buf();
        let existing = "Project: foo";
        let result = append_section(&db, &project, existing, &["src/x.rs".into()]).unwrap();
        assert_eq!(result, existing);
    }

    #[test]
    fn overlapping_notes_appear_in_section() {
        let db = fresh_db();
        let (_tmp, project, vault_id) = fixture(&db);
        let vault = vault_of(&project);
        let n = make_note(
            "pgcrypto-landmine",
            NoteType::Landmine,
            "pgcrypto search path",
            &["src/credentials.ts"],
            "Always schema-qualify pgcrypto calls in SECURITY DEFINER functions.",
        );
        vault.write_note(&n).unwrap();
        ingest_note(&db, vault_id, &n, Path::new("notes/landmines/pgcrypto-landmine.md")).unwrap();

        let result = append_section(
            &db,
            &project,
            "Project: x",
            &["src/credentials.ts".to_string()],
        )
        .unwrap();
        assert!(result.contains("Recall Context"));
        assert!(result.contains("pgcrypto search path"));
        assert!(result.contains("Always schema-qualify"));
        assert!(result.contains("trust: high"));
    }

    #[test]
    fn manifest_md_is_surfaced_when_present() {
        let db = fresh_db();
        let (_tmp, project, _vid) = fixture(&db);
        std::fs::write(
            project.join(".recall/MANIFEST.md"),
            "# Project manifest\n\nBe excellent.\n",
        )
        .unwrap();
        let result = append_section(&db, &project, "Project: x", &[]).unwrap();
        assert!(result.contains("MANIFEST.md"));
        assert!(result.contains("Be excellent"));
    }

    #[test]
    fn landmines_survive_section_cap() {
        let db = fresh_db();
        let (_tmp, project, vault_id) = fixture(&db);
        let vault = vault_of(&project);
        // One critical landmine plus several patterns. Cap is small.
        let lm = make_note(
            "land",
            NoteType::Landmine,
            "critical",
            &["src/x.rs"],
            &"X".repeat(200),
        );
        vault.write_note(&lm).unwrap();
        ingest_note(&db, vault_id, &lm, Path::new("notes/landmines/land.md")).unwrap();
        for i in 0..5 {
            let id = format!("p{}", i);
            let p = make_note(
                &id,
                NoteType::Pattern,
                &format!("pattern {}", i),
                &["src/x.rs"],
                &"P".repeat(200),
            );
            vault.write_note(&p).unwrap();
            ingest_note(&db, vault_id, &p, &Path::new("notes/patterns").join(format!("{}.md", id))).unwrap();
        }

        // Cap forces all patterns out. Landmine still present.
        let assembled = assemble(&db, &project, &["src/x.rs".to_string()], 600).unwrap();
        assert!(assembled.contains("critical"), "landmine must survive cap");
        let pattern_count = (0..5).filter(|i| assembled.contains(&format!("pattern {}", i))).count();
        assert!(
            pattern_count < 5,
            "patterns should be culled under cap, kept {}/5",
            pattern_count
        );
    }

    #[test]
    fn landmines_appear_before_patterns_in_output() {
        let db = fresh_db();
        let (_tmp, project, vault_id) = fixture(&db);
        let vault = vault_of(&project);
        let lm = make_note("lm", NoteType::Landmine, "ZZ landmine", &["src/x.rs"], "body");
        let pat = make_note("pat", NoteType::Pattern, "AA pattern", &["src/x.rs"], "body");
        vault.write_note(&lm).unwrap();
        vault.write_note(&pat).unwrap();
        ingest_note(&db, vault_id, &lm, Path::new("notes/landmines/lm.md")).unwrap();
        ingest_note(&db, vault_id, &pat, Path::new("notes/patterns/pat.md")).unwrap();

        let assembled = assemble(&db, &project, &["src/x.rs".to_string()], 10_000).unwrap();
        let lm_pos = assembled.find("ZZ landmine").unwrap();
        let pat_pos = assembled.find("AA pattern").unwrap();
        assert!(
            lm_pos < pat_pos,
            "landmine should appear before pattern despite alphabetical order"
        );
    }

    #[test]
    fn empty_detected_paths_with_manifest_still_renders_manifest() {
        let db = fresh_db();
        let (_tmp, project, _vid) = fixture(&db);
        std::fs::write(project.join(".recall/MANIFEST.md"), "manifest body").unwrap();
        let assembled = assemble(&db, &project, &[], 8000).unwrap();
        assert!(assembled.contains("manifest body"));
    }

    #[test]
    fn relevant_paths_dedupes_and_drops_empties() {
        let input = vec![
            "src/x.rs".to_string(),
            "src/x.rs".to_string(),
            "  ".to_string(),
            "src/y.rs".to_string(),
            "".to_string(),
        ];
        let out = relevant_paths(&input);
        assert_eq!(out, vec!["src/x.rs".to_string(), "src/y.rs".to_string()]);
    }

    #[test]
    fn append_section_inserts_blank_line_between_existing_and_section() {
        let db = fresh_db();
        let (_tmp, project, vault_id) = fixture(&db);
        let vault = vault_of(&project);
        let n = make_note("n1", NoteType::Landmine, "x", &["src/x.rs"], "body");
        vault.write_note(&n).unwrap();
        ingest_note(&db, vault_id, &n, Path::new("notes/landmines/n1.md")).unwrap();

        let existing = "Project: foo"; // no trailing newline
        let result = append_section(&db, &project, existing, &["src/x.rs".to_string()]).unwrap();
        // Expect "Project: foo\n\n## Recall Context …"
        assert!(result.contains("Project: foo\n\n## Recall Context"));
    }
}
