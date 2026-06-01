//! Mid-run tripwire (RECALL-SPEC §6.2).
//!
//! When `Recall mode = Enforced`, watch the agent's tool-call stream.
//! If the agent's next tool call (file read/write/edit) touches a path
//! that **was not in the initial brief but does have associated notes**,
//! inject those notes as a system message before the tool call
//! executes. Deterministic match on path — no LLM in the watcher.
//!
//! Agent-agnostic: subscribes to [`NormalizedEvent::ToolUseStart`]
//! which is the unified shape both Claude Code and Codex emit. Codex's
//! `fileChange` / `imageView` / `commandExecution` items are
//! normalized into the same tool-name + tool-input vocabulary at
//! `src/agents/codex/translation.rs`, so this watcher reads from one
//! channel without agent-specific branching.
//!
//! Per-session injection log prevents the same path from being
//! re-injected on every tool call (e.g., five reads of the same file
//! → one injection).

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::agents::NormalizedEvent;
use crate::recall::index::query::{notes_by_path_overlap, IndexedNote};
use crate::recall::RecallError;
use crate::storage::Database;

/// Tool names we care about for the tripwire — the file-touch
/// vocabulary that both adapters normalize into.
fn is_file_touch_tool(name: &str) -> bool {
    matches!(name, "Read" | "Write" | "Edit" | "MultiEdit")
}

/// Result of observing one event. `None` = no tripwire (either not a
/// file-touch event, no path extractable, or all notes already injected
/// in this session).
#[derive(Debug, Clone)]
pub struct TripwireInjection {
    pub session_id: String,
    pub path: String,
    pub notes: Vec<IndexedNote>,
}

/// Per-vault state. One watcher serves all active sessions on the
/// same project vault; the per-session injection log is internal.
pub struct StreamWatcher {
    vault_id: i64,
    /// session_id → set of paths already injected
    seen: Mutex<HashMap<String, HashSet<String>>>,
}

impl StreamWatcher {
    pub fn new(vault_id: i64) -> Self {
        Self {
            vault_id,
            seen: Mutex::new(HashMap::new()),
        }
    }

    /// Observe one event. Returns a [`TripwireInjection`] when:
    /// 1. The event is `ToolUseStart` for a Read/Write/Edit/MultiEdit
    ///    tool,
    /// 2. The tool_input contains an extractable `file_path` / `path`,
    /// 3. At least one indexed note's `source_paths` overlaps that
    ///    file path,
    /// 4. The same path hasn't already been injected for this session.
    pub fn observe(
        &self,
        db: &Database,
        event: &NormalizedEvent,
    ) -> Result<Option<TripwireInjection>, RecallError> {
        let NormalizedEvent::ToolUseStart {
            session_id,
            tool_name,
            tool_input,
            ..
        } = event
        else {
            return Ok(None);
        };
        if !is_file_touch_tool(tool_name) {
            return Ok(None);
        }
        let Some(path) = extract_path(tool_input) else {
            return Ok(None);
        };

        // Have we already injected for (session, path)?
        {
            let mut seen = self.seen.lock().unwrap();
            let entry = seen.entry(session_id.clone()).or_default();
            if entry.contains(&path) {
                return Ok(None);
            }
            entry.insert(path.clone());
        }

        let notes = notes_by_path_overlap(db, self.vault_id, std::slice::from_ref(&path), 5)?;
        if notes.is_empty() {
            return Ok(None);
        }

        Ok(Some(TripwireInjection {
            session_id: session_id.clone(),
            path,
            notes,
        }))
    }

    /// Pre-load the per-session seen set with paths that were already
    /// in the initial brief. Prevents the watcher from re-injecting a
    /// note that the user already received pre-prompt.
    pub fn mark_already_briefed(&self, session_id: &str, paths: &[String]) {
        let mut seen = self.seen.lock().unwrap();
        let entry = seen.entry(session_id.to_string()).or_default();
        for p in paths {
            entry.insert(p.clone());
        }
    }

    /// Drop a session's seen set (e.g. when the session ends).
    pub fn forget_session(&self, session_id: &str) {
        self.seen.lock().unwrap().remove(session_id);
    }
}

