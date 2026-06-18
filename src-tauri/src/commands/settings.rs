use crate::storage::secret_box;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_send_shortcut")]
    pub send_shortcut: String,
    #[serde(default)]
    pub terminal_shell: Option<String>,
    #[serde(default = "default_terminal_font_size")]
    pub terminal_font_size: u32,
    #[serde(default = "default_quick_commands")]
    pub quick_commands: Vec<QuickCommand>,

    // --- Shared AI provider settings ---
    // `api_keys` is the wire-facing plaintext map exchanged with the frontend.
    // On disk, values live in `api_keys_encrypted` (AES-GCM ciphertext, base64).
    // Both are `default`-able for legacy compat and for clearing on serialize.
    #[serde(default, alias = "changelogApiKeys")]
    pub api_keys: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub api_keys_encrypted: HashMap<String, String>,
    #[serde(default = "default_model_pricing", alias = "changelogModelPricing")]
    pub model_pricing: HashMap<String, ModelPricing>,

    // --- Changelog-specific settings ---
    #[serde(default)]
    pub changelog_enabled: bool,
    #[serde(default = "default_changelog_provider")]
    pub changelog_provider: String,
    #[serde(default = "default_changelog_model")]
    pub changelog_model: String,
    #[serde(default = "default_changelog_prompt")]
    pub changelog_prompt: String,

    // --- Assistant settings ---
    #[serde(default)]
    pub assistant_shortcuts: Vec<AssistantShortcut>,
    #[serde(default = "default_assistant_provider")]
    pub assistant_default_provider: String,
    #[serde(default)]
    pub assistant_default_model: HashMap<String, String>,

    // --- Preview ---
    #[serde(default = "default_preview_width")]
    pub preview_default_width: u32,
    #[serde(default = "default_preview_height")]
    pub preview_default_height: u32,
    #[serde(default)]
    pub preview_auto_start: bool,
    #[serde(default)]
    pub preview_custom_dev_command: Option<String>,
    #[serde(default = "default_true")]
    pub preview_console_auto_open: bool,
    #[serde(default)]
    pub preview_last_urls: std::collections::HashMap<String, String>,

    // --- Task Board ---
    #[serde(default = "default_task_board_model")]
    pub task_board_planning_model: String,
    #[serde(default = "default_task_board_max_tokens")]
    pub task_board_max_tokens: u32,
    #[serde(default = "default_task_board_retries")]
    pub task_board_max_retries: u32,
    #[serde(default = "default_true")]
    pub task_board_auto_start_next: bool,
    #[serde(default = "default_true")]
    pub task_board_auto_open_slide_over: bool,

    // --- Trivia ---
    #[serde(default)]
    pub trivia_enabled: bool,

    // --- Context window ---
    #[serde(default = "default_context_window")]
    pub default_context_window: u64,

    // --- File viewer ---
    #[serde(default)]
    pub auto_open_files: bool,

    // --- Claude binary override ---
    #[serde(default)]
    pub claude_binary_override: Option<String>,

    // --- Onboarding ---
    #[serde(default)]
    pub onboarding_completed: bool,

    // --- API key banner ---
    #[serde(default)]
    pub api_key_banner_dismissed: bool,

    // --- Clone from GitHub ---
    #[serde(default)]
    pub last_clone_directory: Option<String>,

    // --- Session Logs ---
    #[serde(default = "default_true")]
    pub session_logs_enabled: bool,
    #[serde(default = "default_session_logs_retention_days")]
    pub session_logs_retention_days: u32,

    // --- Codex debug logging (raw JSON-RPC wire capture for troubleshooting) ---
    #[serde(default = "default_true")]
    pub codex_debug_logging_enabled: bool,

    // --- Codex auto-compaction threshold ---
    // Passed to `codex app-server` as `-c model_auto_compact_token_limit=N` so
    // Codex compacts EARLIER (smaller, faster context) than its near-full
    // default — its upstream compact request times out/drops on a ~240K
    // context. 0 = leave Codex's default. Default 180000 (~70% of the 258400
    // window) beats the ~5-min timeout while keeping most context per cycle.
    #[serde(default = "default_codex_auto_compact_token_limit")]
    pub codex_auto_compact_token_limit: u64,

    // --- Super-Bro ---
    #[serde(default = "default_true")]
    pub super_bro_enabled: bool,
    #[serde(default = "default_super_bro_provider")]
    pub super_bro_provider: String,
    #[serde(default = "default_super_bro_model")]
    pub super_bro_model: String,

    // --- Claude CLI: thinking effort override ---
    /// When set, baked into the inline `--settings` blob passed to the CLI on
    /// spawn (see `claude::process::build_session_settings_json`). Overrides
    /// whatever effort the user has in `~/.claude/settings.json`. None = let
    /// the CLI inherit its own config. Valid: "low" | "medium" | "high" |
    /// "xhigh". The CLI's runtime `set_effort` control_request is unsupported
    /// in v2.1.126 — runtime changes go through `set_max_thinking_tokens`
    /// (see `claude::session::ControlRequestKind::SetMaxThinkingTokens`).
    #[serde(default)]
    pub default_thinking_effort: Option<String>,

    // --- v1.5.0 Phase 1: per-task agent routing ---
    /// Sparse map of task-category → agent_id. A category absent from
    /// this map means "use the primary agent". Keys are TaskCategory
    /// strings ("main_chat", "spec_writer", …), values are AgentId
    /// strings ("claude_code" | "codex"). Empty by default so existing
    /// installs are unaffected. The frontend resolver
    /// (src/lib/agent-resolver.ts) is the only consumer.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub default_agent_by_task: HashMap<String, String>,

    // --- v1.5.0 Phase 3: /second-opinion privacy gate ---
    /// True once the user has acknowledged that `/second-opinion`
    /// sends recent chat content to the other local CLI.
    #[serde(default)]
    pub second_opinion_privacy_acknowledged: bool,

    // --- Recall (RECALL-SPEC §4.1) ---
    /// Project-and-cross-project memory layer config. Master `enabled`
    /// flag defaults to false; everything else inside has spec-default
    /// values that take effect once the user opts in. Phase 5 ships the
    /// settings UI; Phase 2 reads this struct via
    /// `recall::enricher::enrich_if_enabled` from `send_message`.
    #[serde(default)]
    pub recall: crate::recall::config::RecallConfig,

    // --- Duo-Coding (mentor/primary collaborative mode) ---
    /// Config for Duo-Coding runs. Master `enabled` defaults to false; the
    /// rest carry sensible defaults that apply once the user opts in. The
    /// orchestration lives in the frontend `duoStore`; this struct supplies
    /// the tie-break policy, dialogue/drift guards, analyst provider, and
    /// per-run budget caps. See `project_duo_coding` plan.
    #[serde(default)]
    pub duo: DuoCodingConfig,
}

