use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub name: String,
    pub scope: String,
    pub server_type: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

fn claude_json_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude.json")
}

fn project_mcp_path(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(".mcp.json")
}

fn detect_server_type(value: &serde_json::Value) -> String {
    if let Some(t) = value.get("type").and_then(|v| v.as_str()) {
        match t {
            "http" => "http".to_string(),
            "sse" => "sse".to_string(),
            _ => "stdio".to_string(),
        }
    } else if value.get("command").is_some() {
        "stdio".to_string()
    } else if value.get("url").is_some() {
        // Has url but no type field — could be sse or http, default to http
        "http".to_string()
    } else {
        "stdio".to_string()
    }
}

fn parse_servers(
    mcp_servers: &serde_json::Value,
    scope: &str,
) -> Vec<McpServerConfig> {
    let mut servers = Vec::new();
    if let Some(obj) = mcp_servers.as_object() {
        for (name, config) in obj {
            let server_type = detect_server_type(config);
            servers.push(McpServerConfig {
                name: name.clone(),
                scope: scope.to_string(),
                server_type,
                command: config.get("command").and_then(|v| v.as_str()).map(String::from),
                args: config.get("args").and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.as_str().map(String::from))
                            .collect()
                    })
                }),
                env: config.get("env").and_then(|v| {
                    v.as_object().map(|obj| {
                        obj.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    })
                }),
                url: config.get("url").and_then(|v| v.as_str()).map(String::from),
                headers: config.get("headers").and_then(|v| {
                    v.as_object().map(|obj| {
                        obj.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    })
                }),
            });
        }
    }
    servers
}

fn build_server_json(server: &McpServerConfig) -> serde_json::Value {
    let mut obj = serde_json::Map::new();

    match server.server_type.as_str() {
        "http" => {
            obj.insert("type".to_string(), serde_json::json!("http"));
            if let Some(url) = &server.url {
                obj.insert("url".to_string(), serde_json::json!(url));
            }
            if let Some(headers) = &server.headers {
                if !headers.is_empty() {
                    obj.insert("headers".to_string(), serde_json::json!(headers));
                }
            }
        }
        "sse" => {
            obj.insert("type".to_string(), serde_json::json!("sse"));
            if let Some(url) = &server.url {
                obj.insert("url".to_string(), serde_json::json!(url));
            }
            if let Some(headers) = &server.headers {
                if !headers.is_empty() {
                    obj.insert("headers".to_string(), serde_json::json!(headers));
                }
            }
        }
        _ => {
            // stdio — no type field
            if let Some(command) = &server.command {
                obj.insert("command".to_string(), serde_json::json!(command));
            }
            if let Some(args) = &server.args {
                if !args.is_empty() {
                    obj.insert("args".to_string(), serde_json::json!(args));
                }
            }
            if let Some(env) = &server.env {
                if !env.is_empty() {
                    obj.insert("env".to_string(), serde_json::json!(env));
                }
            }
        }
    }

    serde_json::Value::Object(obj)
}

fn atomic_write(path: &PathBuf, value: &serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;
    fs::rename(&tmp_path, path).map_err(|e| format!("Failed to rename temp file: {}", e))?;
    Ok(())
}

fn read_json_file(path: &PathBuf) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_mcp_servers(project_path: Option<String>) -> Result<Vec<McpServerConfig>, String> {
    let mut servers = Vec::new();

    // Read global servers from ~/.claude.json
    let claude_path = claude_json_path();
    if claude_path.exists() {
        let value = read_json_file(&claude_path)?;
        if let Some(mcp) = value.get("mcpServers") {
            servers.extend(parse_servers(mcp, "global"));
        }
    }

    // Read project servers from <project>/.mcp.json
    if let Some(ref pp) = project_path {
        let mcp_path = project_mcp_path(pp);
        if mcp_path.exists() {
            let value = read_json_file(&mcp_path)?;
            if let Some(mcp) = value.get("mcpServers") {
                servers.extend(parse_servers(mcp, "project"));
            }
        }
    }

    Ok(servers)
}

