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
    #[serde(default)]
    pub changelog_enabled: bool,
    #[serde(default = "default_changelog_provider")]
    pub changelog_provider: String,
    #[serde(default = "default_changelog_model")]
    pub changelog_model: String,
    #[serde(default)]
    pub changelog_api_keys: HashMap<String, String>,
    #[serde(default = "default_changelog_prompt")]
    pub changelog_prompt: String,
    #[serde(default)]
    pub assistant_shortcuts: Vec<AssistantShortcut>,
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
            changelog_enabled: false,
            changelog_provider: default_changelog_provider(),
            changelog_model: default_changelog_model(),
            changelog_api_keys: HashMap::new(),
            changelog_prompt: default_changelog_prompt(),
            assistant_shortcuts: Vec::new(),
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