/// Persisted configuration for Duo-Coding. `Default` is the opt-out baseline;
/// per-field serde defaults let partial JSON from older installs merge cleanly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuoCodingConfig {
    #[serde(default)]
    pub enabled: bool,
    /// "pause" (default) | "mentorWins" | "primaryWins".
    #[serde(default = "default_duo_tie_break")]
    pub tie_break_policy: String,
    #[serde(default = "default_duo_max_rounds")]
    pub max_dialogue_rounds: u32,
    #[serde(default = "default_true")]
    pub severe_drift_nudge_enabled: bool,
    /// Sensitivity of the mid-turn severe-drift watcher:
    /// "conservative" (default) | "balanced" | "aggressive".
    #[serde(default = "default_duo_drift_sensitivity")]
    pub severe_drift_sensitivity: String,
    #[serde(default = "default_true")]
    pub analyst_enabled: bool,
    #[serde(default = "default_changelog_provider")]
    pub analyst_provider: String,
    #[serde(default = "default_changelog_model")]
    pub analyst_model: String,
    /// Hard per-run USD cap; the run pauses when exceeded. None = no cap.
    #[serde(default)]
    pub budget_usd_cap: Option<f64>,
    /// Hard per-run output-token cap; the run pauses when exceeded. None = no cap.
    #[serde(default)]
    pub budget_token_cap: Option<u64>,
}

impl Default for DuoCodingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            tie_break_policy: default_duo_tie_break(),
            max_dialogue_rounds: default_duo_max_rounds(),
            severe_drift_nudge_enabled: true,
            severe_drift_sensitivity: default_duo_drift_sensitivity(),
            analyst_enabled: true,
            analyst_provider: default_changelog_provider(),
            analyst_model: default_changelog_model(),
            budget_usd_cap: None,
            budget_token_cap: None,
        }
    }
}

