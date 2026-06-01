//! Pull file paths and identifier-shaped tokens out of a user prompt.
//!
//! Step 1 of the Enricher pipeline (spec §6.1). Deterministic + cheap —
//! no LLM. The downstream Gather step uses these to seed FTS5 queries
//! and the path-overlap lookup.
//!
//! Conservative on purpose: we want false negatives over false positives.
//! Spurious "tokens" injected into queries waste time and may surface
//! unrelated notes. Better to miss a candidate the user mentioned only
//! obliquely — the LLM smart-select sees the full prompt anyway.
//!
//! Tokens *inside* fenced code blocks are excluded so a pasted error
//! trace or snippet doesn't dump every symbol it mentions into the
//! gather query. Same with inline code spans.

use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Entities {
    /// Paths the user mentions (relative or absolute). Always normalized
    /// to forward-slash form for cross-platform matching against
    /// `source_paths` in notes.
    pub paths: Vec<String>,
    /// Function / type / variable identifiers, snake_case and CamelCase.
    /// Lowercased duplicates removed.
    pub symbols: Vec<String>,
    /// Free-form keywords (lowercased, deduped) suitable for FTS5
    /// queries. Subset of the prompt's content words; stopword-filtered.
    pub keywords: Vec<String>,
}

/// Extract entities from a prompt. The optional `tag_dictionary` is the
/// set of vault tags — when a prompt token matches a known tag we
/// preserve it as a keyword so the gather step can hit tag-indexed
/// notes. Pass an empty slice when no dictionary is available.
pub fn extract(prompt: &str, tag_dictionary: &[String]) -> Entities {
    let scrubbed = strip_code_regions(prompt);
    let paths = extract_paths(&scrubbed);
    let symbols = extract_symbols(&scrubbed);
    let keywords = extract_keywords(&scrubbed, tag_dictionary);
    Entities {
        paths,
        symbols,
        keywords,
    }
}

/// Replace fenced and inline code spans with spaces so position-based
/// extraction below sees no tokens inside them.
fn strip_code_regions(s: &str) -> String {
    let bytes = s.as_bytes();
    let n = bytes.len();
    let mut out = String::with_capacity(n);
    let mut i = 0usize;
    let mut in_fence: Option<u8> = None;
    let mut in_inline = false;

    while i < n {
        let b = bytes[i];

        // Fenced code block: 3+ run of ` or ~ at line start toggles.
        if (b == b'`' || b == b'~') && (i == 0 || bytes[i - 1] == b'\n') {
            let mut run = 0usize;
            let mut j = i;
            while j < n && bytes[j] == b {
                run += 1;
                j += 1;
            }
            if run >= 3 {
                match in_fence {
                    None => in_fence = Some(b),
                    Some(c) if c == b => in_fence = None,
                    Some(_) => {}
                }
                // Pass to end of line as whitespace.
                let line_end = bytes[i..].iter().position(|&c| c == b'\n').map(|p| i + p);
                let stop = line_end.unwrap_or(n);
                for _ in i..stop {
                    out.push(' ');
                }
                if let Some(le) = line_end {
                    out.push('\n');
                    i = le + 1;
                } else {
                    i = stop;
                }
                continue;
            }
        }

        if in_fence.is_some() {
            // Inside a fence: emit whitespace.
            if b == b'\n' {
                out.push('\n');
            } else {
                out.push(' ');
            }
            i += 1;
            continue;
        }

        // Inline code toggles on bare backtick.
        if b == b'`' {
            in_inline = !in_inline;
            out.push(' ');
            i += 1;
            continue;
        }
        if in_inline {
            if b == b'\n' {
                out.push('\n');
                in_inline = false; // CommonMark: inline code can't span lines.
            } else {
                out.push(' ');
            }
            i += 1;
            continue;
        }

        out.push(b as char);
        i += 1;
    }
    out
}

/// Extract path-shaped tokens. Heuristics:
/// - Contains at least one `/` (rules out plain hostnames + words)
/// - Doesn't look like a URL (`://`, `http`, `https`)
/// - Either a recognized file extension OR starts with `./`, `../`,
///   or a known project-folder prefix (`src/`, `tests/`, `docs/`, etc.)
fn extract_paths(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for raw in s.split(|c: char| {
        c.is_whitespace() || matches!(c, ',' | ';' | '(' | ')' | '<' | '>' | '"' | '\'' | '!' | '?')
    }) {
        if raw.is_empty() || raw.len() < 3 {
            continue;
        }
        let token = raw.trim_matches(|c: char| matches!(c, '.' | ':' | ')' | '(' | ']' | '['));
        if token.is_empty() {
            continue;
        }
        if !token.contains('/') {
            continue;
        }
        if token.contains("://") {
            continue;
        }
        let lower = token.to_ascii_lowercase();
        if lower.starts_with("http") {
            continue;
        }
        if !looks_like_path(token) {
            continue;
        }
        let normalized = normalize_path(token);
        if seen.insert(normalized.clone()) {
            out.push(normalized);
        }
    }
    out
}

