use crate::changelog::summarizer::{self, SummarizeRequest};
use crate::claude::session::AppState;
use crate::commands::settings;
use log::error;
use serde::Serialize;
use tauri::State;

/// Ensure the model is valid for the given provider. If not, return the first valid model.
fn validate_model_for_provider(provider: &str, model: &str) -> String {
    let valid_models: &[&str] = match provider {
        "gemini" => &["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview"],
        "openai" => &["gpt-4.1", "gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"],
        "anthropic" => &["claude-sonnet-4-6", "claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-opus-4-6"],
        _ => &[],
    };
    if valid_models.contains(&model) {
        model.to_string()
    } else {
        valid_models.first().unwrap_or(&model).to_string()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogEntry {
    pub id: String,
    pub session_id: String,
    pub timestamp: String,
    pub headline: String,
    pub description: String,
    pub category: String,
    pub files_changed: Vec<String>,
    pub turn_index: i32,
    pub technical_details: String,
    pub tools_summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChangelogEntry {
    pub id: String,
    pub session_id: String,
    pub session_name: String,
    pub timestamp: String,
    pub headline: String,
    pub description: String,
    pub category: String,
    pub files_changed: Vec<String>,
    pub turn_index: i32,
    pub technical_details: String,
    pub tools_summary: String,
}

#[tauri::command]
pub async fn generate_changelog_entry(
    state: State<'_, AppState>,
    session_id: String,
    user_prompt: String,
    assistant_summary: String,
    tools_used: Vec<String>,
    session_mode: String,
) -> Result<ChangelogEntry, String> {
    // Read settings to get provider + key
    let app_settings = settings::get_settings()?;
    if !app_settings.changelog_enabled {
        return Err("Changelog is disabled".to_string());
    }

    let provider = &app_settings.changelog_provider;
    let model = validate_model_for_provider(provider, &app_settings.changelog_model);
    let api_key = app_settings
        .api_keys
        .get(provider)
        .cloned()
        .unwrap_or_default();

    if api_key.is_empty() {
        return Err(format!("No API key configured for {}", provider));
    }

    // Extract file paths from tools_used ("Write: /src/App.tsx" -> "/src/App.tsx")
    let files_changed: Vec<String> = tools_used
        .iter()
        .filter_map(|t| {
            t.split_once(": ").map(|(_, path)| path.to_string())
        })
        .filter(|p| !p.is_empty() && !p.starts_with("cd ") && p.contains('/'))
        .collect();

    let request = SummarizeRequest {
        user_prompt,
        assistant_summary,
        tools_used,
        session_mode,
    };

    let custom_prompt = if app_settings.changelog_prompt.trim().is_empty() {
        None
    } else {
        Some(app_settings.changelog_prompt.as_str())
    };
    let response = summarizer::summarize_turn(provider, &api_key, &model, &request, custom_prompt).await;

    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().to_rfc3339();

    // Log the API call regardless of success/failure
    {
        let (success, error_msg, input_tokens, output_tokens) = match &response {
            Ok(r) => (true, None, r.input_tokens, r.output_tokens),
            Err(e) => (false, Some(e.clone()), 0, 0),
        };
        let cost = if let Some(pricing) = app_settings.model_pricing.get(&model) {
            (input_tokens as f64 / 1_000_000.0 * pricing.input)
                + (output_tokens as f64 / 1_000_000.0 * pricing.output)
        } else {
            0.0
        };
        let log_id = uuid::Uuid::new_v4().to_string();
        let db = &state.database;
        if let Err(e) = db.insert_api_log(
            &log_id,
            &timestamp,
            provider,
            &model,
            &session_id,
            input_tokens,
            output_tokens,
            cost,
            success,
            error_msg.as_deref(),
        ) {
            error!("Failed to insert API log entry: {}", e);
        }
    }

    let response = response?;

    // Get turn index for this session
    let turn_index = {
        let db = &state.database;
        let entries = db.list_changelog_entries(&session_id).map_err(|e| e.to_string())?;
        entries.len() as i32
    };

    let files_json = serde_json::to_string(&files_changed).unwrap_or_else(|_| "[]".to_string());

    // Persist to database
    {
        let db = &state.database;
        db.insert_changelog_entry(
            &id,
            &session_id,
            &timestamp,
            &response.headline,
            &response.description,
            &response.category,
            &files_json,
            turn_index,
            &response.technical_details,
            &response.tools_summary,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(ChangelogEntry {
        id,
        session_id,
        timestamp,
        headline: response.headline,
        description: response.description,
        category: response.category,
        files_changed,
        turn_index,
        technical_details: response.technical_details,
        tools_summary: response.tools_summary,
    })
}

#[tauri::command]
pub async fn get_changelog_entries(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ChangelogEntry>, String> {
    let db = &state.database;
    let rows = db.list_changelog_entries(&session_id).map_err(|e| e.to_string())?;

    let entries = rows
        .into_iter()
        .map(|row| {
            let files_changed: Vec<String> =
                serde_json::from_str(&row.files_changed).unwrap_or_default();
            ChangelogEntry {
                id: row.id,
                session_id: row.session_id,
                timestamp: row.timestamp,
                headline: row.headline,
                description: row.description,
                category: row.category,
                files_changed,
                turn_index: row.turn_index,
                technical_details: row.technical_details,
                tools_summary: row.tools_summary,
            }
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn delete_changelog_entry(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<(), String> {
    let db = &state.database;
    db.delete_changelog_entry(&entry_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_project_changelog_entries(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Vec<ProjectChangelogEntry>, String> {
    let db = &state.database;
    let rows = db
        .list_changelog_entries_by_project(&project_path)
        .map_err(|e| e.to_string())?;

    let entries = rows
        .into_iter()
        .map(|row| {
            let files_changed: Vec<String> =
                serde_json::from_str(&row.files_changed).unwrap_or_default();
            ProjectChangelogEntry {
                id: row.id,
                session_id: row.session_id,
                session_name: row.session_name,
                timestamp: row.timestamp,
                headline: row.headline,
                description: row.description,
                category: row.category,
                files_changed,
                turn_index: row.turn_index,
                technical_details: row.technical_details,
                tools_summary: row.tools_summary,
            }
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn test_changelog_api_key(
    provider: String,
    api_key: String,
    model: String,
) -> Result<bool, String> {
    summarizer::test_api_key(&provider, &api_key, &model).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_model_for_provider ──

    #[test]
    fn valid_openai_model_accepted() {
        let result = validate_model_for_provider("openai", "gpt-4.1");
        assert_eq!(result, "gpt-4.1");
    }

    #[test]
    fn invalid_openai_model_returns_fallback() {
        let result = validate_model_for_provider("openai", "gpt-nonexistent");
        // Should return the first valid model for openai
        assert_eq!(result, "gpt-4.1");
    }

    #[test]
    fn valid_gemini_model_accepted() {
        let result = validate_model_for_provider("gemini", "gemini-2.5-flash");
        assert_eq!(result, "gemini-2.5-flash");
    }

    #[test]
    fn invalid_gemini_model_returns_fallback() {
        let result = validate_model_for_provider("gemini", "gemini-nonexistent");
        assert_eq!(result, "gemini-2.5-flash-lite");
    }

    #[test]
    fn valid_anthropic_model_accepted() {
        let result = validate_model_for_provider("anthropic", "claude-sonnet-4-6");
        assert_eq!(result, "claude-sonnet-4-6");
    }

    #[test]
    fn invalid_anthropic_model_returns_fallback() {
        let result = validate_model_for_provider("anthropic", "claude-nonexistent");
        assert_eq!(result, "claude-sonnet-4-6");
    }

    #[test]
    fn empty_model_string_returns_fallback() {
        let result = validate_model_for_provider("openai", "");
        assert_eq!(result, "gpt-4.1");
    }

    #[test]
    fn unknown_provider_returns_model_as_is() {
        // Unknown provider has empty valid_models list, so first().unwrap_or(&model) returns model
        let result = validate_model_for_provider("unknown-provider", "some-model");
        assert_eq!(result, "some-model");
    }

    #[test]
    fn openai_default_is_gpt_4_1() {
        // The first model in the openai list is the default fallback
        let result = validate_model_for_provider("openai", "invalid");
        assert_eq!(result, "gpt-4.1");
    }

    #[test]
    fn gemini_default_is_flash_lite() {
        let result = validate_model_for_provider("gemini", "invalid");
        assert_eq!(result, "gemini-2.5-flash-lite");
    }

    #[test]
    fn anthropic_default_is_sonnet() {
        let result = validate_model_for_provider("anthropic", "invalid");
        assert_eq!(result, "claude-sonnet-4-6");
    }
}
