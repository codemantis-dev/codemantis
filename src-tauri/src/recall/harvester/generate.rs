//! Step 3: LLM note synthesis (RECALL-SPEC §7.2 step 3).
//!
//! Send the commit diff + message to the configured Harvester model
//! and parse the structured JSON response into a [`Note`]. The
//! prompt enforces:
//! - Every factual claim anchored to the diff (verifiable by the
//!   fidelity step that runs afterwards).
//! - Why-section explicitly labels its source (`from commit message`).
//! - Discrepancies between the commit message and the diff are
//!   recorded in a dedicated section, never blended into the main
//!   narrative.

use chrono::Utc;
use serde::Deserialize;

use crate::recall::config::RecallConfig;
use crate::recall::git::CommitInfo;
use crate::recall::llm_client::{LlmClient, LlmRequest, LlmResponse};
use crate::recall::vault::{Note, NoteType, Status, Trust};
use crate::recall::RecallError;

/// The structured shape we ask the LLM to return. `body` is the
/// markdown that ends up under the `# heading` in the note file.
#[derive(Debug, Clone, Deserialize)]
struct LlmNoteOutput {
    title: String,
    body: String,
    /// Stable kebab-case slug suggestion. Caller validates and may
    /// suffix on collision.
    id_slug: String,
    #[serde(default)]
    tags: Vec<String>,
}

const SYSTEM_PROMPT: &str = r###"You are the Recall Harvester for a coding assistant. Given a git commit's diff and message, you produce ONE structured memory note that captures the durable lesson.

NON-NEGOTIABLE RULES:
1. EVERY factual claim in the body must be verifiable in the diff (look at the +/- lines and file paths). If you cannot trace a claim to a specific +/- line, DO NOT include it.
2. The commit message tells you the WHY. Quote relevant phrases in a "## Why (from commit message)" section. Never blend message-sourced claims with diff-sourced claims.
3. If the message claims something the diff doesn't support, record this under a "## Discrepancies" section. Never silently swallow the contradiction.
4. Be specific. Reference real file paths and real symbol names from the diff. Avoid generic platitudes ("improves maintainability", "follows best practices").
5. The note must teach a future reader something they couldn't get from the diff alone. If the diff is purely mechanical (rename, formatting) and you have nothing to add, return an empty body and let the orchestrator skip.

OUTPUT — strict JSON, no markdown, no commentary:
{
  "title": "<short, factual; 80 chars max>",
  "id_slug": "<kebab-case, immutable; derived from title>",
  "body": "<markdown with ## sections>",
  "tags": ["lowercase", "kebab-case"]
}