fn default_duo_tie_break() -> String {
    "pause".to_string()
}
fn default_duo_max_rounds() -> u32 {
    3
}
fn default_duo_drift_sensitivity() -> String {
    "conservative".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommand {
    pub label: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantShortcut {
    pub id: String,
    pub name: String,
    pub prompt: String,
}

fn default_codex_auto_compact_token_limit() -> u64 {
    180_000
}
fn default_theme() -> String {
    "sand".to_string()
}
fn default_font_size() -> u32 {
    13
}
fn default_send_shortcut() -> String {
    "cmd+enter".to_string()
}
fn default_terminal_font_size() -> u32 {
    13
}
fn default_changelog_provider() -> String {
    "gemini".to_string()
}
fn default_changelog_model() -> String {
    "gemini-2.5-flash-lite".to_string()
}
fn default_assistant_provider() -> String {
    "claude-code".to_string()
}
fn default_context_window() -> u64 {
    1_000_000
}
fn default_true() -> bool {
    true
}
fn default_preview_width() -> u32 {
    1024
}
fn default_preview_height() -> u32 {
    768
}
fn default_task_board_model() -> String {
    "gemini-3.5-flash".to_string()
}
fn default_task_board_max_tokens() -> u32 {
    64000
}
fn default_task_board_retries() -> u32 {
    3
}
fn default_model_pricing() -> HashMap<String, ModelPricing> {
    let mut m = HashMap::new();
    m.insert("gpt-5.4-mini".into(), ModelPricing { input: 0.75, output: 4.50 });
    m.insert("gpt-5.4".into(), ModelPricing { input: 2.50, output: 15.0 });
    m.insert("gpt-5.5".into(), ModelPricing { input: 5.0, output: 30.0 });
    m.insert("gemini-2.5-flash-lite".into(), ModelPricing { input: 0.10, output: 0.40 });
    m.insert("gemini-2.5-flash".into(), ModelPricing { input: 0.15, output: 0.60 });
    m.insert("gemini-3.1-flash-lite".into(), ModelPricing { input: 0.25, output: 1.50 });
    m.insert("gemini-3.5-flash".into(), ModelPricing { input: 1.50, output: 9.0 });
    m.insert("gemini-3.1-pro-preview".into(), ModelPricing { input: 1.25, output: 10.0 });
    m.insert("claude-opus-4-8".into(), ModelPricing { input: 5.0, output: 25.0 });
    m.insert("claude-sonnet-4-6".into(), ModelPricing { input: 3.0, output: 15.0 });
    m.insert("claude-haiku-4-5".into(), ModelPricing { input: 0.80, output: 4.0 });
    m
}
fn default_session_logs_retention_days() -> u32 {
    30
}
fn default_super_bro_provider() -> String {
    "auto".to_string()
}
fn default_super_bro_model() -> String {
    "auto".to_string()
}
fn default_changelog_prompt() -> String {
    r#"Summarize this coding session turn as a changelog entry. Return JSON only, markdown ONLY in the description field (5-6 sentences).
Make sure to briefly describe in general, what was changed, the most important topics.
Add the most important changes done.

Mandatory JSON format response format: {"headline":"max 80 chars","description":"5-6 sentences in markdown","category":"feature|bugfix|refactor|docs|config|test"}"#.to_string()
}
fn default_quick_commands() -> Vec<QuickCommand> {
    vec![
        QuickCommand { label: "Build".to_string(), command: "pnpm build".to_string() },
        QuickCommand { label: "Test".to_string(), command: "pnpm test".to_string() },
        QuickCommand { label: "Lint".to_string(), command: "pnpm lint".to_string() },
        QuickCommand { label: "Dev".to_string(), command: "pnpm dev".to_string() },
    ]
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            font_size: default_font_size(),
            send_shortcut: default_send_shortcut(),
            terminal_shell: None,
            terminal_font_size: default_terminal_font_size(),
            quick_commands: default_quick_commands(),
            api_keys: HashMap::new(),
            api_keys_encrypted: HashMap::new(),
            model_pricing: default_model_pricing(),
            changelog_enabled: false,
            changelog_provider: default_changelog_provider(),
            changelog_model: default_changelog_model(),
            changelog_prompt: default_changelog_prompt(),
            assistant_shortcuts: Vec::new(),
            assistant_default_provider: default_assistant_provider(),
            assistant_default_model: HashMap::new(),
            preview_default_width: default_preview_width(),
            preview_default_height: default_preview_height(),
            preview_auto_start: false,
            preview_custom_dev_command: None,
            preview_console_auto_open: true,
            preview_last_urls: std::collections::HashMap::new(),
            task_board_planning_model: default_task_board_model(),
            task_board_max_tokens: default_task_board_max_tokens(),
            task_board_max_retries: default_task_board_retries(),
            task_board_auto_start_next: true,
            task_board_auto_open_slide_over: true,
            default_context_window: default_context_window(),
            trivia_enabled: false,
            auto_open_files: false,
            claude_binary_override: None,
            onboarding_completed: false,
            api_key_banner_dismissed: false,
            last_clone_directory: None,
            session_logs_enabled: true,
            session_logs_retention_days: default_session_logs_retention_days(),
            codex_debug_logging_enabled: true,
            codex_auto_compact_token_limit: default_codex_auto_compact_token_limit(),
            super_bro_enabled: true,
            super_bro_provider: default_super_bro_provider(),
            super_bro_model: default_super_bro_model(),
            default_thinking_effort: None,
            default_agent_by_task: HashMap::new(),
            second_opinion_privacy_acknowledged: false,
            recall: crate::recall::config::RecallConfig::default(),
            duo: DuoCodingConfig::default(),
        }
    }
}

fn settings_path() -> PathBuf {
    crate::utils::paths::app_data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("settings.json")
}

