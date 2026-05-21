//! Codex MCP server management (`~/.codex/config.toml`).
//!
//! Codex configures MCP servers via a TOML file rather than the
//! `~/.claude.json` JSON file Claude uses. Phase 2 Session 4 lands the
//! pure parsing / location helpers; Session 5 wires them into
//! `commands::mcp` so the existing MCPServerModal can target Codex
//! sessions (per spec §2.6).
//!
//! For v1.3.0 we do **not** auto-translate between Claude and Codex
//! configs — the MCP UI branches on the active session's `agent_id` and
//! the user sees a per-agent picker.
//!
//! Spec: `CodeMantis-Phase2-CodexAdapter-v1.0.md` §2.6.

#![allow(dead_code)] // Full wiring lands in S5 (commands::mcp dispatch).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Where Codex looks for MCP config. Honors `$CODEX_HOME`; falls back to
/// `~/.codex/`.
pub fn config_path() -> PathBuf {
    let base = if let Ok(home) = std::env::var("CODEX_HOME") {
        PathBuf::from(home)
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".codex")
    };
    base.join("config.toml")
}

/// One entry under `[mcp_servers.<name>]`. Stdio and streamable-HTTP
/// servers are the two documented shapes; we tolerate both by making
/// `command`/`url` optional.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CodexMcpServer {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub env: std::collections::HashMap<String, String>,
    /// Streamable-HTTP MCP servers use `url` instead of `command`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl CodexMcpServer {
    pub fn is_stdio(&self) -> bool {
        self.command.is_some()
    }
    pub fn is_http(&self) -> bool {
        self.url.is_some()
    }
}

/// Top-level config.toml shape. Codex tolerates many other top-level keys
/// (`sandbox_workspace_write`, `web_search`, …); we only deserialize what
/// CodeMantis touches in v1.3.0.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CodexConfig {
    #[serde(default, rename = "mcp_servers")]
    pub mcp_servers: std::collections::HashMap<String, CodexMcpServer>,
}

/// Read + parse the config. `Ok(None)` if the file doesn't exist (a
/// fresh Codex install); `Err` for IO/parse failures we can't paper over.
pub fn load(path: &std::path::Path) -> Result<Option<CodexConfig>, ConfigError> {
    let body = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(ConfigError::Io(e)),
    };
    let cfg: CodexConfig = toml::from_str(&body).map_err(ConfigError::Parse)?;
    Ok(Some(cfg))
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("io: {0}")]
    Io(std::io::Error),
    #[error("toml: {0}")]
    Parse(toml::de::Error),
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_path_honors_codex_home_env() {
        let prev = std::env::var("CODEX_HOME").ok();
        std::env::set_var("CODEX_HOME", "/custom/codex");
        let p = config_path();
        match prev {
            Some(v) => std::env::set_var("CODEX_HOME", v),
            None => std::env::remove_var("CODEX_HOME"),
        }
        assert_eq!(p, std::path::PathBuf::from("/custom/codex/config.toml"));
    }

    #[test]
    fn load_returns_none_for_missing_file() {
        let p = std::path::PathBuf::from("/definitely/does/not/exist/config.toml");
        let cfg = load(&p).unwrap();
        assert!(cfg.is_none());
    }

    #[test]
    fn parses_stdio_mcp_server_entry() {
        let toml_src = r#"
[mcp_servers.context7]
command = "npx"
args = ["@context7/mcp-server"]
env = { CONTEXT7_API_KEY = "abc" }
"#;
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), toml_src).unwrap();
        let cfg = load(tmp.path()).unwrap().unwrap();
        let srv = cfg.mcp_servers.get("context7").unwrap();
        assert_eq!(srv.command.as_deref(), Some("npx"));
        assert_eq!(srv.args, vec!["@context7/mcp-server".to_string()]);
        assert_eq!(srv.env.get("CONTEXT7_API_KEY").map(String::as_str), Some("abc"));
        assert!(srv.is_stdio());
        assert!(!srv.is_http());
    }

    #[test]
    fn parses_streamable_http_mcp_server_entry() {
        let toml_src = r#"
[mcp_servers.example]
url = "https://example.com/mcp"
"#;
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), toml_src).unwrap();
        let cfg = load(tmp.path()).unwrap().unwrap();
        let srv = cfg.mcp_servers.get("example").unwrap();
        assert_eq!(srv.url.as_deref(), Some("https://example.com/mcp"));
        assert!(srv.is_http());
        assert!(!srv.is_stdio());
    }

    #[test]
    fn parses_empty_config_to_empty_servers_map() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), "").unwrap();
        let cfg = load(tmp.path()).unwrap().unwrap();
        assert!(cfg.mcp_servers.is_empty());
    }

    #[test]
    fn invalid_toml_returns_parse_error() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), "[not closed").unwrap();
        let err = load(tmp.path()).unwrap_err();
        assert!(matches!(err, ConfigError::Parse(_)));
    }

    #[test]
    fn server_entry_roundtrips_via_serde() {
        let mut env = std::collections::HashMap::new();
        env.insert("K".to_string(), "V".to_string());
        let srv = CodexMcpServer {
            command: Some("node".into()),
            args: vec!["x.js".into()],
            env,
            url: None,
        };
        let mut servers = std::collections::HashMap::new();
        servers.insert("alpha".to_string(), srv.clone());
        let cfg = CodexConfig {
            mcp_servers: servers,
        };
        let s = toml::to_string(&cfg).unwrap();
        let back: CodexConfig = toml::from_str(&s).unwrap();
        assert_eq!(back.mcp_servers.get("alpha"), Some(&srv));
    }
}
