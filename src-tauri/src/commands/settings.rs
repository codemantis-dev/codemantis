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
    #[serde(default = "default_task_board_retries")]
    pub task_board_max_retries: u32,
    #[serde(default = "default_true")]
    pub task_board_auto_start_next: bool,
    #[serde(default = "default_true")]
    pub task_board_auto_open_slide_over: bool,

    // --- Trivia ---
    #[serde(default = "default_true")]
    pub trivia_enabled: bool,

    // --- Context window ---
    #[serde(default = "default_context_window")]
    pub default_context_window: u64,

    // --- File viewer ---
    #[serde(default)]
    pub auto_open_files: bool,

    // --- Onboarding ---
    #[serde(default)]
    pub onboarding_completed: bool,
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
    "midnight".to_string()
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
    200_000
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
fn default_task_board_retries() -> u32 {
    3
}
fn default_model_pricing() -> HashMap<String, ModelPricing> {
    let mut m = HashMap::new();
    m.insert("gpt-4.1".into(), ModelPricing { input: 2.0, output: 8.0 });
    m.insert("gpt-5-nano".into(), ModelPricing { input: 0.5, output: 2.0 });
    m.insert("gpt-5-mini".into(), ModelPricing { input: 1.0, output: 4.0 });
    m.insert("gemini-2.5-flash-lite".into(), ModelPricing { input: 0.0, output: 0.0 });
    m.insert("gemini-2.5-flash".into(), ModelPricing { input: 0.15, output: 0.60 });
    m.insert("gemini-2.5-pro".into(), ModelPricing { input: 1.25, output: 10.0 });
    m.insert("gemini-3-flash-preview".into(), ModelPricing { input: 0.15, output: 0.60 });
    m.insert("gemini-3.1-pro-preview".into(), ModelPricing { input: 1.25, output: 10.0 });
    m.insert("gemini-3.1-flash-lite-preview".into(), ModelPricing { input: 0.0, output: 0.0 });
    m.insert("gpt-5.4".into(), ModelPricing { input: 2.0, output: 8.0 });
    m.insert("claude-sonnet-4-6".into(), ModelPricing { input: 3.0, output: 15.0 });
    m.insert("claude-haiku-4-5".into(), ModelPricing { input: 0.80, output: 4.0 });
    m
}
fn default_changelog_prompt() -> String {
    r#"Summarize this coding session turn as a changelog entry. Return JSON only, no markdown.

JSON format: {"headline":"max 80 chars","description":"1-2 sentences","category":"feature|bugfix|refactor|docs|config|test"}"#.to_string()
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
            task_board_max_retries: default_task_board_retries(),
            task_board_auto_start_next: true,
            task_board_auto_open_slide_over: true,
            default_context_window: default_context_window(),
            trivia_enabled: true,
            auto_open_files: false,
            onboarding_completed: false,
        }
    }
}

fn settings_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("dev.codemantis.app")
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