/// Decrypt `api_keys_encrypted` into `api_keys` (plaintext for the wire).
/// Existing plaintext entries in `api_keys` (legacy / hand-edited) win over
/// any encrypted entry under the same provider — we never silently override
/// a value the user might have just written into the file.
/// Returns `true` if any plaintext entries were found that should be
/// migrated to ciphertext on the next save.
fn decrypt_api_keys_into_wire(settings: &mut AppSettings) -> Result<bool, String> {
    let mut had_plaintext_legacy = false;
    let encrypted = std::mem::take(&mut settings.api_keys_encrypted);
    let plaintext_legacy = std::mem::take(&mut settings.api_keys);

    let mut merged: HashMap<String, String> = HashMap::new();
    for (provider, blob_b64) in encrypted {
        match secret_box::decrypt_from_b64(&blob_b64) {
            Ok(plain) => {
                merged.insert(provider, plain);
            }
            Err(e) => {
                // A corrupted/unreadable ciphertext shouldn't kill all settings —
                // log and drop just this entry. The user will be asked to re-enter.
                log::warn!("decrypt failed for api key '{}': {}", provider, e);
            }
        }
    }
    for (provider, value) in plaintext_legacy {
        if !value.is_empty() {
            had_plaintext_legacy = true;
            merged.insert(provider, value);
        }
    }
    settings.api_keys = merged;
    Ok(had_plaintext_legacy)
}

/// Encrypt the wire `api_keys` map into `api_keys_encrypted`, blanking the
/// plaintext field before serialization. Empty values are dropped (we don't
/// persist empty cipher records — a missing key means "not set").
fn encrypt_api_keys_for_disk(settings: &mut AppSettings) -> Result<(), String> {
    let plaintext = std::mem::take(&mut settings.api_keys);
    let mut encrypted: HashMap<String, String> = HashMap::new();
    for (provider, value) in plaintext {
        if value.is_empty() {
            continue;
        }
        let blob_b64 = secret_box::encrypt_to_b64(&value).map_err(|e| e.to_string())?;
        encrypted.insert(provider, blob_b64);
    }
    settings.api_keys_encrypted = encrypted;
    Ok(())
}

fn write_settings_to_path(path: &std::path::Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Path-aware read used by both the Tauri command and integration tests.
fn get_settings_from_path(path: &std::path::Path) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut settings: AppSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let needs_migration = decrypt_api_keys_into_wire(&mut settings)?;

    // Opportunistic migration: if we found plaintext keys on disk, re-write
    // them as ciphertext now. This is idempotent and runs at most once per
    // launch (after the rewrite, only `api_keys_encrypted` will be present).
    if needs_migration {
        let mut for_disk = settings.clone();
        encrypt_api_keys_for_disk(&mut for_disk)?;
        if let Err(e) = write_settings_to_path(path, &for_disk) {
            log::warn!("api key encryption migration failed: {}", e);
        } else {
            log::info!(
                "migrated {} plaintext api key(s) to encrypted-at-rest",
                for_disk.api_keys_encrypted.len()
            );
        }
    }
    Ok(settings)
}

fn update_settings_at_path(path: &std::path::Path, mut settings: AppSettings) -> Result<(), String> {
    encrypt_api_keys_for_disk(&mut settings)?;
    write_settings_to_path(path, &settings)
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    get_settings_from_path(&settings_path())
}

