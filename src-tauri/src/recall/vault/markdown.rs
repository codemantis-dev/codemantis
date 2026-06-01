//! Note parse + serialize: YAML frontmatter ⇄ struct, markdown body
//! handled separately. The contract per spec §5.4: notes that don't parse
//! cleanly are still readable by humans, get `trust: low`, and surface in
//! a "needs review" list — never silently discarded.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::{Note, NoteType, PriorOccurrence, Status, Trust};
use crate::recall::RecallError;

const FRONTMATTER_DELIM: &str = "---";

/// Raw frontmatter — every field is optional so we can degrade gracefully
/// on malformed input rather than refusing to load a human-curated note.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct FrontmatterRaw {
    id: Option<String>,
    #[serde(rename = "type")]
    note_type: Option<String>,
    project: Option<String>,
    status: Option<String>,
    trust: Option<String>,
    severity: Option<String>,
    discovered: Option<String>,
    last_verified: Option<String>,
    source_paths: Option<Vec<String>>,
    source_commits: Option<Vec<String>>,
    prior_occurrences: Option<Vec<PriorOccurrence>>,
    links: Option<Vec<String>>,
    tags: Option<Vec<String>>,
}

/// Outcome of a parse. `partial` is `true` when we recovered from a defect
/// (missing required field, bad date, unknown enum) and downgraded the
/// note's trust. Callers should surface this as "needs review".
pub struct ParseOutcome {
    pub note: Note,
    pub partial: bool,
    pub warnings: Vec<String>,
}

/// Parse a markdown file body. The `id` argument supplies a fallback note
/// id when the frontmatter omits it (we derive from filename).
pub fn parse_note(raw: &str, fallback_id: &str) -> Result<ParseOutcome, RecallError> {
    let (frontmatter_str, body_full) = split_frontmatter(raw);

    let mut warnings = Vec::new();
    let mut partial = false;

    let fm: FrontmatterRaw = if let Some(yaml) = frontmatter_str {
        match serde_yaml_ng::from_str::<FrontmatterRaw>(yaml) {
            Ok(parsed) => parsed,
            Err(e) => {
                partial = true;
                warnings.push(format!("frontmatter yaml: {}", e));
                FrontmatterRaw::default()
            }
        }
    } else {
        partial = true;
        warnings.push("missing frontmatter".to_string());
        FrontmatterRaw::default()
    };

    let (title, body) = split_title(body_full);

    let id = match fm.id.as_ref() {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            partial = true;
            warnings.push("frontmatter `id` missing — using fallback".to_string());
            fallback_id.to_string()
        }
    };

    let note_type = match fm.note_type.as_deref() {
        Some("landmine") => NoteType::Landmine,
        Some("pattern") => NoteType::Pattern,
        Some("decision") => NoteType::Decision,
        Some("db-table") => NoteType::DbTable,
        Some("provider-handbook") => NoteType::ProviderHandbook,
        Some("module") => NoteType::Module,
        other => {
            partial = true;
            warnings.push(format!(
                "frontmatter `type` invalid ({:?}) — defaulting to module",
                other
            ));
            NoteType::Module
        }
    };

    let status = match fm.status.as_deref() {
        Some("active") | None => Status::Active,
        Some("superseded") => Status::Superseded,
        Some("archived") => Status::Archived,
        Some(other) => {
            partial = true;
            warnings.push(format!(
                "frontmatter `status` invalid ({:?}) — defaulting to active",
                other
            ));
            Status::Active
        }
    };

    let trust_raw = match fm.trust.clone() {
        Some(s) => s,
        None => {
            partial = true;
            warnings.push("frontmatter `trust` missing — defaulting to low".to_string());
            "low".to_string()
        }
    };
    let parsed_trust = match Trust::parse(&trust_raw) {
        Some(t) => t,
        None => {
            partial = true;
            warnings.push(format!(
                "frontmatter `trust` unrecognized ({:?}) — downgrading to low",
                trust_raw
            ));
            Trust::Low
        }
    };
    // §5.4: defective notes still load but trust is pinned to Low so the
    // brief assembler routes them to "needs review" automatically.
    let trust = if partial { Trust::Low } else { parsed_trust };

    let discovered = match fm.discovered.as_deref() {
        Some(s) => match parse_date(s) {
            Some(d) => d,
            None => {
                partial = true;
                warnings.push(format!("frontmatter `discovered` invalid ({:?})", s));
                chrono::Utc::now().date_naive()
            }
        },
        None => {
            partial = true;
            warnings.push("frontmatter `discovered` missing".to_string());
            chrono::Utc::now().date_naive()
        }
    };

    let last_verified = match fm.last_verified.as_deref() {
        Some(s) => parse_date(s).unwrap_or(discovered),
        None => discovered,
    };

    let note = Note {
        id,
        note_type,
        project: fm.project,
        status,
        trust,
        trust_raw: if trust_raw.contains(':') { trust_raw } else { String::new() },
        severity: fm.severity,
        discovered,
        last_verified,
        source_paths: fm.source_paths.unwrap_or_default(),
        source_commits: fm.source_commits.unwrap_or_default(),
        prior_occurrences: fm.prior_occurrences.unwrap_or_default(),
        links: fm.links.unwrap_or_default(),
        tags: fm.tags.unwrap_or_default(),
        title: title.to_string(),
        body: body.to_string(),
        file_path: None,
    };

    Ok(ParseOutcome {
        note,
        partial,
        warnings,
    })
}

