//! Step 3.5: diff-fidelity verification (RECALL-SPEC §7.3).
//!
//! Deterministic + cheap (no LLM). Extract code-shaped tokens from
//! the LLM-generated note and verify each appears somewhere in the
//! diff. Tokens that don't appear are flagged as "potentially
//! hallucinated"; the orchestrator downgrades the note's trust from
//! `high` to `medium` and stores the flagged tokens in
//! `recall_harvests.flagged_tokens`.

use std::collections::HashSet;

use crate::recall::git::CommitInfo;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FidelityStatus {
    /// Every code-shaped token in the note appears in the diff.
    Clean,
    /// Some tokens didn't match — trust will be downgraded.
    Flagged,
}

#[derive(Debug, Clone)]
pub struct FidelityReport {
    pub status: FidelityStatus,
    /// Tokens not found anywhere in the commit's added or removed
    /// lines (nor in any file path).
    pub flagged_tokens: Vec<String>,
    /// Tokens that were extracted and verified. Useful for the audit
    /// log's "look how thorough we were" telemetry.
    pub verified_tokens: Vec<String>,
}

/// Run the check. `note_body` is the markdown body the LLM produced
/// (frontmatter excluded — the parser strips it before calling). The
/// commit supplies the ground-truth diff: every `+` line, every `-`
/// line, every file path.
pub fn check(note_body: &str, commit: &CommitInfo) -> FidelityReport {
    let tokens = extract_tokens(note_body);
    if tokens.is_empty() {
        return FidelityReport {
            status: FidelityStatus::Clean,
            flagged_tokens: vec![],
            verified_tokens: vec![],
        };
    }
    let haystack = build_haystack(commit);

    let mut verified = Vec::new();
    let mut flagged = Vec::new();
    for token in tokens {
        if haystack.contains(&token) {
            verified.push(token);
        } else {
            flagged.push(token);
        }
    }
    let status = if flagged.is_empty() {
        FidelityStatus::Clean
    } else {
        FidelityStatus::Flagged
    };
    FidelityReport {
        status,
        flagged_tokens: flagged,
        verified_tokens: verified,
    }
}

/// The set we check `contains()` against. Lowercased for case-
/// insensitive matching — symbol style varies between source and
/// note narration ("FileViewer" in code vs "fileviewer" in prose).
fn build_haystack(commit: &CommitInfo) -> String {
    let mut s = String::new();
    for f in &commit.files {
        s.push_str(&f.path.to_ascii_lowercase());
        s.push('\n');
        for line in &f.added_lines {
            s.push_str(&line.to_ascii_lowercase());
            s.push('\n');
        }
        for line in &f.removed_lines {
            s.push_str(&line.to_ascii_lowercase());
            s.push('\n');
        }
    }
    s
}