#[tauri::command]
pub fn update_settings(settings: AppSettings) -> Result<(), String> {
    update_settings_at_path(&settings_path(), settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Default values ──

    #[test]
    fn default_theme_is_sand() {
        assert_eq!(default_theme(), "sand");
    }

    #[test]
    fn default_font_size_is_13() {
        assert_eq!(default_font_size(), 13);
    }

    #[test]
    fn default_send_shortcut_is_cmd_enter() {
        assert_eq!(default_send_shortcut(), "cmd+enter");
    }

    #[test]
    fn default_terminal_font_size_is_13() {
        assert_eq!(default_terminal_font_size(), 13);
    }

    #[test]
    fn default_changelog_provider_is_gemini() {
        assert_eq!(default_changelog_provider(), "gemini");
    }

    #[test]
    fn default_assistant_provider_is_claude_code() {
        assert_eq!(default_assistant_provider(), "claude-code");
    }

    #[test]
    fn default_context_window_is_1m() {
        assert_eq!(default_context_window(), 1_000_000);
    }

    #[test]
    fn default_preview_dimensions() {
        assert_eq!(default_preview_width(), 1024);
        assert_eq!(default_preview_height(), 768);
    }

    #[test]
    fn default_task_board_settings() {
        assert_eq!(default_task_board_model(), "gemini-3.5-flash");
        assert_eq!(default_task_board_max_tokens(), 64000);
        assert_eq!(default_task_board_retries(), 3);
    }

    // ── Default model pricing ──

    #[test]
    fn default_model_pricing_contains_expected_models() {
        let pricing = default_model_pricing();
        assert!(pricing.contains_key("gemini-2.5-flash-lite"));
        assert!(pricing.contains_key("claude-opus-4-8"));
        assert!(pricing.contains_key("claude-sonnet-4-6"));
        assert!(pricing.contains_key("gpt-5.4-mini"));
    }

    #[test]
    fn default_model_pricing_flash_lite_has_cost() {
        let pricing = default_model_pricing();
        let flash_lite = pricing.get("gemini-2.5-flash-lite").unwrap();
        assert!(flash_lite.input > 0.0);
        assert!(flash_lite.output > 0.0);
    }

    #[test]
    fn default_model_pricing_gpt_5_5_is_most_expensive() {
        let pricing = default_model_pricing();
        let top = pricing.get("gpt-5.5").unwrap();
        // GPT-5.5 is the top of the current API lineup by output price ($30/1M).
        for (name, p) in &pricing {
            assert!(
                top.output >= p.output,
                "Expected gpt-5.5 output ({}) >= {} output ({})",
                top.output,
                name,
                p.output
            );
        }
    }

    // ── Default quick commands ──

    #[test]
    fn default_quick_commands_has_four_entries() {
        let cmds = default_quick_commands();
        assert_eq!(cmds.len(), 4);
    }

    #[test]
    fn default_quick_commands_labels() {
        let cmds = default_quick_commands();
        let labels: Vec<&str> = cmds.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, vec!["Build", "Test", "Lint", "Dev"]);
    }

    // ── AppSettings::default() ──

    #[test]
    fn app_settings_default_has_correct_theme() {
        let settings = AppSettings::default();
        assert_eq!(settings.theme, "sand");
        assert_eq!(settings.font_size, 13);
        assert_eq!(settings.send_shortcut, "cmd+enter");
    }

    #[test]
    fn duo_config_default_is_opt_out_with_safe_defaults() {
        let duo = AppSettings::default().duo;
        assert!(!duo.enabled);
        assert_eq!(duo.tie_break_policy, "pause");
        assert_eq!(duo.max_dialogue_rounds, 3);
        assert!(duo.severe_drift_nudge_enabled);
        assert_eq!(duo.severe_drift_sensitivity, "conservative");
        assert!(duo.analyst_enabled);
        assert!(duo.budget_usd_cap.is_none());
        assert!(duo.budget_token_cap.is_none());
    }

    #[test]
    fn duo_config_absent_json_falls_back_to_default() {
        // Legacy installs with no `duo` key must deserialize to the opt-out baseline.
        let settings: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(!settings.duo.enabled);
        assert_eq!(settings.duo.tie_break_policy, "pause");
    }

    #[test]
    fn duo_config_partial_json_merges_per_field_defaults() {
        let json = r#"{"duo":{"enabled":true,"tieBreakPolicy":"mentorWins","budgetUsdCap":2.5}}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.duo.enabled);
        assert_eq!(settings.duo.tie_break_policy, "mentorWins");
        assert_eq!(settings.duo.budget_usd_cap, Some(2.5));
        // Untouched fields keep their defaults.
        assert_eq!(settings.duo.max_dialogue_rounds, 3);
        assert!(settings.duo.severe_drift_nudge_enabled);
    }

    #[test]
    fn default_thinking_effort_starts_unset() {
        // None means "inherit Claude Code's own setting" — we never invent
        // a default level for the user. The dropdown only writes a value
        // here when the user explicitly picks one.
        let settings = AppSettings::default();
        assert_eq!(settings.default_thinking_effort, None);
    }

    #[test]
    fn default_thinking_effort_round_trips_arbitrary_cli_label() {
        // The valid set of effort labels is whatever the CLI exposes per
        // model in `supportedEffortLevels`. We persist whatever the user
        // selected from that live list — never a hardcoded enum.
        let json = r#"{"defaultThinkingEffort":"xhigh"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.default_thinking_effort.as_deref(), Some("xhigh"));

        let json = r#"{"defaultThinkingEffort":"max"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.default_thinking_effort.as_deref(), Some("max"));

        // Forward-compat: a future CLI level we don't know about today
        // must still round-trip — never reject CLI-provided strings.
        let json = r#"{"defaultThinkingEffort":"ultra"}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.default_thinking_effort.as_deref(), Some("ultra"));
    }

    #[test]
    fn default_thinking_effort_serializes_camel_case() {
        let settings = AppSettings {
            default_thinking_effort: Some("low".into()),
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        // Setting must serialize under the camelCase key the frontend uses.
        assert!(
            json.contains("\"defaultThinkingEffort\":\"low\""),
            "serialized JSON must contain camelCase defaultThinkingEffort key, got: {json}"
        );
    }

    #[test]
    fn app_settings_default_booleans() {
        let settings = AppSettings::default();
        assert!(!settings.changelog_enabled);
        assert!(!settings.preview_auto_start);
        assert!(settings.preview_console_auto_open);
        assert!(settings.task_board_auto_start_next);
        assert!(settings.task_board_auto_open_slide_over);
        assert!(!settings.trivia_enabled);
        assert!(!settings.auto_open_files);
        assert!(!settings.onboarding_completed);
        assert!(!settings.api_key_banner_dismissed);
        assert!(settings.session_logs_enabled);
        assert!(settings.super_bro_enabled);
    }

    #[test]
    fn super_bro_default_settings() {
        let settings = AppSettings::default();
        assert!(settings.super_bro_enabled);
        assert_eq!(settings.super_bro_provider, "auto");
        assert_eq!(settings.super_bro_model, "auto");
    }

    #[test]
    fn super_bro_camel_case_serialization() {
        let settings = AppSettings::default();
        let json = serde_json::to_value(&settings).unwrap();
        assert!(json.get("superBroEnabled").is_some());
        assert!(json.get("superBroProvider").is_some());
        assert!(json.get("superBroModel").is_some());
    }

    #[test]
    fn super_bro_deserialization_with_defaults() {
        let settings: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(settings.super_bro_enabled);
        assert_eq!(settings.super_bro_provider, "auto");
        assert_eq!(settings.super_bro_model, "auto");
    }

    #[test]
    fn default_session_logs_retention_is_30() {
        assert_eq!(default_session_logs_retention_days(), 30);
        let settings = AppSettings::default();
        assert_eq!(settings.session_logs_retention_days, 30);
    }

    #[test]
    fn app_settings_default_optional_fields_are_none() {
        let settings = AppSettings::default();
        assert!(settings.terminal_shell.is_none());
        assert!(settings.preview_custom_dev_command.is_none());
        assert!(settings.claude_binary_override.is_none());
    }

    #[test]
    fn app_settings_default_collections_empty_where_expected() {
        let settings = AppSettings::default();
        assert!(settings.api_keys.is_empty());
        assert!(settings.assistant_shortcuts.is_empty());
        assert!(settings.assistant_default_model.is_empty());
        assert!(!settings.model_pricing.is_empty()); // pricing has defaults
        assert!(!settings.quick_commands.is_empty()); // quick commands have defaults
    }

    // ── Serialization roundtrip ──

    #[test]
    fn settings_serialize_deserialize_roundtrip() {
        let original = AppSettings::default();
        let json = serde_json::to_string(&original).unwrap();
        let restored: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(original.theme, restored.theme);
        assert_eq!(original.font_size, restored.font_size);
        assert_eq!(original.send_shortcut, restored.send_shortcut);
        assert_eq!(original.changelog_enabled, restored.changelog_enabled);
        assert_eq!(original.changelog_provider, restored.changelog_provider);
        assert_eq!(original.changelog_model, restored.changelog_model);
        assert_eq!(original.preview_default_width, restored.preview_default_width);
        assert_eq!(original.default_context_window, restored.default_context_window);
    }

    #[test]
    fn settings_camel_case_serialization() {
        let settings = AppSettings::default();
        let json = serde_json::to_value(&settings).unwrap();
        // Verify camelCase field names
        assert!(json.get("fontSize").is_some());
        assert!(json.get("sendShortcut").is_some());
        assert!(json.get("terminalShell").is_some());
        assert!(json.get("terminalFontSize").is_some());
        assert!(json.get("changelogEnabled").is_some());
        assert!(json.get("changelogProvider").is_some());
        assert!(json.get("previewDefaultWidth").is_some());
        assert!(json.get("defaultContextWindow").is_some());
        assert!(json.get("claudeBinaryOverride").is_some());
        assert!(json.get("onboardingCompleted").is_some());
    }

    // ── Deserialization with missing fields (uses serde defaults) ──

    #[test]
    fn deserialize_empty_json_uses_all_defaults() {
        let settings: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings.theme, "sand");
        assert_eq!(settings.font_size, 13);
        assert_eq!(settings.send_shortcut, "cmd+enter");
        assert!(!settings.changelog_enabled);
        assert_eq!(settings.default_context_window, 1_000_000);
    }

    #[test]
    fn deserialize_partial_json_fills_defaults() {
        let json = r#"{"theme": "dark", "fontSize": 16}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.font_size, 16);
        // Everything else should be default
        assert_eq!(settings.send_shortcut, "cmd+enter");
        assert_eq!(settings.terminal_font_size, 13);
        assert!(!settings.changelog_enabled);
    }

    #[test]
    fn deserialize_with_api_keys() {
        let json = r#"{"apiKeys": {"gemini": "key-123", "openai": "sk-abc"}}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.api_keys.len(), 2);
        assert_eq!(settings.api_keys.get("gemini").unwrap(), "key-123");
        assert_eq!(settings.api_keys.get("openai").unwrap(), "sk-abc");
    }

    #[test]
    fn deserialize_with_changelog_api_keys_alias() {
        // The field has alias "changelogApiKeys" for backward compat
        let json = r#"{"changelogApiKeys": {"gemini": "key-old"}}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.api_keys.get("gemini").unwrap(), "key-old");
    }

    // ── QuickCommand and AssistantShortcut types ──

    #[test]
    fn quick_command_roundtrip() {
        let cmd = QuickCommand {
            label: "Deploy".to_string(),
            command: "pnpm deploy".to_string(),
        };
        let json = serde_json::to_string(&cmd).unwrap();
        let restored: QuickCommand = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.label, "Deploy");
        assert_eq!(restored.command, "pnpm deploy");
    }

    #[test]
    fn assistant_shortcut_roundtrip() {
        let shortcut = AssistantShortcut {
            id: "s1".to_string(),
            name: "Explain".to_string(),
            prompt: "Explain this code".to_string(),
        };
        let json = serde_json::to_string(&shortcut).unwrap();
        let restored: AssistantShortcut = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "s1");
        assert_eq!(restored.name, "Explain");
        assert_eq!(restored.prompt, "Explain this code");
    }

    #[test]
    fn model_pricing_roundtrip() {
        let pricing = ModelPricing {
            input: 2.5,
            output: 10.0,
        };
        let json = serde_json::to_string(&pricing).unwrap();
        let restored: ModelPricing = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.input, 2.5);
        assert_eq!(restored.output, 10.0);
    }

    // ── File-based settings (using temp dirs) ──

    #[test]
    fn settings_write_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let settings = AppSettings {
            theme: "midnight".to_string(),
            font_size: 18,
            changelog_enabled: true,
            ..AppSettings::default()
        };

        let json = serde_json::to_string_pretty(&settings).unwrap();
        fs::write(&path, &json).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let restored: AppSettings = serde_json::from_str(&content).unwrap();
        assert_eq!(restored.theme, "midnight");
        assert_eq!(restored.font_size, 18);
        assert!(restored.changelog_enabled);
    }

    // ── Changelog prompt ──

    #[test]
    fn default_changelog_prompt_contains_json_format() {
        let prompt = default_changelog_prompt();
        assert!(prompt.contains("headline"));
        assert!(prompt.contains("description"));
        assert!(prompt.contains("category"));
        assert!(prompt.contains("JSON"));
    }

    // ── API key encryption (wire ↔ disk) ──

    #[test]
    fn encrypt_then_decrypt_round_trips_through_helpers() {
        // Wire-side AppSettings with two plaintext keys.
        let mut settings = AppSettings::default();
        settings.api_keys.insert("openai".into(), "sk-test-abc".into());
        settings.api_keys.insert("anthropic".into(), "sk-ant-xyz".into());

        // Going to disk: api_keys cleared, api_keys_encrypted populated.
        encrypt_api_keys_for_disk(&mut settings).unwrap();
        assert!(settings.api_keys.is_empty());
        assert_eq!(settings.api_keys_encrypted.len(), 2);
        assert!(settings.api_keys_encrypted.contains_key("openai"));
        assert!(settings.api_keys_encrypted.contains_key("anthropic"));
        // Ciphertext is not the plaintext.
        assert_ne!(
            settings.api_keys_encrypted.get("openai").unwrap(),
            "sk-test-abc"
        );

        // Coming back from disk: ciphertext decrypted into api_keys.
        let needs_migration = decrypt_api_keys_into_wire(&mut settings).unwrap();
        assert!(!needs_migration, "no legacy plaintext was on disk");
        assert!(settings.api_keys_encrypted.is_empty());
        assert_eq!(settings.api_keys.get("openai").unwrap(), "sk-test-abc");
        assert_eq!(settings.api_keys.get("anthropic").unwrap(), "sk-ant-xyz");
    }

    #[test]
    fn encrypt_drops_empty_values() {
        // An empty string is "not set", not an encrypted empty secret.
        let mut settings = AppSettings::default();
        settings.api_keys.insert("openai".into(), "sk-real".into());
        settings.api_keys.insert("gemini".into(), "".into());

        encrypt_api_keys_for_disk(&mut settings).unwrap();
        assert_eq!(settings.api_keys_encrypted.len(), 1);
        assert!(settings.api_keys_encrypted.contains_key("openai"));
        assert!(!settings.api_keys_encrypted.contains_key("gemini"));
    }

    #[test]
    fn decrypt_flags_legacy_plaintext_for_migration() {
        // Simulates an old settings.json: `api_keys` populated, `api_keys_encrypted` empty.
        let mut settings = AppSettings::default();
        settings.api_keys.insert("openai".into(), "legacy-plaintext".into());

        let needs_migration = decrypt_api_keys_into_wire(&mut settings).unwrap();
        assert!(needs_migration, "must flag plaintext for migration");
        assert_eq!(settings.api_keys.get("openai").unwrap(), "legacy-plaintext");
    }

    #[test]
    fn decrypt_merges_encrypted_and_legacy_plaintext_with_plaintext_winning() {
        // If both `api_keys_encrypted[provider]` and `api_keys[provider]` exist,
        // the plaintext wins — a manual edit to the file should be respected.
        let mut wire = AppSettings::default();
        wire.api_keys.insert("openai".into(), "freshly-set".into());
        encrypt_api_keys_for_disk(&mut wire).unwrap();
        // Now `wire` has only encrypted form. Add a conflicting plaintext entry.
        wire.api_keys.insert("openai".into(), "user-edited".into());

        let _ = decrypt_api_keys_into_wire(&mut wire).unwrap();
        assert_eq!(wire.api_keys.get("openai").unwrap(), "user-edited");
    }

    #[test]
    fn decrypt_skips_corrupted_ciphertext_without_failing_settings_load() {
        // A garbage ciphertext for one provider must not nuke the others.
        let mut settings = AppSettings::default();
        settings
            .api_keys_encrypted
            .insert("openai".into(), "this-is-not-base64-cipher".into());

        // Add a real encrypted entry alongside.
        let real = secret_box::encrypt_to_b64("sk-good").unwrap();
        settings.api_keys_encrypted.insert("anthropic".into(), real);

        let _ = decrypt_api_keys_into_wire(&mut settings).unwrap();
        // openai dropped (corrupted), anthropic preserved.
        assert!(!settings.api_keys.contains_key("openai"));
        assert_eq!(settings.api_keys.get("anthropic").unwrap(), "sk-good");
    }

    #[test]
    fn wire_serialization_omits_empty_encrypted_field() {
        // After decrypt_api_keys_into_wire clears api_keys_encrypted, the
        // serialized form sent to the frontend must NOT include the field.
        let settings = AppSettings::default();
        let json = serde_json::to_value(&settings).unwrap();
        assert!(
            json.get("apiKeysEncrypted").is_none(),
            "wire shape must not leak apiKeysEncrypted when empty"
        );
    }

    #[test]
    fn disk_serialization_includes_encrypted_field() {
        // When api_keys_encrypted has entries (about to be written to disk),
        // serialization must include the camelCase field.
        let mut settings = AppSettings::default();
        settings
            .api_keys_encrypted
            .insert("openai".into(), "ciphertext-b64".into());
        let json = serde_json::to_value(&settings).unwrap();
        assert!(json.get("apiKeysEncrypted").is_some());
        assert_eq!(
            json["apiKeysEncrypted"]["openai"].as_str().unwrap(),
            "ciphertext-b64"
        );
    }

    #[test]
    fn deserialize_legacy_settings_json_with_plaintext_only() {
        // Real-world: a user upgrades from a pre-encryption version. Their
        // settings.json has only `apiKeys`, no `apiKeysEncrypted`.
        let json = r#"{"apiKeys": {"openai": "sk-legacy"}}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.api_keys.get("openai").unwrap(), "sk-legacy");
        assert!(settings.api_keys_encrypted.is_empty());
    }

    #[test]
    fn deserialize_post_migration_settings_json() {
        // After migration the wire field is empty and the encrypted field is populated.
        let json = r#"{"apiKeys": {}, "apiKeysEncrypted": {"openai": "abc=="}}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.api_keys.is_empty());
        assert_eq!(
            settings.api_keys_encrypted.get("openai").unwrap(),
            "abc=="
        );
    }

    // ── File-based migration round-trip (integration-style) ──

    #[test]
    fn legacy_plaintext_settings_json_is_migrated_on_first_read() {
        // Simulate an existing-user upgrade: settings.json on disk has only
        // plaintext `apiKeys`. After get_settings runs once, the file must
        // be rewritten with encrypted form, and the wire response must still
        // expose the plaintext.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let legacy = r#"{"apiKeys": {"openai": "sk-legacy-abc"}}"#;
        fs::write(&path, legacy).unwrap();

        // First read: returns plaintext on the wire AND rewrites the file.
        let returned = get_settings_from_path(&path).unwrap();
        assert_eq!(returned.api_keys.get("openai").unwrap(), "sk-legacy-abc");
        assert!(returned.api_keys_encrypted.is_empty(), "wire must not leak ciphertext");

        // Second read: file should now be in encrypted form, but wire is unchanged.
        let on_disk = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&on_disk).unwrap();
        assert!(
            parsed["apiKeysEncrypted"].is_object()
                && parsed["apiKeysEncrypted"]["openai"].is_string(),
            "encrypted ciphertext must be on disk after migration, got: {}",
            on_disk
        );
        // The plaintext field on disk must be empty after migration.
        let plaintext_field = parsed.get("apiKeys").and_then(|v| v.as_object());
        assert!(
            plaintext_field.is_none_or(|o| o.is_empty()),
            "apiKeys must be empty/absent on disk after migration, got: {}",
            on_disk
        );

        let returned2 = get_settings_from_path(&path).unwrap();
        assert_eq!(returned2.api_keys.get("openai").unwrap(), "sk-legacy-abc");
    }

    #[test]
    fn update_settings_writes_encrypted_form_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let mut settings = AppSettings::default();
        settings.api_keys.insert("anthropic".into(), "sk-ant-real".into());
        update_settings_at_path(&path, settings).unwrap();

        // Disk has only ciphertext, not plaintext.
        let on_disk = fs::read_to_string(&path).unwrap();
        assert!(
            !on_disk.contains("sk-ant-real"),
            "plaintext key leaked into disk file: {}",
            on_disk
        );
        assert!(on_disk.contains("apiKeysEncrypted"));
    }

    #[test]
    fn round_trip_via_file_preserves_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let mut original = AppSettings {
            theme: "midnight".into(),
            ..AppSettings::default()
        };
        original.api_keys.insert("openai".into(), "sk-foo".into());
        original.api_keys.insert("gemini".into(), "key-bar".into());

        update_settings_at_path(&path, original).unwrap();
        let restored = get_settings_from_path(&path).unwrap();

        assert_eq!(restored.theme, "midnight");
        assert_eq!(restored.api_keys.get("openai").unwrap(), "sk-foo");
        assert_eq!(restored.api_keys.get("gemini").unwrap(), "key-bar");
    }

    #[test]
    fn nonexistent_settings_file_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = get_settings_from_path(&path).unwrap();
        assert_eq!(settings.theme, "sand");
        assert!(settings.api_keys.is_empty());
    }
}