/// Serialize a Note back to markdown. Frontmatter is rendered explicitly
/// (not via serde_yaml_ng's full serializer) so the key order is stable
/// and matches the spec §5.3 example — important for human-curated diffs
/// in the vault.
pub fn serialize_note(note: &Note) -> String {
    let mut out = String::new();
    out.push_str(FRONTMATTER_DELIM);
    out.push('\n');
    out.push_str(&format!("id: {}\n", note.id));
    out.push_str(&format!("type: {}\n", note.note_type.as_str()));
    out.push_str(&format!(
        "project: {}\n",
        note.project.as_deref().unwrap_or("null")
    ));
    out.push_str(&format!("status: {}\n", note.status.as_str()));
    let trust_value = if !note.trust_raw.is_empty() {
        note.trust_raw.clone()
    } else {
        note.trust.as_str().to_string()
    };
    out.push_str(&format!("trust: {}\n", trust_value));
    if let Some(sev) = &note.severity {
        out.push_str(&format!("severity: {}\n", sev));
    }
    out.push_str(&format!("discovered: {}\n", note.discovered));
    out.push_str(&format!("last_verified: {}\n", note.last_verified));
    render_string_list(&mut out, "source_paths", &note.source_paths);
    render_string_list(&mut out, "source_commits", &note.source_commits);
    render_prior_occurrences(&mut out, &note.prior_occurrences);
    render_string_list(&mut out, "links", &note.links);
    render_inline_list(&mut out, "tags", &note.tags);
    out.push_str(FRONTMATTER_DELIM);
    out.push_str("\n\n");
    out.push_str("# ");
    out.push_str(&note.title);
    out.push('\n');
    if !note.body.is_empty() {
        if !note.body.starts_with('\n') {
            out.push('\n');
        }
        out.push_str(&note.body);
        if !note.body.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

fn render_string_list(out: &mut String, key: &str, items: &[String]) {
    if items.is_empty() {
        out.push_str(&format!("{}: []\n", key));
        return;
    }
    out.push_str(key);
    out.push_str(":\n");
    for item in items {
        // Quote conservatively: YAML strings containing : or # or starting
        // with `[` need quoting to parse unambiguously.
        if needs_quoting(item) {
            out.push_str(&format!("  - {:?}\n", item));
        } else {
            out.push_str(&format!("  - {}\n", item));
        }
    }
}

fn render_inline_list(out: &mut String, key: &str, items: &[String]) {
    if items.is_empty() {
        out.push_str(&format!("{}: []\n", key));
        return;
    }
    out.push_str(key);
    out.push_str(": [");
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        if needs_quoting(item) {
            out.push_str(&format!("{:?}", item));
        } else {
            out.push_str(item);
        }
    }
    out.push_str("]\n");
}

fn render_prior_occurrences(out: &mut String, items: &[PriorOccurrence]) {
    if items.is_empty() {
        out.push_str("prior_occurrences: []\n");
        return;
    }
    out.push_str("prior_occurrences:\n");
    for it in items {
        out.push_str(&format!(
            "  - {{commit: {}, date: {}, location: {}}}\n",
            it.commit_hash, it.date, it.location
        ));
    }
}

fn needs_quoting(s: &str) -> bool {
    s.is_empty()
        || s.starts_with('[')
        || s.starts_with('{')
        || s.starts_with('!')
        || s.starts_with('&')
        || s.starts_with('*')
        || s.starts_with('>')
        || s.starts_with('|')
        || s.starts_with('@')
        || s.starts_with('`')
        || s.contains(": ")
        || s.contains(" #")
        || s.contains('\n')
        || s.contains('"')
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()
}

/// Split `---\n…\n---\n<body>` into `(Some(yaml), body)`. If the file
/// does not begin with `---`, returns `(None, body)` — caller treats
/// missing frontmatter as a parse defect and downgrades trust.
fn split_frontmatter(raw: &str) -> (Option<&str>, &str) {
    let trimmed = raw.trim_start_matches('\u{feff}');
    let after_open = match trimmed.strip_prefix(FRONTMATTER_DELIM) {
        Some(rest) => rest.strip_prefix('\n').unwrap_or(rest),
        None => return (None, trimmed),
    };
    // Walk lines once, tracking byte offset so we can slice cleanly.
    let mut offset = 0usize;
    for line in after_open.split_inclusive('\n') {
        let body_start = line.trim_end_matches(['\n', '\r']);
        if body_start == FRONTMATTER_DELIM {
            let yaml = &after_open[..offset];
            let body = &after_open[offset + line.len()..];
            return (Some(yaml), body.trim_start_matches(['\n', '\r']));
        }
        offset += line.len();
    }
    (None, trimmed)
}

/// Pull the first `# heading` off the body. Returns
/// `(title, body_without_title)`. If no heading is present, returns
/// `("", body)` and the title is filled in by the caller.
fn split_title(body: &str) -> (&str, &str) {
    let mut offset = 0usize;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let bare = trimmed.trim_end_matches(['\n', '\r']);
        if let Some(rest) = bare.strip_prefix("# ") {
            let title = rest.trim();
            let after = &body[offset + line.len()..];
            // Drop a single trailing blank line so round-trips are stable.
            let after = after.strip_prefix('\n').unwrap_or(after);
            return (title, after);
        }
        if !bare.is_empty() {
            // Non-blank, non-heading line — no title.
            break;
        }
        offset += line.len();
    }
    ("", body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_note() -> Note {
        Note {
            id: "landmine-pgcrypto-search-path".to_string(),
            note_type: NoteType::Landmine,
            project: Some("chatbotplus".to_string()),
            status: Status::Active,
            trust: Trust::High,
            trust_raw: String::new(),
            severity: Some("recurring".to_string()),
            discovered: NaiveDate::from_ymd_opt(2026, 5, 28).unwrap(),
            last_verified: NaiveDate::from_ymd_opt(2026, 5, 28).unwrap(),
            source_paths: vec![
                "supabase/functions/_shared/credentials.ts".to_string(),
                "supabase/migrations/20260528130000_x.sql".to_string(),
            ],
            source_commits: vec!["9fc64f9".to_string(), "a34323e".to_string()],
            prior_occurrences: vec![
                PriorOccurrence {
                    commit_hash: "502111855".to_string(),
                    date: NaiveDate::from_ymd_opt(2026, 4, 2).unwrap(),
                    location: "decrypt_credential".to_string(),
                },
                PriorOccurrence {
                    commit_hash: "527095000".to_string(),
                    date: NaiveDate::from_ymd_opt(2026, 5, 27).unwrap(),
                    location: "encrypt_credential".to_string(),
                },
            ],
            links: vec![
                "[[meta:cross-provider-error-shape]]".to_string(),
                "[[edge-fn-execute-pipeline]]".to_string(),
            ],
            tags: vec!["security".to_string(), "db".to_string(), "pgcrypto".to_string()],
            title: "pgcrypto calls fail under tightened search_path".to_string(),
            body: "Body text here.\n\n## Fix\nQualify it.\n".to_string(),
            file_path: None,
        }
    }

    #[test]
    fn serialize_then_parse_is_identity() {
        let original = fixture_note();
        let serialized = serialize_note(&original);
        let outcome = parse_note(&serialized, "fallback-id").unwrap();
        assert!(!outcome.partial, "expected clean parse, got warnings: {:?}", outcome.warnings);
        let mut parsed = outcome.note;
        // file_path is populated by the filesystem layer, not the parser.
        parsed.file_path = None;
        assert_eq!(parsed, original);
    }

    #[test]
    fn missing_optional_fields_default_to_sensible_values() {
        let raw = "---\nid: stub\ntype: module\ndiscovered: 2026-01-01\n---\n\n# Stub\nBody.\n";
        let outcome = parse_note(raw, "stub").unwrap();
        assert!(outcome.partial, "missing trust should mark partial");
        assert_eq!(outcome.note.id, "stub");
        assert_eq!(outcome.note.note_type, NoteType::Module);
        // Trust pinned to Low when partial-flag set (spec §5.4).
        assert_eq!(outcome.note.trust, Trust::Low);
        assert!(outcome.note.source_paths.is_empty());
        assert!(outcome.note.prior_occurrences.is_empty());
        assert_eq!(outcome.note.title, "Stub");
    }

    #[test]
    fn malformed_yaml_still_loads_with_low_trust() {
        let raw = "---\nthis: : is : broken : yaml\n---\n# Title\nbody";
        let outcome = parse_note(raw, "broken-id").unwrap();
        assert!(outcome.partial);
        assert_eq!(outcome.note.trust, Trust::Low);
        assert_eq!(outcome.note.id, "broken-id"); // fallback applied
        assert_eq!(outcome.note.title, "Title");
        assert!(!outcome.warnings.is_empty());
    }

    #[test]
    fn missing_frontmatter_entirely_marks_partial() {
        let raw = "# Plain Title\n\nJust body, no frontmatter.";
        let outcome = parse_note(raw, "fallback").unwrap();
        assert!(outcome.partial);
        assert_eq!(outcome.note.title, "Plain Title");
        assert_eq!(outcome.note.id, "fallback");
        assert_eq!(outcome.note.trust, Trust::Low);
    }

    #[test]
    fn utf8_and_emoji_preserved() {
        let mut note = fixture_note();
        note.title = "Café — 🛡️ pgcrypto landmine".to_string();
        note.body = "Mañana, the WAF dropped — see § 4.2 (✅ fixed).\n".to_string();
        let serialized = serialize_note(&note);
        let outcome = parse_note(&serialized, "x").unwrap();
        assert!(!outcome.partial);
        assert_eq!(outcome.note.title, note.title);
        assert_eq!(outcome.note.body, note.body);
    }

    #[test]
    fn prior_occurrences_round_trip() {
        let original = fixture_note();
        let serialized = serialize_note(&original);
        let outcome = parse_note(&serialized, "x").unwrap();
        assert_eq!(outcome.note.prior_occurrences, original.prior_occurrences);
    }

    #[test]
    fn seeded_trust_with_source_suffix_is_preserved() {
        let raw = "---\nid: m\ntype: module\ntrust: seeded:existing-memory\ndiscovered: 2026-05-01\n---\n# T\nbody";
        let outcome = parse_note(raw, "m").unwrap();
        assert!(!outcome.partial, "seeded:... is a valid trust form");
        assert_eq!(outcome.note.trust, Trust::Seeded);
        assert_eq!(outcome.note.trust_raw, "seeded:existing-memory");
        // Re-serialize and confirm the suffix survives.
        let again = serialize_note(&outcome.note);
        assert!(again.contains("trust: seeded:existing-memory"));
    }

    #[test]
    fn unknown_note_type_defaults_to_module_with_warning() {
        let raw = "---\nid: x\ntype: glomp\ntrust: high\ndiscovered: 2026-01-01\n---\n# T\nb";
        let outcome = parse_note(raw, "x").unwrap();
        assert!(outcome.partial);
        assert_eq!(outcome.note.note_type, NoteType::Module);
    }

    #[test]
    fn invalid_date_in_discovered_is_recovered() {
        let raw = "---\nid: x\ntype: module\ntrust: high\ndiscovered: not-a-date\n---\n# T\nb";
        let outcome = parse_note(raw, "x").unwrap();
        assert!(outcome.partial);
        // We don't assert the exact fallback date; just that parsing
        // succeeded and the discovered field is set.
        let _ = outcome.note.discovered;
    }

    #[test]
    fn empty_lists_serialize_as_inline_brackets() {
        let mut note = fixture_note();
        note.source_paths.clear();
        note.source_commits.clear();
        note.prior_occurrences.clear();
        note.links.clear();
        note.tags.clear();
        let serialized = serialize_note(&note);
        assert!(serialized.contains("source_paths: []"));
        assert!(serialized.contains("source_commits: []"));
        assert!(serialized.contains("prior_occurrences: []"));
        assert!(serialized.contains("links: []"));
        assert!(serialized.contains("tags: []"));
    }

    #[test]
    fn body_hash_is_deterministic() {
        let note = fixture_note();
        let h1 = note.body_hash();
        let h2 = note.body_hash();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // sha256 hex
        // A body change changes the hash.
        let mut note2 = note.clone();
        note2.body.push_str("more");
        assert_ne!(note2.body_hash(), h1);
    }

    #[test]
    fn split_frontmatter_handles_crlf_and_bom() {
        let raw = "\u{feff}---\r\nid: x\r\ntype: module\r\ntrust: high\r\ndiscovered: 2026-01-01\r\n---\r\n# T\r\nbody";
        // Just confirm it does not crash and produces a note. CRLF body
        // preservation is not contracted in v1.
        let outcome = parse_note(raw, "x").unwrap();
        assert_eq!(outcome.note.id, "x");
    }

    #[test]
    fn title_with_leading_blank_lines_still_extracted() {
        let raw = "---\nid: x\ntype: module\ntrust: high\ndiscovered: 2026-01-01\n---\n\n\n# Title\nbody";
        let outcome = parse_note(raw, "x").unwrap();
        assert_eq!(outcome.note.title, "Title");
    }
}