/// Pull code-shaped tokens from the note body:
/// - File paths (anything with a `/` plus a recognized extension or
///   project-folder prefix — same heuristic as
///   `enricher::entity_extraction`).
/// - Identifier-looking tokens: snake_case, CamelCase, dotted
///   namespace paths.
/// - Words inside backtick spans, filtered the same way.
///
/// Backtick spans are split into individual *words* and run through the
/// same `looks_codey` filter as bare tokens — a multi-word span like
/// `400 Bad Request` or a possessive like `URL's` must not be checked as
/// one literal phrase (it never appears verbatim in a diff), only its
/// genuinely code-shaped sub-tokens count. Without this, accurate notes
/// get false-flagged and their trust needlessly downgraded.
///
/// Tokens inside fenced ``` blocks are NOT extracted: the LLM may
/// quote source verbatim and we'd false-positive every line. The
/// generate prompt asks the LLM not to invent code snippets without
/// pulling them from the diff.
fn extract_tokens(body: &str) -> Vec<String> {
    let fenced_stripped = strip_fenced_code(body);
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();

    // Replace inline-backtick delimiters with whitespace so backtick
    // content is split into words exactly like prose — then the codey
    // filter below keeps only the identifier-shaped pieces. (Multi-word
    // backtick phrases used to be captured whole, which false-flagged.)
    let scrubbed = fenced_stripped.replace('`', " ");

    // Split on whitespace, common punctuation, AND apostrophes — the last
    // so possessives like `URL's` reduce to `URL` (which then isn't codey)
    // rather than a literal `url's` token that no diff contains.
    for raw in scrubbed.split(|c: char| {
        c.is_whitespace()
            || matches!(
                c,
                ',' | ';' | '(' | ')' | '<' | '>' | '"' | '!' | '?' | '\'' | '\u{2019}'
            )
    }) {
        let trimmed = raw.trim_matches(|c: char| matches!(c, '.' | ':' | '[' | ']' | '{' | '}'));
        if trimmed.len() < 3 {
            continue;
        }
        if !looks_codey(trimmed) {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if seen.insert(lower.clone()) {
            out.push(lower);
        }
    }

    out
}

fn looks_codey(s: &str) -> bool {
    // Paths: contain `/` and something path-ish.
    if s.contains('/') && (s.contains('.') || s.contains("src/") || s.contains("tests/")) {
        return true;
    }
    // snake_case: has at least one underscore between alphanumerics.
    if s.contains('_') && s.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return true;
    }
    // CamelCase: starts uppercase, has internal lowercase + internal uppercase.
    if let Some(first) = s.chars().next() {
        if first.is_ascii_uppercase() && s.chars().skip(1).any(|c| c.is_ascii_lowercase())
            && s.chars().skip(1).any(|c| c.is_ascii_uppercase())
        {
            return true;
        }
    }
    // Dotted namespace: foo.bar.baz where each segment is alphanumeric.
    if s.contains('.')
        && s.split('.').all(|seg| !seg.is_empty() && seg.chars().all(|c| c.is_alphanumeric() || c == '_'))
        && s.split('.').count() >= 2
    {
        return true;
    }
    false
}

