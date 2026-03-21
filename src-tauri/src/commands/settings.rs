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
    #[serde(default, alias = "changelogApiKeys")]
    pub api_keys: HashMap<String, String>,
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
    "gemini-2.5-flash".to_string()
}
fn default_task_board_max_tokens() -> u32 {
    64000
}
fn default_task_board_retries() -> u32 {
    3
}
fn default_model_pricing() -> HashMap<String, ModelPricing> {
    let mut m = HashMap::new();
    m.insert("gpt-4.1".into(), ModelPricing { input: 2.0, output: 8.0 });
    m.insert("gpt-5.4-nano".into(), ModelPricing { input: 0.20, output: 1.25 });
    m.insert("gpt-5.4-mini".into(), ModelPricing { input: 0.75, output: 4.50 });
    m.insert("gpt-5.4".into(), ModelPricing { input: 2.50, output: 15.0 });
    m.insert("gemini-2.5-flash-lite".into(), ModelPricing { input: 0.10, output: 0.40 });
    m.insert("gemini-2.5-flash".into(), ModelPricing { input: 0.15, output: 0.60 });
    m.insert("gemini-2.5-pro".into(), ModelPricing { input: 1.25, output: 10.0 });
    m.insert("gemini-3-flash-preview".into(), ModelPricing { input: 0.15, output: 0.60 });
    m.insert("gemini-3.1-pro-preview".into(), ModelPricing { input: 1.25, output: 10.0 });
    m.insert("gemini-3.1-flash-lite-preview".into(), ModelPricing { input: 0.25, output: 1.50 });
    m.insert("claude-opus-4-6".into(), ModelPricing { input: 5.0, output: 25.0 });
    m.insert("claude-sonnet-4-6".into(), ModelPricing { input: 3.0, output: 15.0 });
    m.insert("claude-haiku-4-5".into(), ModelPricing { input: 0.80, output: 4.0 });
    m
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
        }
    }
}

fn settings_path() -> PathBuf {
    crate::utils::paths::app_data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("settings.json")
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
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
        assert_eq!(default_task_board_model(), "gemini-2.5-flash");
        assert_eq!(default_task_board_max_tokens(), 64000);
        assert_eq!(default_task_board_retries(), 3);
    }

    // ── Default model pricing ──

    #[test]
    fn default_model_pricing_contains_expected_models() {
        let pricing = default_model_pricing();
        assert!(pricing.contains_key("gemini-2.5-flash-lite"));
        assert!(pricing.contains_key("claude-opus-4-6"));
        assert!(pricing.contains_key("claude-sonnet-4-6"));
        assert!(pricing.contains_key("gpt-4.1"));
    }

    #[test]
    fn default_model_pricing_flash_lite_has_cost() {
        let pricing = default_model_pricing();
        let flash_lite = pricing.get("gemini-2.5-flash-lite").unwrap();
        assert!(flash_lite.input > 0.0);
        assert!(flash_lite.output > 0.0);
    }

    #[test]
    fn default_model_pricing_opus_is_most_expensive() {
        let pricing = default_model_pricing();
        let opus = pricing.get("claude-opus-4-6").unwrap();
        // Opus should be the most expensive by output price
        for (name, p) in &pricing {
            assert!(
                opus.output >= p.output,
                "Expected opus output ({}) >= {} output ({})",
                opus.output,
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

        let mut settings = AppSettings::default();
        settings.theme = "midnight".to_string();
        settings.font_size = 18;
        settings.changelog_enabled = true;

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
}