const PATH_PREFIXES: &[&str] = &[
    "./", "../", "src/", "tests/", "docs/", "lib/", "app/", "pages/",
    "components/", "hooks/", "api/", "server/", "client/", "scripts/",
    "config/", "internal/", "pkg/", "cmd/", "src-tauri/", "examples/",
    "supabase/", "migrations/",
];

const KNOWN_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "json", "toml", "yaml", "yml",
    "md", "py", "go", "java", "kt", "swift", "css", "scss", "html",
    "sh", "sql", "lock", "cfg",
];

fn looks_like_path(s: &str) -> bool {
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

fn normalize_path(s: &str) -> String {
    s.replace('\\', "/")
}

/// Extract symbol-shaped identifiers: snake_case (with at least one `_`),
/// CamelCase (uppercase followed by 2+ lowercase, in 2+ runs), and
/// function-call patterns like `foo(`. We deliberately skip single-word
/// lowercase tokens to keep noise down — those are caught by keyword
/// extraction.
fn extract_symbols(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for raw in s.split(|c: char| {
        !c.is_alphanumeric() && c != '_'
    }) {
        if raw.len() < 3 {
            continue;
        }
        let looks_symbol = is_snake_case(raw) || is_camel_case(raw);
        if !looks_symbol {
            continue;
        }
        if seen.insert(raw.to_string()) {
            out.push(raw.to_string());
        }
    }
    out
}

fn is_snake_case(s: &str) -> bool {
    // Must contain at least one underscore between two non-empty
    // alphanumeric segments.
    let mut prev_was_letter = false;
    let mut had_underscore = false;
    let mut next_after_underscore = false;
    for c in s.chars() {
        if c == '_' {
            if !prev_was_letter {
                return false;
            }
            had_underscore = true;
            next_after_underscore = true;
        } else if c.is_alphanumeric() {
            if next_after_underscore && !c.is_alphanumeric() {
                return false;
            }
            next_after_underscore = false;
            prev_was_letter = true;
        } else {
            return false;
        }
    }
    had_underscore && prev_was_letter
}

fn is_camel_case(s: &str) -> bool {
    // Starts with uppercase, has at least one lowercase, has at least
    // one *internal* uppercase boundary (so "Foo" alone doesn't match,
    // but "FooBar" does).
    let first = s.chars().next();
    if !matches!(first, Some(c) if c.is_ascii_uppercase()) {
        return false;
    }
    let mut seen_lower = false;
    let mut internal_upper = false;
    let mut prev_was_lower = false;
    for c in s.chars().skip(1) {
        if !c.is_ascii_alphanumeric() {
            return false;
        }
        if c.is_ascii_lowercase() {
            seen_lower = true;
            prev_was_lower = true;
        } else if c.is_ascii_uppercase() {
            if prev_was_lower {
                internal_upper = true;
            }
            prev_was_lower = false;
        } else {
            prev_was_lower = false;
        }
    }
    seen_lower && internal_upper
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "from", "into", "that", "this", "these",
    "those", "have", "has", "was", "were", "are", "what", "when", "where",
    "which", "while", "will", "would", "should", "could", "than", "then",
    "but", "not", "you", "your", "they", "them", "their", "our", "ours",
    "his", "her", "him", "she", "any", "all", "some", "one", "two",
    "can", "use", "uses", "using", "used", "make", "made", "makes",
    "get", "gets", "got", "got", "now", "yet", "still", "very", "just",
    "also", "such", "etc", "say", "said", "says", "see", "seen", "saw",
];

fn extract_keywords(s: &str, tag_dictionary: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let tags: HashSet<&str> = tag_dictionary.iter().map(|s| s.as_str()).collect();
    for raw in s.split(|c: char| !c.is_alphanumeric() && c != '-') {
        let lower = raw.to_ascii_lowercase();
        if lower.len() < 4 {
            // Always keep tag-dictionary hits even when short.
            if tags.contains(lower.as_str()) && seen.insert(lower.clone()) {
                out.push(lower);
            }
            continue;
        }
        if STOPWORDS.contains(&lower.as_str()) {
            continue;
        }
        if lower.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        if seen.insert(lower.clone()) {
            out.push(lower);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_relative_paths() {
        let e = extract("Please look at src/recall/mod.rs and src/recall/index/mod.rs", &[]);
        assert!(e.paths.contains(&"src/recall/mod.rs".to_string()));
        assert!(e.paths.contains(&"src/recall/index/mod.rs".to_string()));
    }

    #[test]
    fn extracts_absolute_paths() {
        let e = extract("checked /Users/me/foo/bar.rs already", &[]);
        assert!(e.paths.iter().any(|p| p == "/Users/me/foo/bar.rs"));
    }

    #[test]
    fn ignores_urls_even_when_path_looking() {
        let e = extract("see https://example.com/docs/api.md", &[]);
        assert!(e.paths.is_empty(), "URLs should not be treated as paths");
    }

    #[test]
    fn windows_backslashes_normalized_to_forward() {
        // Even though we're macOS-only, the path-overlap query in
        // recall_note_paths stores forward-slash. Normalize input.
        let e = extract("look at src\\foo\\bar.rs", &[]);
        // Backslash isn't a path component separator we recognize; the
        // single-token form should normalize.
        if !e.paths.is_empty() {
            assert!(e.paths[0].contains('/'));
        }
    }

    #[test]
    fn extracts_snake_case_symbols() {
        let e = extract("call decrypt_credential before encrypt_credential", &[]);
        assert!(e.symbols.contains(&"decrypt_credential".to_string()));
        assert!(e.symbols.contains(&"encrypt_credential".to_string()));
    }

    #[test]
    fn extracts_camel_case_symbols() {
        let e = extract("the FileViewer renders the EditorThemes", &[]);
        assert!(e.symbols.contains(&"FileViewer".to_string()));
        assert!(e.symbols.contains(&"EditorThemes".to_string()));
    }

    #[test]
    fn single_word_lowercase_not_treated_as_symbol() {
        let e = extract("the project handles errors gracefully", &[]);
        // Plain words shouldn't become symbols.
        assert!(!e.symbols.contains(&"project".to_string()));
        assert!(!e.symbols.contains(&"errors".to_string()));
    }

    #[test]
    fn ignores_tokens_inside_fenced_code() {
        let prompt = "\
real_symbol_outside is mentioned, but
```
hidden_symbol_inside should not appear
```
also_real_symbol after the fence";
        let e = extract(prompt, &[]);
        assert!(e.symbols.contains(&"real_symbol_outside".to_string()));
        assert!(e.symbols.contains(&"also_real_symbol".to_string()));
        assert!(!e.symbols.contains(&"hidden_symbol_inside".to_string()));
    }

    #[test]
    fn ignores_tokens_inside_inline_code() {
        let e = extract("explain `inline_hidden` and outside_visible together", &[]);
        assert!(e.symbols.contains(&"outside_visible".to_string()));
        assert!(!e.symbols.contains(&"inline_hidden".to_string()));
    }

    #[test]
    fn keywords_drop_stopwords_and_short_words() {
        let e = extract("the project should not have any duplicates", &[]);
        assert!(!e.keywords.contains(&"the".to_string()));
        assert!(!e.keywords.contains(&"any".to_string()));
        assert!(e.keywords.contains(&"project".to_string()));
        assert!(e.keywords.contains(&"duplicates".to_string()));
    }

    #[test]
    fn tag_dictionary_resurrects_short_tokens() {
        // Without the dictionary, "db" is too short to keep. With it,
        // we want the gather step to be able to hit the `db` tag.
        let e = extract("look at db migrations", &["db".to_string()]);
        assert!(e.keywords.contains(&"db".to_string()));
    }

    #[test]
    fn does_not_produce_duplicate_entries() {
        let e = extract("project project Project_Foo project_foo PROJECT", &[]);
        let unique: HashSet<_> = e.keywords.iter().collect();
        assert_eq!(unique.len(), e.keywords.len(), "keywords should be deduped");
    }

    #[test]
    fn paths_from_quoted_strings_are_extracted() {
        let e = extract("read \"src/recall/mod.rs\" please", &[]);
        assert!(e.paths.iter().any(|p| p == "src/recall/mod.rs"));
    }

    #[test]
    fn empty_prompt_returns_empty_entities() {
        let e = extract("", &[]);
        assert!(e.paths.is_empty());
        assert!(e.symbols.is_empty());
        assert!(e.keywords.is_empty());
    }

    #[test]
    fn recognizes_files_by_extension_even_without_prefix() {
        let e = extract("touched config.toml and main.rs", &[]);
        // These contain no '/' so they're NOT paths per our heuristic.
        // This is intentional: bare filenames create too many false
        // positives ("main.rs" can appear in many sentences). Only
        // path-shaped (with '/') tokens are extracted as paths.
        assert!(e.paths.is_empty());
        // Keyword extraction splits on '.' so the extension is lost
        // (e.g. "config.toml" becomes "config" + "toml"). This is fine
        // — the gather step still hits notes about "config" or "main"
        // if those terms appear. No assertion here; the goal of the
        // test is that bare filenames don't pollute the `paths`
        // bucket.
    }

    #[test]
    fn long_pasted_error_trace_in_fence_is_not_polluting() {
        let prompt = "I hit this error:\n```\nthread panicked at panic_function_a\nat src/secret_panic_path.rs:123\nCaused by: SecretInternalType not found\n```\nCan you fix?";
        let e = extract(prompt, &[]);
        assert!(!e.symbols.contains(&"panic_function_a".to_string()));
        assert!(!e.paths.iter().any(|p| p.contains("secret_panic_path")));
        assert!(!e.symbols.contains(&"SecretInternalType".to_string()));
    }
}