fn strip_fenced_code(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut in_fence = false;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push('\n');
            continue;
        }
        if in_fence {
            out.push('\n');
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::git::{ChangeKind, FileChange};
    use chrono::TimeZone;

    fn commit(files: &[(&str, &[&str], &[&str])]) -> CommitInfo {
        CommitInfo {
            hash: "abc".into(),
            author_name: "T".into(),
            author_email: "t@example.com".into(),
            timestamp: chrono::Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
            subject: "subj".into(),
            full_message: "subj".into(),
            files: files
                .iter()
                .map(|(p, added, removed)| FileChange {
                    path: (*p).to_string(),
                    kind: ChangeKind::Modified,
                    added_lines: added.iter().map(|s| s.to_string()).collect(),
                    removed_lines: removed.iter().map(|s| s.to_string()).collect(),
                    diff_text: String::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn note_with_only_verified_tokens_is_clean() {
        let c = commit(&[(
            "src/credentials.ts",
            &["pub fn decrypt_credential(c: Cred) -> String {"],
            &[],
        )]);
        let body = "We fixed `decrypt_credential` in `src/credentials.ts` to handle the empty case.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Clean, "got flagged: {:?}", report.flagged_tokens);
    }

    #[test]
    fn note_with_invented_symbol_is_flagged() {
        let c = commit(&[(
            "src/foo.rs",
            &["fn real_function() {"],
            &[],
        )]);
        let body = "This commit introduces `fictional_function_that_does_not_exist` in src/foo.rs.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Flagged);
        assert!(report.flagged_tokens.iter().any(|t| t.contains("fictional_function")));
    }

    #[test]
    fn invented_file_path_is_flagged() {
        let c = commit(&[("src/foo.rs", &["fn x(){}"], &[])]);
        let body = "Changed file at src/imaginary_module.rs to fix the bug.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Flagged);
        assert!(report.flagged_tokens.iter().any(|t| t.contains("imaginary_module")));
    }

    #[test]
    fn camel_case_in_diff_verifies_lowercase_in_note() {
        let c = commit(&[("src/ui.rs", &["impl FileViewer for X {}"], &[])]);
        let body = "Adds a `FileViewer` impl.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Clean);
    }

    #[test]
    fn fenced_code_block_in_note_is_not_extracted() {
        let c = commit(&[("src/x.rs", &["fn x(){}"], &[])]);
        let body = "Look at this:\n```\nlots_of_fake_symbols not_in_diff\nmore_invented_stuff\n```\nThe real change is `fn x`.";
        let report = check(body, &c);
        // Only `fn x` is a verified extraction; the fenced symbols
        // are excluded by design.
        assert_eq!(report.status, FidelityStatus::Clean);
    }

    #[test]
    fn empty_note_body_is_clean() {
        let c = commit(&[("src/x.rs", &["x"], &[])]);
        assert_eq!(check("", &c).status, FidelityStatus::Clean);
    }

    #[test]
    fn note_with_no_codey_tokens_is_clean() {
        let c = commit(&[("src/x.rs", &["x"], &[])]);
        let body = "this prose says nothing identifier-shaped at all just words and stop";
        assert_eq!(check(body, &c).status, FidelityStatus::Clean);
    }

    #[test]
    fn snake_case_in_removed_lines_also_counts() {
        let c = commit(&[("src/x.rs", &[], &["fn old_helper() {}"])]);
        let body = "We dropped `old_helper`.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Clean);
    }

    #[test]
    fn path_components_with_known_extensions_verify() {
        let c = commit(&[(
            "supabase/migrations/20260601_x.sql",
            &["ALTER TABLE foo ADD COLUMN x text"],
            &[],
        )]);
        let body = "Migration `supabase/migrations/20260601_x.sql` adds the column.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Clean);
    }

    #[test]
    fn multi_word_backtick_phrase_is_not_flagged_as_one_token() {
        // Regression (eval finding): the model wrote `400 Bad Request`; the
        // diff has `status: 400` but not that literal phrase. The phrase must
        // be split into words — none of which are code-shaped — so the note
        // stays Clean instead of being false-flagged and trust-downgraded.
        let c = commit(&[(
            "supabase/functions/generate-content/index.ts",
            &["return new Response(body, { status: 400 });"],
            &[],
        )]);
        let body = "Empty prompts now return a `400 Bad Request` instead of crashing.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Clean, "got flagged: {:?}", report.flagged_tokens);
    }

    #[test]
    fn possessive_in_backticks_is_not_flagged() {
        // Regression (eval finding): `URL's` must reduce to `URL` (not codey),
        // not a literal `url's` token the diff never contains.
        let c = commit(&[("supabase/functions/cms-public-api/index.ts", &["const domain = new URL(req.url);"], &[])]);
        let body = "Reads the `domain` from the request `URL's` query string.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Clean, "got flagged: {:?}", report.flagged_tokens);
    }

    #[test]
    fn real_invented_symbol_inside_multiword_span_still_flagged() {
        // The split must still catch a genuinely hallucinated identifier even
        // when it sits inside a multi-word backtick span.
        let c = commit(&[("src/real.rs", &["fn real_function() {"], &[])]);
        let body = "Calls the `invented_helper_fn for cleanup` path.";
        let report = check(body, &c);
        assert_eq!(report.status, FidelityStatus::Flagged);
        assert!(report.flagged_tokens.iter().any(|t| t.contains("invented_helper_fn")));
    }

    #[test]
    fn multiple_flagged_tokens_all_reported() {
        let c = commit(&[("src/real.rs", &["fn real_function() {"], &[])]);
        let body = "Fixed `invented_a`, `invented_b`, and `invented_c`.";
        let report = check(body, &c);
        assert!(report.flagged_tokens.len() >= 3);
    }
}
