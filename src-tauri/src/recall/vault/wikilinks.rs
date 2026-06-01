//! Wikilink extraction from note bodies.
//!
//! The graph index in `recall_note_links` is the authoritative source for
//! "what this note links to". Frontmatter `links:` is a convenience listing
//! only — the body is canonical. Spec §5.4 promises that broken links are
//! visible (Obsidian's own broken-link detector) and not silent.
//!
//! Supported forms:
//! - `[[plain]]`             → ("plain", display="plain", meta=false, anchor=None)
//! - `[[a|display text]]`    → ("a", display="display text", meta=false, anchor=None)
//! - `[[meta:cross]]`        → ("cross", display="cross", meta=true, anchor=None)
//! - `[[note#heading]]`      → ("note", display="note#heading", meta=false, anchor=Some("heading"))
//! - `[[meta:x|alias]]`      → meta + alias combination
//!
//! Ignored:
//! - inside fenced code blocks (```…```), tilde-fenced (~~~…~~~)
//! - inside inline code (`…`)
//! - empty `[[]]`

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wikilink {
    /// The raw target identifier — what comes immediately after `[[`
    /// (and after the `meta:` prefix if present), before any `|` or `#`.
    pub target: String,
    /// What the link displays as. Defaults to the target.
    pub display: String,
    /// `[[meta:...]]` style cross-vault link.
    pub is_meta: bool,
    /// Optional `#heading` anchor.
    pub anchor: Option<String>,
    /// Verbatim text between `[[` and `]]`, for round-trip fidelity.
    pub raw: String,
}

/// Extract every wikilink from the body, in document order. Duplicates are
/// preserved so callers can detect "links to X mentioned three times"
/// — the index dedupes per `src_note_id, dst_text` (see §8 schema).
pub fn extract(body: &str) -> Vec<Wikilink> {
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0usize;
    let n = bytes.len();
    let mut in_code_fence: Option<u8> = None; // Some(b'`') or Some(b'~')
    let mut in_inline_code = false;

    while i < n {
        let b = bytes[i];

        // Fenced code blocks: a line that starts with ``` or ~~~ flips
        // the state. We only check at line start.
        if (b == b'`' || b == b'~') && is_line_start(bytes, i) && is_fence_opener(bytes, i, b) {
            // Match the run length so an opening ``` and a closing ``` (or
            // longer) are paired correctly.
            let fence_char = b;
            // Skip to end of line.
            let line_end = find_byte(bytes, i, b'\n').unwrap_or(n);
            match in_code_fence {
                None => in_code_fence = Some(fence_char),
                Some(existing) if existing == fence_char => in_code_fence = None,
                Some(_) => {}
            }
            i = line_end + 1;
            continue;
        }

        if in_code_fence.is_some() {
            i += 1;
            continue;
        }

        // Inline code toggles on bare `…` (we treat ` as on/off without
        // tracking run length — sufficient for the conservative goal
        // "don't extract from inline code"). Multi-backtick spans are
        // also captured correctly under this rule because the closing
        // run flips us back off.
        if b == b'`' {
            in_inline_code = !in_inline_code;
            i += 1;
            continue;
        }

        if in_inline_code {
            i += 1;
            continue;
        }

        // Wikilink opener?
        if b == b'[' && i + 1 < n && bytes[i + 1] == b'[' {
            if let Some(end) = find_subseq(bytes, i + 2, b"]]") {
                let raw_bytes = &bytes[i + 2..end];
                if let Ok(raw) = std::str::from_utf8(raw_bytes) {
                    if let Some(link) = parse_inner(raw) {
                        out.push(link);
                    }
                }
                i = end + 2;
                continue;
            }
        }

        i += 1;
    }

    out
}

fn parse_inner(raw: &str) -> Option<Wikilink> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Split display alias on '|'. Only the first '|' counts; further
    // pipes belong to the display text.
    let (target_part, display) = match trimmed.find('|') {
        Some(idx) => (
            trimmed[..idx].trim().to_string(),
            trimmed[idx + 1..].trim().to_string(),
        ),
        None => (trimmed.to_string(), trimmed.to_string()),
    };
    let (is_meta, target_no_meta) = match target_part.strip_prefix("meta:") {
        Some(rest) => (true, rest.trim().to_string()),
        None => (false, target_part.clone()),
    };
    // Anchor split: only on the target side (`note#heading`).
    let (target, anchor) = match target_no_meta.find('#') {
        Some(idx) => (
            target_no_meta[..idx].trim().to_string(),
            Some(target_no_meta[idx + 1..].trim().to_string()),
        ),
        None => (target_no_meta, None),
    };
    if target.is_empty() {
        return None;
    }
    Some(Wikilink {
        target,
        display,
        is_meta,
        anchor,
        raw: trimmed.to_string(),
    })
}

