use crate::claude::session::AppState;
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
