//! v1.5.0 Phase 1 — usage statistics for the Settings → Agents panel.
//!
//! The only stat surfaced today is the per-agent session-count split
//! over a recent window. CLI sessions are subscription-billed (Codex
//! via ChatGPT, Claude via Pro/Max or the metered Agent-SDK pool after
//! 15 Jun 2026), so there is no honest per-session dollar figure to
//! report — session count is the real, verifiable signal.

use crate::agents::claude_code::session::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageEntry {
    pub agent_id: String,
    pub session_count: u32,
}

/// Returns the session count per `agent_id` for sessions created within
/// the last `days` days. Powers the cost-transparency widget in
/// `AgentCostBreakdown.tsx`.
#[tauri::command(rename_all = "camelCase")]
pub async fn agent_usage_breakdown(
    state: State<'_, AppState>,
    days: i64,
) -> Result<Vec<AgentUsageEntry>, String> {
    let rows = state
        .database
        .agent_usage_breakdown(days)
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| AgentUsageEntry {
            agent_id: r.agent_id,
            session_count: r.session_count,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use crate::test_helpers::test_db;

    #[test]
    fn agent_usage_breakdown_groups_by_agent_id() {
        let db = test_db();
        let now = chrono::Utc::now().to_rfc3339();

        // 3 claude_code, 2 codex — all "now" so inside any window.
        for i in 0..3 {
            db.insert_session(
                &format!("c{i}"), "claude session", "/p", "closed",
                &now, None, 0, "claude_code",
            )
            .unwrap();
        }
        for i in 0..2 {
            db.insert_session(
                &format!("x{i}"), "codex session", "/p", "closed",
                &now, None, 0, "codex",
            )
            .unwrap();
        }

        let rows = db.agent_usage_breakdown(7).unwrap();
        let claude = rows.iter().find(|r| r.agent_id == "claude_code").unwrap();
        let codex = rows.iter().find(|r| r.agent_id == "codex").unwrap();
        assert_eq!(claude.session_count, 3);
        assert_eq!(codex.session_count, 2);
    }

    #[test]
    fn agent_usage_breakdown_excludes_sessions_outside_the_window() {
        let db = test_db();

        let old = (chrono::Utc::now() - chrono::Duration::days(60)).to_rfc3339();
        let recent = chrono::Utc::now().to_rfc3339();

        db.insert_session("old", "s", "/p", "closed", &old, None, 0, "codex")
            .unwrap();
        db.insert_session("new", "s", "/p", "closed", &recent, None, 0, "codex")
            .unwrap();

        // 7-day window excludes the 60-day-old session.
        let rows = db.agent_usage_breakdown(7).unwrap();
        let codex = rows.iter().find(|r| r.agent_id == "codex").unwrap();
        assert_eq!(codex.session_count, 1);
    }
}