#[tauri::command]
pub fn save_mcp_server(
    project_path: Option<String>,
    server: McpServerConfig,
) -> Result<(), String> {
    let server_json = build_server_json(&server);

    match server.scope.as_str() {
        "global" => {
            let path = claude_json_path();
            if !path.exists() {
                return Err("~/.claude.json does not exist. It is managed by Claude Code.".to_string());
            }
            let mut value = read_json_file(&path)?;
            if value.get("mcpServers").is_none() {
                value["mcpServers"] = serde_json::json!({});
            }
            value["mcpServers"][&server.name] = server_json;
            atomic_write(&path, &value)?;
        }
        "project" => {
            let pp = project_path.ok_or("Project path required for project-scoped server")?;
            let path = project_mcp_path(&pp);
            let mut value = if path.exists() {
                read_json_file(&path)?
            } else {
                serde_json::json!({ "mcpServers": {} })
            };
            if value.get("mcpServers").is_none() {
                value["mcpServers"] = serde_json::json!({});
            }
            value["mcpServers"][&server.name] = server_json;
            atomic_write(&path, &value)?;
        }
        _ => return Err(format!("Invalid scope: {}", server.scope)),
    }

    info!("MCP server saved: name={}, scope={}", server.name, server.scope);
    Ok(())
}

#[tauri::command]
pub fn delete_mcp_server(
    project_path: Option<String>,
    name: String,
    scope: String,
) -> Result<(), String> {
    match scope.as_str() {
        "global" => {
            let path = claude_json_path();
            if !path.exists() {
                return Err("~/.claude.json does not exist".to_string());
            }
            let mut value = read_json_file(&path)?;
            if let Some(mcp) = value.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                mcp.remove(&name);
            }
            atomic_write(&path, &value)?;
        }
        "project" => {
            let pp = project_path.ok_or("Project path required for project-scoped server")?;
            let path = project_mcp_path(&pp);
            if !path.exists() {
                return Ok(());
            }
            let mut value = read_json_file(&path)?;
            if let Some(mcp) = value.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                mcp.remove(&name);
            }
            atomic_write(&path, &value)?;
        }
        _ => return Err(format!("Invalid scope: {}", scope)),
    }

    info!("MCP server deleted: name={}, scope={}", name, scope);
    Ok(())
}

#[tauri::command]
pub fn rename_mcp_server(
    project_path: Option<String>,
    old_name: String,
    new_name: String,
    scope: String,
) -> Result<(), String> {
    let path = match scope.as_str() {
        "global" => {
            let p = claude_json_path();
            if !p.exists() {
                return Err("~/.claude.json does not exist".to_string());
            }
            p
        }
        "project" => {
            let pp = project_path.ok_or("Project path required for project-scoped server")?;
            let p = project_mcp_path(&pp);
            if !p.exists() {
                return Err(".mcp.json does not exist".to_string());
            }
            p
        }
        _ => return Err(format!("Invalid scope: {}", scope)),
    };

    let mut value = read_json_file(&path)?;
    if let Some(mcp) = value.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        if let Some(entry) = mcp.remove(&old_name) {
            mcp.insert(new_name, entry);
        } else {
            return Err(format!("Server '{}' not found", old_name));
        }
    } else {
        return Err("No mcpServers found".to_string());
    }

    atomic_write(&path, &value)?;
    Ok(())
}