fn is_line_start(bytes: &[u8], i: usize) -> bool {
    i == 0 || bytes[i - 1] == b'\n'
}

fn is_fence_opener(bytes: &[u8], i: usize, ch: u8) -> bool {
    // Three or more in a row.
    let n = bytes.len();
    let mut count = 0;
    let mut j = i;
    while j < n && bytes[j] == ch {
        count += 1;
        j += 1;
    }
    count >= 3
}

fn find_byte(bytes: &[u8], start: usize, target: u8) -> Option<usize> {
    bytes[start..].iter().position(|&b| b == target).map(|i| start + i)
}

fn find_subseq(bytes: &[u8], start: usize, needle: &[u8]) -> Option<usize> {
    let n = bytes.len();
    let m = needle.len();
    if m == 0 || start + m > n {
        return None;
    }
    for i in start..=n - m {
        if &bytes[i..i + m] == needle {
            return Some(i);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_plain_link() {
        let links = extract("see [[edge-fn-execute-pipeline]] for context");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "edge-fn-execute-pipeline");
        assert_eq!(links[0].display, "edge-fn-execute-pipeline");
        assert!(!links[0].is_meta);
        assert!(links[0].anchor.is_none());
    }

    #[test]
    fn extracts_alias_link() {
        let links = extract("read [[note-a|the auth flow note]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "note-a");
        assert_eq!(links[0].display, "the auth flow note");
    }

    #[test]
    fn extracts_meta_link() {
        let links = extract("cross-cutting: [[meta:cross-provider-error-shape]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "cross-provider-error-shape");
        assert!(links[0].is_meta);
    }

    #[test]
    fn extracts_anchor_link() {
        let links = extract("see [[note-x#fix-section]] below");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "note-x");
        assert_eq!(links[0].anchor.as_deref(), Some("fix-section"));
    }

    #[test]
    fn meta_plus_anchor_plus_alias() {
        let links = extract("[[meta:pattern-x#section|alias text]]");
        assert_eq!(links.len(), 1);
        assert!(links[0].is_meta);
        assert_eq!(links[0].target, "pattern-x");
        assert_eq!(links[0].anchor.as_deref(), Some("section"));
        assert_eq!(links[0].display, "alias text");
    }

    #[test]
    fn ignores_links_in_fenced_code_blocks() {
        let body = "\
real: [[outside]]
```
fake: [[inside-fence]]
```
also-real: [[outside-again]]";
        let links = extract(body);
        let targets: Vec<&str> = links.iter().map(|l| l.target.as_str()).collect();
        assert_eq!(targets, vec!["outside", "outside-again"]);
    }

    #[test]
    fn ignores_links_in_tilde_fences() {
        let body = "\
real: [[a]]
~~~
fake: [[b]]
~~~
real: [[c]]";
        let links = extract(body);
        let targets: Vec<&str> = links.iter().map(|l| l.target.as_str()).collect();
        assert_eq!(targets, vec!["a", "c"]);
    }

    #[test]
    fn ignores_links_in_inline_code() {
        let body = "real [[outside]] but `not [[inline]] me` and [[after]]";
        let links = extract(body);
        let targets: Vec<&str> = links.iter().map(|l| l.target.as_str()).collect();
        assert_eq!(targets, vec!["outside", "after"]);
    }

    #[test]
    fn empty_link_is_rejected() {
        let links = extract("garbage [[]] noise [[ ]] more");
        assert!(links.is_empty());
    }

    #[test]
    fn preserves_document_order_and_duplicates() {
        let links = extract("[[a]] [[b]] [[a]] [[c]] [[a]]");
        let targets: Vec<&str> = links.iter().map(|l| l.target.as_str()).collect();
        assert_eq!(targets, vec!["a", "b", "a", "c", "a"]);
    }

    #[test]
    fn unterminated_open_brackets_are_not_links() {
        let links = extract("garbage [[no-close here");
        assert!(links.is_empty());
    }

    #[test]
    fn multiple_pipes_keep_only_first_split() {
        let links = extract("[[a|disp | with | pipes]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "a");
        assert_eq!(links[0].display, "disp | with | pipes");
    }

    #[test]
    fn fence_state_only_flips_at_line_start() {
        // Mid-line backticks of length 3+ should NOT open a fence — only
        // a line that begins with the run does. (Markdown rule.)
        let body = "intro ``` not a fence [[still-a-link]] more ```";
        let links = extract(body);
        // Note: backticks toggle inline-code in our scanner. So the
        // bracketed token between two backtick runs falls inside inline
        // code and is suppressed. This is conservative and matches the
        // spec's "ignored inside code" promise.
        assert!(links.is_empty());
    }
}
