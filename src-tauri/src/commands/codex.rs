//! Codex management commands — config, MCP, and account, driven through
//! the app-server's JSON-RPC methods (not brittle `codex <subcommand>`
//! argv).
//!
//! Each handle-based command looks up the live `CodexProcessHandle` in
//! `AppState.processes` and calls the generic `codex_rpc` passthrough.
//! That keeps this layer version-resilient: a new Codex management method
//! needs only a new thin command here + a frontend wrapper, never an
//! adapter change. `codex_rpc` maps `-32601` (method not found on this
//! binary) to `CapabilityNotSupported`, so the UI can fall back to
//! [`codex_open_config_toml`] — which needs no app-server at all.
//!
//! See plan §D. Codex has no `config` subcommand and `codex mcp`/`plugin`
//! require a subcommand, so the old PTY-overlay approach was broken; this
//! replaces it.

use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::agents::claude_code::session::AppState;
use crate::agents::codex::{mcp_config, spawn};

/// Call a Codex management JSON-RPC method on the session's live handle.
async fn rpc(
    state: &State<'_, AppState>,
    session_id: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let processes = state.processes.lock().await;
    let process = processes
        .get(session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    process
        .codex_rpc(method.to_string(), params)
        .await
        .map_err(|e| e.to_string())
}

/// `config/read` — the live, merged Codex config (`additionalProperties`,
/// so render generically). `include_layers` adds per-layer provenance.
#[tauri::command(rename_all = "camelCase")]
pub async fn codex_read_config(
    state: State<'_, AppState>,
    session_id: String,
    include_layers: bool,
) -> Result<Value, String> {
    let params = spawn::build_config_read_params(None, include_layers);
    rpc(&state, &session_id, "config/read", params).await
}

/// `config/value/write` — write a single config key. `merge_strategy` is
/// `"replace"` (scalars) or `"upsert"` (nested maps).
#[tauri::command(rename_all = "camelCase")]
pub async fn codex_write_config_value(
    state: State<'_, AppState>,
    session_id: String,
    key_path: String,
    value: Value,
    merge_strategy: String,
    expected_version: Option<String>,
) -> Result<Value, String> {
    let params = spawn::build_config_write_params(
        &key_path,
        value,
        &merge_strategy,
        expected_version.as_deref(),
    );
    rpc(&state, &session_id, "config/value/write", params).await
}

/// `mcpServerStatus/list` — the authoritative runtime view of MCP servers
/// (auth status + loaded tools). Paginates `nextCursor` and accumulates.
#[tauri::command(rename_all = "camelCase")]
pub async fn codex_list_mcp_status(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    let mut all: Vec<Value> = Vec::new();
    let mut params = spawn::build_mcp_status_params();
    loop {
        let resp = rpc(&state, &session_id, "mcpServerStatus/list", params.clone()).await?;
        if let Some(arr) = resp.get("data").and_then(|d| d.as_array()) {
            all.extend(arr.iter().cloned());
        }
        match resp.get("nextCursor").and_then(|c| c.as_str()) {
            Some(cursor) if !cursor.is_empty() => {
                // Re-issue with the cursor; keep detail.
                let mut m = serde_json::Map::new();
                m.insert("detail".into(), Value::String("full".into()));
                m.insert("cursor".into(), Value::String(cursor.to_string()));
                params = Value::Object(m);
            }
            _ => break,
        }
    }
    Ok(serde_json::json!({ "data": all }))
}

/// `config/mcpServer/reload` — best-effort reload of MCP servers from
/// config. Unsupported on older binaries → surfaces as an error the panel
/// can ignore.
#[tauri::command(rename_all = "camelCase")]
pub async fn codex_reload_mcp(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    rpc(&state, &session_id, "config/mcpServer/reload", serde_json::json!({})).await
}

/// `account/read` — who is currently logged in.
#[tauri::command(rename_all = "camelCase")]
pub async fn codex_account(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    rpc(&state, &session_id, "account/read", serde_json::json!({})).await
}

/// `account/login/start` — begin a login flow. Defaults to ChatGPT
/// streamlined login. If the response carries an `authUrl`, open it in the
/// browser. Returns the raw response (device-code flows carry a
/// `userCode` + `verificationUrl` the panel shows).
#[tauri::command(rename_all = "camelCase")]
pub async fn codex_login(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    login_type: Option<Value>,
) -> Result<Value, String> {
    let params = login_type.unwrap_or_else(|| serde_json::json!({ "type": "chatgpt" }));
    let resp = rpc(&state, &session_id, "account/login/start", params).await?;
    if let Some(url) = resp.get("authUrl").and_then(|u| u.as_str()) {
        let _ = app_handle.opener().open_url(url.to_string(), None::<&str>);
    } else if let Some(url) = resp.get("verificationUrl").and_then(|u| u.as_str()) {
        let _ = app_handle.opener().open_url(url.to_string(), None::<&str>);
    }
    Ok(resp)
}

/// `account/logout` — sign out of Codex.
#[tauri::command(rename_all = "camelCase")]
pub async fn codex_logout(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    rpc(&state, &session_id, "account/logout", serde_json::json!({})).await
}

/// Always-works fallback: open `~/.codex/config.toml` in the user's editor.
/// Needs no app-server, so it works even when the binary lacks the config
/// JSON-RPC methods (or no session is live). Creates an empty file first
/// if it doesn't exist so the editor opens cleanly.
#[tauri::command]
pub async fn codex_open_config_toml(app_handle: AppHandle) -> Result<(), String> {
    let path = mcp_config::config_path();
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        std::fs::write(&path, "# Codex configuration\n")
            .map_err(|e| format!("Failed to create {}: {e}", path.display()))?;
    }
    app_handle
        .opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open config.toml: {e}"))
}