/// Pull a file path out of a tool_input JSON value. The two adapters
/// use slightly different field names — Claude Code uses `file_path`
/// for Read/Edit/Write; Codex uses `path` (via the fileChange
/// translation) and `file_path` (via the imageView translation). We
/// try both.
fn extract_path(input: &serde_json::Value) -> Option<String> {
    if let Some(s) = input.get("file_path").and_then(|v| v.as_str()) {
        return Some(s.to_string());
    }
    if let Some(s) = input.get("path").and_then(|v| v.as_str()) {
        return Some(s.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::AgentId;
    use crate::recall::index::ingest::ingest_note;
    use crate::recall::index::{ensure_vault_row, test_helpers::*};
    use crate::recall::vault::{Note, NoteType, Status, Trust};
    use chrono::NaiveDate;

    fn make_note(id: &str, paths: &[&str]) -> Note {
        Note {
            id: id.to_string(),
            note_type: NoteType::Landmine,
            project: Some("proj".to_string()),
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
            title: format!("Note {}", id),
            body: "body".to_string(),
            file_path: None,
        }
    }

    fn tool_use(session: &str, tool: &str, path_field: &str, path: &str) -> NormalizedEvent {
        NormalizedEvent::ToolUseStart {
            agent_id: AgentId::ClaudeCode,
            session_id: session.to_string(),
            tool_use_id: "u1".to_string(),
            tool_name: tool.to_string(),
            tool_input: serde_json::json!({ path_field: path }),
        }
    }

    fn setup() -> (std::sync::Arc<crate::storage::Database>, i64, StreamWatcher) {
        let db = fresh_db();
        let project = dummy_project_path();
        let vault_id = ensure_vault_row(&db, &project, &project.join(".recall"), false).unwrap();
        (db.clone(), vault_id, StreamWatcher::new(vault_id))
    }

    #[test]
    fn read_event_on_path_with_note_returns_injection() {
        let (db, vault_id, watcher) = setup();
        let note = make_note("l1", &["src/credentials.ts"]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        let event = tool_use("s1", "Read", "file_path", "src/credentials.ts");
        let injection = watcher.observe(&db, &event).unwrap().unwrap();
        assert_eq!(injection.session_id, "s1");
        assert_eq!(injection.path, "src/credentials.ts");
        assert_eq!(injection.notes.len(), 1);
    }

    #[test]
    fn duplicate_event_for_same_session_path_returns_none() {
        let (db, vault_id, watcher) = setup();
        let note = make_note("l1", &["src/x.rs"]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        let event = tool_use("s1", "Read", "file_path", "src/x.rs");
        assert!(watcher.observe(&db, &event).unwrap().is_some());
        assert!(
            watcher.observe(&db, &event).unwrap().is_none(),
            "second observation of same (session, path) should not re-inject"
        );
    }

    #[test]
    fn same_path_different_sessions_each_get_injection() {
        let (db, vault_id, watcher) = setup();
        let note = make_note("l1", &["src/x.rs"]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        let ev1 = tool_use("s1", "Read", "file_path", "src/x.rs");
        let ev2 = tool_use("s2", "Read", "file_path", "src/x.rs");
        assert!(watcher.observe(&db, &ev1).unwrap().is_some());
        assert!(watcher.observe(&db, &ev2).unwrap().is_some());
    }

    #[test]
    fn write_and_edit_events_also_trip() {
        let (db, vault_id, watcher) = setup();
        let note = make_note("l1", &["src/x.rs"]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        let w = tool_use("s1", "Write", "file_path", "src/x.rs");
        let e = tool_use("s2", "Edit", "path", "src/x.rs"); // codex-style "path" field
        assert!(watcher.observe(&db, &w).unwrap().is_some());
        assert!(watcher.observe(&db, &e).unwrap().is_some());
    }

    #[test]
    fn bash_event_is_ignored() {
        let (db, vault_id, watcher) = setup();
        let note = make_note("l1", &["src/x.rs"]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        let event = NormalizedEvent::ToolUseStart {
            agent_id: AgentId::ClaudeCode,
            session_id: "s1".to_string(),
            tool_use_id: "u1".to_string(),
            tool_name: "Bash".to_string(),
            tool_input: serde_json::json!({"command": "cat src/x.rs"}),
        };
        assert!(watcher.observe(&db, &event).unwrap().is_none());
    }

    #[test]
    fn text_delta_event_is_ignored() {
        let (db, _vault_id, watcher) = setup();
        let event = NormalizedEvent::TextDelta {
            agent_id: AgentId::ClaudeCode,
            session_id: "s1".to_string(),
            text: "hello".to_string(),
        };
        assert!(watcher.observe(&db, &event).unwrap().is_none());
    }

    #[test]
    fn tool_input_without_path_returns_none() {
        let (db, _vault_id, watcher) = setup();
        let event = NormalizedEvent::ToolUseStart {
            agent_id: AgentId::ClaudeCode,
            session_id: "s1".to_string(),
            tool_use_id: "u1".to_string(),
            tool_name: "Read".to_string(),
            tool_input: serde_json::json!({}),
        };
        assert!(watcher.observe(&db, &event).unwrap().is_none());
    }

    #[test]
    fn path_with_no_matching_note_returns_none() {
        let (db, _vault_id, watcher) = setup();
        let event = tool_use("s1", "Read", "file_path", "src/no-note.rs");
        assert!(watcher.observe(&db, &event).unwrap().is_none());
    }

    #[test]
    fn mark_already_briefed_suppresses_first_injection() {
        let (db, vault_id, watcher) = setup();
        let note = make_note("l1", &["src/x.rs"]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        watcher.mark_already_briefed("s1", &["src/x.rs".to_string()]);
        let event = tool_use("s1", "Read", "file_path", "src/x.rs");
        assert!(
            watcher.observe(&db, &event).unwrap().is_none(),
            "path already in initial brief should not re-inject"
        );
    }

    #[test]
    fn forget_session_resets_seen_set() {
        let (db, vault_id, watcher) = setup();
        let note = make_note("l1", &["src/x.rs"]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        let event = tool_use("s1", "Read", "file_path", "src/x.rs");
        assert!(watcher.observe(&db, &event).unwrap().is_some());
        assert!(watcher.observe(&db, &event).unwrap().is_none());

        watcher.forget_session("s1");
        assert!(
            watcher.observe(&db, &event).unwrap().is_some(),
            "after forget_session, the same path should trip again"
        );
    }

    #[test]
    fn multi_edit_tool_also_trips() {
        let (db, vault_id, watcher) = setup();
        let note = make_note("l1", &["src/x.rs"]);
        ingest_note(&db, vault_id, &note, std::path::Path::new("notes/landmines/l1.md")).unwrap();

        let event = tool_use("s1", "MultiEdit", "file_path", "src/x.rs");
        assert!(watcher.observe(&db, &event).unwrap().is_some());
    }
}
