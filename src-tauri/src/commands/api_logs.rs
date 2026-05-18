use crate::agents::claude_code::session::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLogEntry {
    pub id: String,
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub session_id: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub success: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCost {
    pub provider: String,
    pub cost: f64,
    pub calls: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCostSummary {
    pub total_cost: f64,
    pub total_calls: u32,
    pub by_provider: Vec<ProviderCost>,
}

#[tauri::command]
pub async fn get_api_logs(
    state: State<'_, AppState>,
) -> Result<Vec<ApiLogEntry>, String> {
    let db = &state.database;
    let rows = db.list_api_logs().map_err(|e| e.to_string())?;

    let entries = rows
        .into_iter()
        .map(|row| ApiLogEntry {
            id: row.id,
            timestamp: row.timestamp,
            provider: row.provider,
            model: row.model,
            session_id: row.session_id,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            cost_usd: row.cost_usd,
            success: row.success,
            error_message: row.error_message,
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn get_api_cost_summary(
    state: State<'_, AppState>,
) -> Result<ApiCostSummary, String> {
    let db = &state.database;
    let summary = db.get_api_cost_summary().map_err(|e| e.to_string())?;

    Ok(ApiCostSummary {
        total_cost: summary.total_cost,
        total_calls: summary.total_calls,
        by_provider: summary
            .by_provider
            .into_iter()
            .map(|p| ProviderCost {
                provider: p.provider,
                cost: p.cost,
                calls: p.calls,
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn cleanup_api_logs(
    state: State<'_, AppState>,
    max_age_days: u32,
) -> Result<u32, String> {
    let db = &state.database;
    db.delete_old_api_logs(max_age_days).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_db;

    fn insert_test_log(db: &crate::storage::Database, id: &str, provider: &str, model: &str) {
        db.insert_api_log(
            id,
            "2020-06-15T10:00:00Z",
            provider,
            model,
            "session-1",
            100,
            200,
            0.005,
            true,
            None,
        )
        .expect("insert_api_log should succeed");
    }

    // ── list_api_logs ──────────────────────────────────────────────────────

    #[test]
    fn test_list_api_logs_returns_inserted_entry_with_correct_fields() {
        let db = test_db();
        db.insert_api_log(
            "log-1",
            "2020-06-15T10:00:00Z",
            "anthropic",
            "claude-sonnet-4-6",
            "session-abc",
            150,
            300,
            0.012,
            true,
            None,
        )
        .unwrap();

        let logs = db.list_api_logs().unwrap();
        assert_eq!(logs.len(), 1);
        let entry = &logs[0];
        assert_eq!(entry.id, "log-1");
        assert_eq!(entry.provider, "anthropic");
        assert_eq!(entry.model, "claude-sonnet-4-6");
        assert_eq!(entry.session_id, "session-abc");
        assert_eq!(entry.input_tokens, 150);
        assert_eq!(entry.output_tokens, 300);
        assert!((entry.cost_usd - 0.012).abs() < 1e-9);
        assert!(entry.success);
        assert!(entry.error_message.is_none());
    }

    #[test]
    fn test_list_api_logs_returns_error_message_when_set() {
        let db = test_db();
        db.insert_api_log(
            "log-err",
            "2020-06-15T10:00:00Z",
            "openai",
            "gpt-4o",
            "session-xyz",
            10,
            0,
            0.0,
            false,
            Some("rate limit exceeded"),
        )
        .unwrap();

        let logs = db.list_api_logs().unwrap();
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].success);
        assert_eq!(logs[0].error_message.as_deref(), Some("rate limit exceeded"));
    }

    #[test]
    fn test_list_api_logs_empty_on_fresh_database() {
        let db = test_db();
        let logs = db.list_api_logs().unwrap();
        assert!(logs.is_empty());
    }

    // ── get_api_cost_summary ───────────────────────────────────────────────

    #[test]
    fn test_get_api_cost_summary_groups_by_provider_correctly() {
        let db = test_db();
        insert_test_log(&db, "a1", "anthropic", "claude-sonnet-4-6");
        insert_test_log(&db, "a2", "anthropic", "claude-haiku-3-5");
        insert_test_log(&db, "o1", "openai", "gpt-4o");

        let summary = db.get_api_cost_summary().unwrap();
        assert_eq!(summary.total_calls, 3);
        assert!((summary.total_cost - 0.015).abs() < 1e-6);

        // Providers are ordered alphabetically
        assert_eq!(summary.by_provider.len(), 2);
        let anthropic = summary.by_provider.iter().find(|p| p.provider == "anthropic").unwrap();
        assert_eq!(anthropic.calls, 2);
        assert!((anthropic.cost - 0.010).abs() < 1e-6);

        let openai = summary.by_provider.iter().find(|p| p.provider == "openai").unwrap();
        assert_eq!(openai.calls, 1);
        assert!((openai.cost - 0.005).abs() < 1e-9);
    }

    #[test]
    fn test_get_api_cost_summary_returns_zero_totals_when_no_logs() {
        let db = test_db();
        let summary = db.get_api_cost_summary().unwrap();
        assert_eq!(summary.total_calls, 0);
        assert!((summary.total_cost).abs() < 1e-9);
        assert!(summary.by_provider.is_empty());
    }

    // ── delete_old_api_logs ────────────────────────────────────────────────

    #[test]
    fn test_delete_old_api_logs_with_zero_days_removes_all_past_logs() {
        let db = test_db();
        insert_test_log(&db, "log-1", "anthropic", "claude-sonnet-4-6");
        insert_test_log(&db, "log-2", "openai", "gpt-4o");

        // max_age_days = 0 → cutoff is now; all past-timestamped logs are deleted
        let deleted = db.delete_old_api_logs(0).unwrap();
        assert_eq!(deleted, 2);

        let remaining = db.list_api_logs().unwrap();
        assert!(remaining.is_empty());
    }

    #[test]
    fn test_delete_old_api_logs_with_large_max_age_keeps_all_logs() {
        let db = test_db();
        insert_test_log(&db, "log-keep", "anthropic", "claude-sonnet-4-6");

        // 36500 days = 100 years; nothing should be deleted
        let deleted = db.delete_old_api_logs(36500).unwrap();
        assert_eq!(deleted, 0);

        let remaining = db.list_api_logs().unwrap();
        assert_eq!(remaining.len(), 1);
    }

    // ── serde serialization ────────────────────────────────────────────────

    #[test]
    fn test_api_log_entry_serializes_with_camel_case_field_names() {
        let entry = ApiLogEntry {
            id: "log-1".to_string(),
            timestamp: "2020-06-15T10:00:00Z".to_string(),
            provider: "anthropic".to_string(),
            model: "claude-sonnet-4-6".to_string(),
            session_id: "session-1".to_string(),
            input_tokens: 100,
            output_tokens: 200,
            cost_usd: 0.005,
            success: true,
            error_message: None,
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"sessionId\""), "expected camelCase sessionId");
        assert!(json.contains("\"inputTokens\""), "expected camelCase inputTokens");
        assert!(json.contains("\"outputTokens\""), "expected camelCase outputTokens");
        assert!(json.contains("\"costUsd\""), "expected camelCase costUsd");
        assert!(json.contains("\"errorMessage\""), "expected camelCase errorMessage");
        assert!(!json.contains("\"session_id\""), "snake_case must not appear");
    }

    #[test]
    fn test_api_cost_summary_serializes_with_camel_case_field_names() {
        let summary = ApiCostSummary {
            total_cost: 0.05,
            total_calls: 10,
            by_provider: vec![ProviderCost {
                provider: "anthropic".to_string(),
                cost: 0.05,
                calls: 10,
            }],
        };

        let json = serde_json::to_string(&summary).unwrap();
        assert!(json.contains("\"totalCost\""), "expected camelCase totalCost");
        assert!(json.contains("\"totalCalls\""), "expected camelCase totalCalls");
        assert!(json.contains("\"byProvider\""), "expected camelCase byProvider");
        assert!(!json.contains("\"total_cost\""), "snake_case must not appear");
    }
}
