//! Shared test helpers for the CodeMantis Rust backend.
//!
//! Usage: These helpers are available in any `#[cfg(test)]` module
//! via `use crate::test_helpers::*`.

use crate::agents::AgentId;
use crate::claude::session::{AppState, SessionInfo, SessionStatus};
use crate::storage::Database;
use chrono::Utc;

/// Create a fresh in-memory database with all migrations applied.
pub fn test_db() -> Database {
    Database::new(":memory:").expect("Failed to create test database")
}

/// Create a database pre-populated with N sessions.
pub fn test_db_with_sessions(count: usize) -> Database {
    let db = test_db();
    for i in 0..count {
        db.insert_session(
            &format!("session-{}", i),
            &format!("Session {}", i),
            &format!("/tmp/project-{}", i),
            "connected",
            &format!("2026-01-{:02}T00:00:00Z", (i % 28) + 1),
            Some("claude-sonnet-4-6"),
            (i % 10) as i32,
        )
        .expect("Failed to insert test session");
    }
    db
}

/// Create an AppState with an in-memory database (no sessions).
pub fn test_app_state() -> AppState {
    let db = test_db();
    AppState::new(db)
}

/// Create an AppState with one pre-configured session.
pub async fn test_app_state_with_session(session_id: &str, project_path: &str) -> AppState {
    let state = test_app_state();
    let info = SessionInfo {
        id: session_id.to_string(),
        agent_id: AgentId::ClaudeCode,
        name: "Test Session".to_string(),
        project_path: project_path.to_string(),
        status: SessionStatus::Connected,
        created_at: Utc::now(),
        model: Some("claude-sonnet-4-6".to_string()),
        icon_index: 0,
    };
    state
        .sessions
        .lock()
        .await
        .insert(session_id.to_string(), info);
    state
}

/// Build a sample SessionInfo for testing.
pub fn sample_session_info(id: &str) -> SessionInfo {
    SessionInfo {
        id: id.to_string(),
        agent_id: AgentId::ClaudeCode,
        name: format!("Session {}", id),
        project_path: "/tmp/test-project".to_string(),
        status: SessionStatus::Connected,
        created_at: Utc::now(),
        model: Some("claude-sonnet-4-6".to_string()),
        icon_index: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_creates_successfully() {
        let db = test_db();
        // Verify we can query — should not panic
        let sessions = db.list_sessions().unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn test_db_with_sessions_creates_correct_count() {
        let db = test_db_with_sessions(5);
        let sessions = db.list_sessions().unwrap();
        assert_eq!(sessions.len(), 5);
    }

    #[tokio::test]
    async fn test_app_state_with_session_creates_state() {
        let state = test_app_state_with_session("s1", "/tmp/project").await;
        let sessions = state.sessions.lock().await;
        assert!(sessions.contains_key("s1"));
        assert_eq!(sessions["s1"].project_path, "/tmp/project");
    }

    #[test]
    fn sample_session_info_has_correct_fields() {
        let info = sample_session_info("test-1");
        assert_eq!(info.id, "test-1");
        assert_eq!(info.status, SessionStatus::Connected);
        assert!(info.model.is_some());
    }
}