Body structure (omit sections that don't apply, in this order):
## What changed
<one paragraph summarizing the diff>

## Why (from commit message)
<quoted phrases or paraphrase explicitly labelled as message-sourced>

## Future trigger
<when this note should bite a future change>

## Discrepancies
<only if message and diff disagree>"###;

/// Generate a note for the given commit + classified type.
pub async fn generate(
    llm: &dyn LlmClient,
    api_key: &str,
    config: &RecallConfig,
    commit: &CommitInfo,
    note_type: NoteType,
) -> Result<GeneratedNote, RecallError> {
    let user_payload = render_user_payload(commit);
    let req = LlmRequest {
        provider: config.harvester_provider.clone(),
        model: config.harvester_model.clone(),
        system_prompt: SYSTEM_PROMPT.to_string(),
        user_prompt: user_payload,
        timeout: crate::recall::llm_client::DEFAULT_TIMEOUT,
    };
    let response = llm.call(req, api_key).await?;
    let parsed = parse_response(&response.text)?;

    let note = build_note(commit, note_type, parsed)?;

    Ok(GeneratedNote {
        note,
        usage: response,
    })
}

#[derive(Debug, Clone)]
pub struct GeneratedNote {
    pub note: Note,
    pub usage: LlmResponse,
}

fn render_user_payload(commit: &CommitInfo) -> String {
    let mut out = String::new();
    out.push_str(&format!("COMMIT: {}\nAUTHOR: {} <{}>\nDATE: {}\n\n",
        commit.hash, commit.author_name, commit.author_email, commit.timestamp));
    out.push_str("COMMIT MESSAGE:\n");
    out.push_str(&commit.full_message);
    out.push_str("\n\n");
    out.push_str("DIFF:\n");
    // Cap total diff size to avoid blowing the context window on
    // mass refactors. The Harvester is happy to write a note about a
    // commit even with a truncated diff — fidelity is still checked
    // against the truncated portion.
    const MAX_DIFF_CHARS: usize = 40_000;
    let mut diff_chars_left = MAX_DIFF_CHARS;
    for f in &commit.files {
        let chunk = &f.diff_text;
        let take = chunk.len().min(diff_chars_left);
        out.push_str(&chunk[..take]);
        out.push('\n');
        diff_chars_left = diff_chars_left.saturating_sub(take);
        if diff_chars_left == 0 {
            out.push_str("\n…[diff truncated to fit context budget]\n");
            break;
        }
    }
    out
}

fn parse_response(text: &str) -> Result<LlmNoteOutput, RecallError> {
    let stripped = strip_json_fence(text);
    serde_json::from_str(stripped).map_err(|e| {
        RecallError::Config(format!(
            "harvester LLM returned malformed JSON: {} (got: {})",
            e,
            truncate(stripped, 200)
        ))
    })
}

fn strip_json_fence(s: &str) -> &str {
    let t = s.trim();
    let t = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .unwrap_or(t)
        .trim();
    t.strip_suffix("```").unwrap_or(t).trim()
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

fn build_note(
    commit: &CommitInfo,
    note_type: NoteType,
    parsed: LlmNoteOutput,
) -> Result<Note, RecallError> {
    if parsed.title.trim().is_empty() {
        return Err(RecallError::Config("LLM returned empty title".into()));
    }
    let id = if parsed.id_slug.trim().is_empty() {
        slug_from_title(&parsed.title)
    } else {
        normalize_slug(&parsed.id_slug)
    };
    if id.is_empty() {
        return Err(RecallError::Config("LLM returned an unusable id_slug".into()));
    }

    let now = Utc::now().date_naive();
    let source_paths: Vec<String> = commit.files.iter().map(|f| f.path.clone()).collect();

    Ok(Note {
        id,
        note_type,
        project: None,
        status: Status::Active,
        // Harvester generated notes start at `high` trust; the
        // fidelity step downgrades to `medium` when it flags
        // hallucinated tokens.
        trust: Trust::High,
        trust_raw: String::new(),
        severity: None,
        discovered: now,
        last_verified: now,
        source_paths,
        source_commits: vec![commit.hash.clone()],
        prior_occurrences: vec![],
        links: vec![],
        tags: parsed.tags.into_iter().map(|t| t.to_lowercase()).collect(),
        title: parsed.title.trim().to_string(),
        body: parsed.body.trim().to_string(),
        file_path: None,
    })
}

/// Convert an arbitrary title into a kebab-case slug. Lowercase,
/// non-alphanumerics → `-`, collapse runs of `-`, trim leading and
/// trailing `-`.
fn slug_from_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut prev_dash = false;
    for c in title.chars() {
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

/// Normalize a slug the LLM proposed (collapse whitespace, kebab,
/// lower).
fn normalize_slug(s: &str) -> String {
    slug_from_title(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::git::{ChangeKind, FileChange};
    use crate::recall::llm_client::MockLlmClient;
    use chrono::TimeZone;

    fn cfg() -> RecallConfig {
        RecallConfig {
            enabled: true,
            ..RecallConfig::default()
        }
    }

    fn commit() -> CommitInfo {
        CommitInfo {
            hash: "abc1234".to_string(),
            author_name: "T".to_string(),
            author_email: "t@example.com".to_string(),
            timestamp: chrono::Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
            subject: "fix(auth): handle empty session".to_string(),
            full_message: "fix(auth): handle empty session\n\nbody".to_string(),
            files: vec![FileChange {
                path: "src/auth.rs".to_string(),
                kind: ChangeKind::Modified,
                added_lines: vec!["if session.is_empty() { return None; }".to_string()],
                removed_lines: vec![],
                diff_text: "diff --git a/src/auth.rs b/src/auth.rs\n@@ -1,1 +1,3 @@\n+if session.is_empty() { return None; }\n".to_string(),
            }],
        }
    }

    #[tokio::test]
    async fn happy_path_builds_a_note_from_llm_response() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r###"{
              "title": "Empty session handling in auth",
              "id_slug": "auth-empty-session",
              "body": "## What changed\nGuard against empty session.\n\n## Why (from commit message)\nhandle empty session.",
              "tags": ["auth", "session"]
            }"###,
            300,
            120,
        );
        let generated = generate(&llm, "k", &cfg(), &commit(), NoteType::Landmine).await.unwrap();
        assert_eq!(generated.note.title, "Empty session handling in auth");
        assert_eq!(generated.note.id, "auth-empty-session");
        assert_eq!(generated.note.note_type, NoteType::Landmine);
        assert_eq!(generated.note.source_paths, vec!["src/auth.rs"]);
        assert_eq!(generated.note.source_commits, vec!["abc1234"]);
        assert_eq!(generated.note.tags, vec!["auth".to_string(), "session".to_string()]);
        assert!(generated.note.body.contains("## What changed"));
    }

    #[tokio::test]
    async fn missing_slug_is_derived_from_title() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r#"{"title": "Hello, World!", "id_slug": "", "body": "x", "tags": []}"#,
            10,
            5,
        );
        let generated = generate(&llm, "k", &cfg(), &commit(), NoteType::Decision).await.unwrap();
        assert_eq!(generated.note.id, "hello-world");
    }

    #[tokio::test]
    async fn malformed_json_returns_err() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok("not json at all", 5, 2);
        let result = generate(&llm, "k", &cfg(), &commit(), NoteType::Decision).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn json_in_markdown_fence_is_unwrapped() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            "```json\n{\"title\":\"X\",\"id_slug\":\"x\",\"body\":\"b\",\"tags\":[]}\n```",
            10,
            5,
        );
        let generated = generate(&llm, "k", &cfg(), &commit(), NoteType::Decision).await.unwrap();
        assert_eq!(generated.note.id, "x");
        assert_eq!(generated.note.title, "X");
    }

    #[tokio::test]
    async fn empty_title_returns_err() {
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r#"{"title":"  ","id_slug":"x","body":"b","tags":[]}"#,
            5,
            2,
        );
        let result = generate(&llm, "k", &cfg(), &commit(), NoteType::Decision).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn llm_call_failure_propagates() {
        let llm = MockLlmClient::new();
        llm.enqueue_err("provider 500");
        let result = generate(&llm, "k", &cfg(), &commit(), NoteType::Decision).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn source_paths_come_from_commit_files() {
        let mut c = commit();
        c.files.push(FileChange {
            path: "src/other.rs".to_string(),
            kind: ChangeKind::Modified,
            added_lines: vec!["x".to_string()],
            removed_lines: vec![],
            diff_text: "diff --git a/src/other.rs b/src/other.rs\n+x\n".to_string(),
        });
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r#"{"title":"t","id_slug":"t","body":"b","tags":[]}"#,
            5,
            2,
        );
        let generated = generate(&llm, "k", &cfg(), &c, NoteType::Decision).await.unwrap();
        assert_eq!(generated.note.source_paths.len(), 2);
        assert!(generated.note.source_paths.contains(&"src/auth.rs".to_string()));
        assert!(generated.note.source_paths.contains(&"src/other.rs".to_string()));
    }

    #[test]
    fn slug_from_title_handles_special_chars() {
        assert_eq!(slug_from_title("Hello, World!"), "hello-world");
        assert_eq!(slug_from_title("Foo (bar) baz"), "foo-bar-baz");
        assert_eq!(slug_from_title("UPPER lower 123"), "upper-lower-123");
        assert_eq!(slug_from_title("multiple   spaces"), "multiple-spaces");
        assert_eq!(slug_from_title("---leading-and-trailing---"), "leading-and-trailing");
    }

    #[tokio::test]
    async fn large_diff_is_truncated_in_payload() {
        let big_diff = "x".repeat(50_000);
        let mut c = commit();
        c.files[0].diff_text = big_diff;
        let llm = MockLlmClient::new();
        llm.enqueue_ok(
            r#"{"title":"t","id_slug":"t","body":"b","tags":[]}"#,
            5,
            2,
        );
        let _ = generate(&llm, "k", &cfg(), &c, NoteType::Decision).await.unwrap();
        // Inspect what the mock saw:
        let calls = llm.calls();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].user_prompt.contains("diff truncated"));
        assert!(calls[0].user_prompt.len() < 50_000 + 2_000); // some scaffolding
    }
}