#[tauri::command]
pub fn get_mcp_config_path(scope: String, project_path: Option<String>) -> Result<String, String> {
    let path = match scope.as_str() {
        "global" => claude_json_path(),
        "project" => {
            let pp = project_path.ok_or("Project path required for project-scoped config")?;
            project_mcp_path(&pp)
        }
        _ => return Err(format!("Invalid scope: {}", scope)),
    };
    path.to_str()
        .map(String::from)
        .ok_or_else(|| "Config path contains invalid characters".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ──────────────────────────────────────────────────────────
    // detect_server_type — classify server by JSON shape
    // ──────────────────────────────────────────────────────────

    #[test]
    fn detect_stdio_from_explicit_type() {
        let val = serde_json::json!({"type": "stdio", "command": "npx"});
        assert_eq!(detect_server_type(&val), "stdio");
    }

    #[test]
    fn detect_http_from_explicit_type() {
        let val = serde_json::json!({"type": "http", "url": "https://example.com"});
        assert_eq!(detect_server_type(&val), "http");
    }

    #[test]
    fn detect_sse_from_explicit_type() {
        let val = serde_json::json!({"type": "sse", "url": "https://example.com/sse"});
        assert_eq!(detect_server_type(&val), "sse");
    }

    #[test]
    fn detect_stdio_from_command_field_no_type() {
        let val = serde_json::json!({"command": "npx", "args": ["-y", "@pkg/mcp"]});
        assert_eq!(detect_server_type(&val), "stdio");
    }

    #[test]
    fn detect_http_from_url_field_no_type_no_command() {
        let val = serde_json::json!({"url": "https://api.example.com/mcp/"});
        assert_eq!(detect_server_type(&val), "http");
    }

    #[test]
    fn detect_stdio_when_empty_object() {
        let val = serde_json::json!({});
        assert_eq!(detect_server_type(&val), "stdio");
    }

    #[test]
    fn detect_unknown_type_falls_back_to_stdio() {
        let val = serde_json::json!({"type": "future_type"});
        assert_eq!(detect_server_type(&val), "stdio");
    }

    // ──────────────────────────────────────────────────────────
    // parse_servers — convert JSON mcpServers object into Vec
    // ──────────────────────────────────────────────────────────

    #[test]
    fn parse_servers_empty_object() {
        let val = serde_json::json!({});
        let servers = parse_servers(&val, "global");
        assert!(servers.is_empty());
    }

    #[test]
    fn parse_servers_not_an_object() {
        let val = serde_json::json!("not an object");
        let servers = parse_servers(&val, "global");
        assert!(servers.is_empty());
    }

    #[test]
    fn parse_servers_null() {
        let val = serde_json::json!(null);
        let servers = parse_servers(&val, "global");
        assert!(servers.is_empty());
    }

    #[test]
    fn parse_servers_stdio_server() {
        let val = serde_json::json!({
            "myserver": {
                "command": "npx",
                "args": ["-y", "@pkg/mcp"],
                "env": {"API_KEY": "secret123"}
            }
        });
        let servers = parse_servers(&val, "global");
        assert_eq!(servers.len(), 1);
        let s = &servers[0];
        assert_eq!(s.name, "myserver");
        assert_eq!(s.scope, "global");
        assert_eq!(s.server_type, "stdio");
        assert_eq!(s.command.as_deref(), Some("npx"));
        assert_eq!(s.args.as_ref().unwrap(), &vec!["-y".to_string(), "@pkg/mcp".to_string()]);
        assert_eq!(s.env.as_ref().unwrap().get("API_KEY").unwrap(), "secret123");
        assert!(s.url.is_none());
        assert!(s.headers.is_none());
    }

    #[test]
    fn parse_servers_http_server() {
        let val = serde_json::json!({
            "remote": {
                "type": "http",
                "url": "https://api.example.com/mcp/",
                "headers": {"Authorization": "Bearer tok123"}
            }
        });
        let servers = parse_servers(&val, "project");
        assert_eq!(servers.len(), 1);
        let s = &servers[0];
        assert_eq!(s.name, "remote");
        assert_eq!(s.scope, "project");
        assert_eq!(s.server_type, "http");
        assert_eq!(s.url.as_deref(), Some("https://api.example.com/mcp/"));
        assert_eq!(s.headers.as_ref().unwrap().get("Authorization").unwrap(), "Bearer tok123");
        assert!(s.command.is_none());
    }

    #[test]
    fn parse_servers_sse_server() {
        let val = serde_json::json!({
            "events": {
                "type": "sse",
                "url": "https://mcp.example.com/sse"
            }
        });
        let servers = parse_servers(&val, "global");
        assert_eq!(servers.len(), 1);
        let s = &servers[0];
        assert_eq!(s.server_type, "sse");
        assert_eq!(s.url.as_deref(), Some("https://mcp.example.com/sse"));
    }

    #[test]
    fn parse_servers_multiple_servers() {
        let val = serde_json::json!({
            "server1": {"command": "cmd1"},
            "server2": {"type": "http", "url": "https://example.com"},
            "server3": {"type": "sse", "url": "https://sse.example.com"}
        });
        let servers = parse_servers(&val, "global");
        assert_eq!(servers.len(), 3);
        let names: Vec<&str> = servers.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"server1"));
        assert!(names.contains(&"server2"));
        assert!(names.contains(&"server3"));
    }

    // ──────────────────────────────────────────────────────────
    // build_server_json — convert McpServerConfig to clean JSON
    // ──────────────────────────────────────────────────────────

    #[test]
    fn build_stdio_json_omits_type_field() {
        let server = McpServerConfig {
            name: "test".to_string(),
            scope: "global".to_string(),
            server_type: "stdio".to_string(),
            command: Some("npx".to_string()),
            args: Some(vec!["-y".to_string(), "@pkg/mcp".to_string()]),
            env: Some(HashMap::from([("KEY".to_string(), "val".to_string())])),
            url: None,
            headers: None,
        };
        let json = build_server_json(&server);
        assert!(json.get("type").is_none(), "stdio should not have type field");
        assert_eq!(json["command"], "npx");
        assert_eq!(json["args"][0], "-y");
        assert_eq!(json["args"][1], "@pkg/mcp");
        assert_eq!(json["env"]["KEY"], "val");
    }

    #[test]
    fn build_stdio_json_omits_empty_args_and_env() {
        let server = McpServerConfig {
            name: "test".to_string(),
            scope: "global".to_string(),
            server_type: "stdio".to_string(),
            command: Some("cmd".to_string()),
            args: Some(vec![]),
            env: Some(HashMap::new()),
            url: None,
            headers: None,
        };
        let json = build_server_json(&server);
        assert!(json.get("args").is_none(), "empty args should be omitted");
        assert!(json.get("env").is_none(), "empty env should be omitted");
    }

    #[test]
    fn build_http_json_includes_type() {
        let server = McpServerConfig {
            name: "remote".to_string(),
            scope: "project".to_string(),
            server_type: "http".to_string(),
            command: None,
            args: None,
            env: None,
            url: Some("https://example.com/mcp/".to_string()),
            headers: Some(HashMap::from([("Auth".to_string(), "Bearer tok".to_string())])),
        };
        let json = build_server_json(&server);
        assert_eq!(json["type"], "http");
        assert_eq!(json["url"], "https://example.com/mcp/");
        assert_eq!(json["headers"]["Auth"], "Bearer tok");
    }

    #[test]
    fn build_http_json_omits_empty_headers() {
        let server = McpServerConfig {
            name: "remote".to_string(),
            scope: "project".to_string(),
            server_type: "http".to_string(),
            command: None,
            args: None,
            env: None,
            url: Some("https://example.com".to_string()),
            headers: Some(HashMap::new()),
        };
        let json = build_server_json(&server);
        assert!(json.get("headers").is_none(), "empty headers should be omitted");
    }

    #[test]
    fn build_sse_json_includes_type_and_url() {
        let server = McpServerConfig {
            name: "events".to_string(),
            scope: "global".to_string(),
            server_type: "sse".to_string(),
            command: None,
            args: None,
            env: None,
            url: Some("https://sse.example.com".to_string()),
            headers: None,
        };
        let json = build_server_json(&server);
        assert_eq!(json["type"], "sse");
        assert_eq!(json["url"], "https://sse.example.com");
        assert!(json.get("headers").is_none());
        assert!(json.get("command").is_none());
    }

    // ──────────────────────────────────────────────────────────
    // CRUD integration tests with temp files
    // ──────────────────────────────────────────────────────────

    fn create_test_claude_json(tmp: &std::path::Path) -> PathBuf {
        let path = tmp.join(".claude.json");
        let content = serde_json::json!({
            "tipsHistory": ["tip1"],
            "mcpServers": {
                "context7": {
                    "command": "npx",
                    "args": ["-y", "@upstash/context7-mcp"]
                }
            },
            "projects": {
                "/some/project": {
                    "allowedTools": ["Read", "Write"]
                }
            }
        });
        fs::write(&path, serde_json::to_string_pretty(&content).unwrap()).unwrap();
        path
    }

    fn create_test_mcp_json(tmp: &std::path::Path) -> PathBuf {
        let path = tmp.join(".mcp.json");
        let content = serde_json::json!({
            "mcpServers": {
                "project-server": {
                    "type": "http",
                    "url": "https://project.example.com/mcp"
                }
            }
        });
        fs::write(&path, serde_json::to_string_pretty(&content).unwrap()).unwrap();
        path
    }

    #[test]
    fn get_mcp_servers_reads_global_servers() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_path = create_test_claude_json(tmp.path());

        let content = fs::read_to_string(&claude_path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&content).unwrap();
        let servers = parse_servers(value.get("mcpServers").unwrap(), "global");

        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "context7");
        assert_eq!(servers[0].scope, "global");
        assert_eq!(servers[0].server_type, "stdio");
        assert_eq!(servers[0].command.as_deref(), Some("npx"));
    }

    #[test]
    fn get_mcp_servers_reads_project_servers() {
        let tmp = tempfile::tempdir().unwrap();
        let mcp_path = create_test_mcp_json(tmp.path());

        let content = fs::read_to_string(&mcp_path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&content).unwrap();
        let servers = parse_servers(value.get("mcpServers").unwrap(), "project");

        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "project-server");
        assert_eq!(servers[0].scope, "project");
        assert_eq!(servers[0].server_type, "http");
        assert_eq!(servers[0].url.as_deref(), Some("https://project.example.com/mcp"));
    }

    #[test]
    fn save_server_to_existing_file_preserves_other_keys() {
        let tmp = tempfile::tempdir().unwrap();
        let path = create_test_claude_json(tmp.path());

        // Read, add a new server, write
        let mut value = read_json_file(&path).unwrap();
        let server = McpServerConfig {
            name: "new-server".to_string(),
            scope: "global".to_string(),
            server_type: "stdio".to_string(),
            command: Some("node".to_string()),
            args: Some(vec!["server.js".to_string()]),
            env: None,
            url: None,
            headers: None,
        };
        let server_json = build_server_json(&server);
        value["mcpServers"][&server.name] = server_json;
        atomic_write(&path, &value).unwrap();

        // Verify
        let result = read_json_file(&path).unwrap();
        // Original server still present
        assert!(result["mcpServers"]["context7"].is_object());
        // New server added
        assert_eq!(result["mcpServers"]["new-server"]["command"], "node");
        // Other keys preserved
        assert!(result["tipsHistory"].is_array());
        assert!(result["projects"].is_object());
        assert_eq!(result["projects"]["/some/project"]["allowedTools"][0], "Read");
    }

    #[test]
    fn save_server_creates_mcp_json_from_scratch() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".mcp.json");

        // File doesn't exist yet
        assert!(!path.exists());

        let mut value = serde_json::json!({"mcpServers": {}});
        let server = McpServerConfig {
            name: "new-project-server".to_string(),
            scope: "project".to_string(),
            server_type: "http".to_string(),
            command: None,
            args: None,
            env: None,
            url: Some("https://api.example.com".to_string()),
            headers: None,
        };
        let server_json = build_server_json(&server);
        value["mcpServers"][&server.name] = server_json;
        atomic_write(&path, &value).unwrap();

        // Verify file created with correct structure
        let result = read_json_file(&path).unwrap();
        assert_eq!(result["mcpServers"]["new-project-server"]["type"], "http");
        assert_eq!(result["mcpServers"]["new-project-server"]["url"], "https://api.example.com");
    }

    #[test]
    fn delete_server_removes_only_target() {
        let tmp = tempfile::tempdir().unwrap();
        let path = create_test_claude_json(tmp.path());

        // Add a second server first
        let mut value = read_json_file(&path).unwrap();
        value["mcpServers"]["to-delete"] = serde_json::json!({"command": "doomed"});
        atomic_write(&path, &value).unwrap();

        // Delete it
        let mut value = read_json_file(&path).unwrap();
        if let Some(mcp) = value.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
            mcp.remove("to-delete");
        }
        atomic_write(&path, &value).unwrap();

        // Verify only target was removed
        let result = read_json_file(&path).unwrap();
        assert!(result["mcpServers"]["to-delete"].is_null());
        assert!(result["mcpServers"]["context7"].is_object());
        // Other keys still intact
        assert!(result["tipsHistory"].is_array());
    }

    #[test]
    fn rename_server_preserves_config() {
        let tmp = tempfile::tempdir().unwrap();
        let path = create_test_claude_json(tmp.path());

        let mut value = read_json_file(&path).unwrap();
        if let Some(mcp) = value.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
            let entry = mcp.remove("context7").unwrap();
            mcp.insert("context7-renamed".to_string(), entry);
        }
        atomic_write(&path, &value).unwrap();

        let result = read_json_file(&path).unwrap();
        assert!(result["mcpServers"]["context7"].is_null());
        assert!(result["mcpServers"]["context7-renamed"].is_object());
        assert_eq!(result["mcpServers"]["context7-renamed"]["command"], "npx");
        assert_eq!(result["mcpServers"]["context7-renamed"]["args"][0], "-y");
    }

    #[test]
    fn atomic_write_produces_valid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.json");
        let value = serde_json::json!({"key": "value", "nested": {"a": 1}});
        atomic_write(&path, &value).unwrap();

        // No temp file left behind
        assert!(!tmp.path().join("test.tmp").exists());

        // Output is valid JSON
        let result = read_json_file(&path).unwrap();
        assert_eq!(result["key"], "value");
        assert_eq!(result["nested"]["a"], 1);
    }

    #[test]
    fn read_json_file_returns_error_for_missing() {
        let result = read_json_file(&PathBuf::from("/nonexistent/file.json"));
        assert!(result.is_err());
    }

    #[test]
    fn read_json_file_returns_error_for_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("bad.json");
        fs::write(&path, "{ not valid json }").unwrap();
        let result = read_json_file(&path);
        assert!(result.is_err());
    }

    #[test]
    fn read_json_file_returns_error_for_truncated_json() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("truncated.json");
        fs::write(&path, r#"{"mcpServers": {"server": {"command": "nod"#).unwrap();
        let result = read_json_file(&path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("EOF"));
    }

    #[test]
    fn read_json_file_returns_error_for_empty_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("empty.json");
        fs::write(&path, "").unwrap();
        let result = read_json_file(&path);
        assert!(result.is_err());
    }

    #[test]
    fn save_mcp_server_returns_error_for_corrupted_config() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".claude.json");
        fs::write(&path, "NOT JSON AT ALL").unwrap();

        // We can't easily test save_mcp_server directly because it reads
        // from the user's home directory, but we can verify that read_json_file
        // + the ? propagation correctly prevents panics:
        let result = read_json_file(&path);
        assert!(result.is_err());
    }

    #[test]
    fn parse_servers_with_env_containing_special_chars() {
        let val = serde_json::json!({
            "server": {
                "command": "cmd",
                "env": {
                    "TOKEN": "FAKE_TOKEN_FOR_TESTING",
                    "URL": "https://example.com?key=value&other=123"
                }
            }
        });
        let servers = parse_servers(&val, "global");
        let env = servers[0].env.as_ref().unwrap();
        assert_eq!(env.get("TOKEN").unwrap(), "FAKE_TOKEN_FOR_TESTING");
        assert_eq!(env.get("URL").unwrap(), "https://example.com?key=value&other=123");
    }

    #[test]
    fn parse_servers_without_optional_fields() {
        let val = serde_json::json!({
            "minimal": {"command": "cmd"}
        });
        let servers = parse_servers(&val, "global");
        assert_eq!(servers.len(), 1);
        let s = &servers[0];
        assert_eq!(s.command.as_deref(), Some("cmd"));
        assert!(s.args.is_none());
        assert!(s.env.is_none());
        assert!(s.url.is_none());
        assert!(s.headers.is_none());
    }

    #[test]
    fn build_sse_json_includes_headers() {
        let server = McpServerConfig {
            name: "sse-auth".to_string(),
            scope: "global".to_string(),
            server_type: "sse".to_string(),
            command: None,
            args: None,
            env: None,
            url: Some("https://sse.example.com".to_string()),
            headers: Some(HashMap::from([
                ("Authorization".to_string(), "Bearer tok".to_string()),
            ])),
        };
        let json = build_server_json(&server);
        assert_eq!(json["type"], "sse");
        assert_eq!(json["url"], "https://sse.example.com");
        assert_eq!(json["headers"]["Authorization"], "Bearer tok");
    }

    #[test]
    fn build_sse_json_omits_empty_headers() {
        let server = McpServerConfig {
            name: "sse-no-headers".to_string(),
            scope: "global".to_string(),
            server_type: "sse".to_string(),
            command: None,
            args: None,
            env: None,
            url: Some("https://sse.example.com".to_string()),
            headers: Some(HashMap::new()),
        };
        let json = build_server_json(&server);
        assert!(json.get("headers").is_none(), "empty headers should be omitted for SSE");
    }

    #[test]
    fn sse_headers_round_trip() {
        let val = serde_json::json!({
            "sse-auth": {
                "type": "sse",
                "url": "https://sse.example.com",
                "headers": {
                    "Authorization": "Bearer secret",
                    "X-Custom": "value"
                }
            }
        });
        let servers = parse_servers(&val, "global");
        assert_eq!(servers.len(), 1);
        let s = &servers[0];
        assert_eq!(s.server_type, "sse");
        assert_eq!(s.headers.as_ref().unwrap().get("Authorization").unwrap(), "Bearer secret");
        assert_eq!(s.headers.as_ref().unwrap().get("X-Custom").unwrap(), "value");

        let rebuilt = build_server_json(s);
        assert_eq!(rebuilt["type"], "sse");
        assert_eq!(rebuilt["url"], "https://sse.example.com");
        assert_eq!(rebuilt["headers"]["Authorization"], "Bearer secret");
        assert_eq!(rebuilt["headers"]["X-Custom"], "value");
    }

    #[test]
    fn sse_without_headers_round_trip() {
        let val = serde_json::json!({
            "sse-plain": {
                "type": "sse",
                "url": "https://sse.example.com"
            }
        });
        let servers = parse_servers(&val, "global");
        let s = &servers[0];
        assert!(s.headers.is_none());

        let rebuilt = build_server_json(s);
        assert!(rebuilt.get("headers").is_none());
    }

    #[test]
    fn mcp_server_config_serializes_camel_case() {
        let server = McpServerConfig {
            name: "test".to_string(),
            scope: "global".to_string(),
            server_type: "stdio".to_string(),
            command: Some("npx".to_string()),
            args: None,
            env: None,
            url: None,
            headers: None,
        };
        let json = serde_json::to_string(&server).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        // Verify camelCase serialization
        assert!(parsed.get("serverType").is_some());
        assert!(parsed.get("server_type").is_none());
    }
}
