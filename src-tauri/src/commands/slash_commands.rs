use crate::agents::claude_code::session::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::State;
use tokio::process::Command;

/// Allowlist of commands permitted in skill template `!`cmd`!` expansion.
/// These should be read-only / informational commands only — never destructive.
const ALLOWED_TEMPLATE_COMMANDS: &[&str] = &[
    "basename", "cat", "date", "dirname", "echo", "env", "find", "git",
    "grep", "head", "hostname", "id", "ls", "node", "printenv", "printf",
    "pwd", "readlink", "tail", "test", "tr", "uname", "wc", "which", "whoami",
];

#[derive(Debug, Clone, Serialize)]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    pub category: String,
    pub source_path: Option<String>,
    pub argument_hint: Option<String>,
    pub model: Option<String>,
    pub user_invocable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExpandedSkill {
    pub prompt: String,
    pub allowed_tools: Option<Vec<String>>,
    pub model: Option<String>,
    pub context_fork: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OneshotResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Simple frontmatter parser — extracts key:value pairs between --- markers.
fn parse_frontmatter(content: &str) -> (std::collections::HashMap<String, String>, &str) {
    let mut map = std::collections::HashMap::new();
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (map, content);
    }

    let after_first = &trimmed[3..];
    if let Some(end_idx) = after_first.find("\n---") {
        let fm_block = &after_first[..end_idx];
        let body_start = 3 + end_idx + 4; // "---" + frontmatter + "\n---"
        let body = trimmed[body_start..].trim_start_matches('\n');

        for line in fm_block.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once(':') {
                map.insert(
                    key.trim().to_lowercase(),
                    value.trim().trim_matches('"').trim_matches('\'').to_string(),
                );
            }
        }
        (map, body)
    } else {
        (map, content)
    }
}

/// Scan a directory for .md command/skill files and return SlashCommands.
async fn scan_command_dir(dir: &Path, seen: &mut std::collections::HashSet<String>) -> Vec<SlashCommand> {
    let mut commands = Vec::new();

    let entries = match tokio::fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return commands,
    };

    let mut entries = entries;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        let content = match tokio::fs::read_to_string(&path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let (fm, _body) = parse_frontmatter(&content);

        // Derive name from filename (without .md)
        let name = fm
            .get("name")
            .cloned()
            .unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        // Skip if user-invocable is explicitly false
        let user_invocable = fm
            .get("user-invocable")
            .map(|v| v != "false")
            .unwrap_or(true);
        if !user_invocable {
            continue;
        }

        // Deduplicate — project-level overrides user-level
        if seen.contains(&name) {
            continue;
        }
        seen.insert(name.clone());

        let description = fm
            .get("description")
            .cloned()
            .unwrap_or_else(|| format!("Custom command: {}", name));
        let argument_hint = fm.get("argument-hint").cloned();
        let model = fm.get("model").cloned();

        commands.push(SlashCommand {
            name,
            description,
            category: "skill".to_string(),
            source_path: Some(path.to_string_lossy().to_string()),
            argument_hint,
            model,
            user_invocable,
        });
    }

    commands
}

/// Scan skill directories (each skill is a folder with SKILL.md).
async fn scan_skills_dir(dir: &Path, seen: &mut std::collections::HashSet<String>) -> Vec<SlashCommand> {
    let mut commands = Vec::new();

    let entries = match tokio::fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return commands,
    };

    let mut entries = entries;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }

        let content = match tokio::fs::read_to_string(&skill_file).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let (fm, _body) = parse_frontmatter(&content);

        let name = fm
            .get("name")
            .cloned()
            .unwrap_or_else(|| {
                path.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        let user_invocable = fm
            .get("user-invocable")
            .map(|v| v != "false")
            .unwrap_or(true);
        if !user_invocable {
            continue;
        }

        if seen.contains(&name) {
            continue;
        }
        seen.insert(name.clone());

        let description = fm
            .get("description")
            .cloned()
            .unwrap_or_else(|| format!("Skill: {}", name));
        let argument_hint = fm.get("argument-hint").cloned();
        let model = fm.get("model").cloned();

        commands.push(SlashCommand {
            name,
            description,
            category: "skill".to_string(),
            source_path: Some(skill_file.to_string_lossy().to_string()),
            argument_hint,
            model,
            user_invocable,
        });
    }

    commands
}

fn builtin_commands() -> Vec<SlashCommand> {
    let builtins = [
        ("clear", "Clear conversation and restart session"),
        ("compact", "Compact conversation context"),
        ("cost", "Show session cost and token stats"),
        ("context", "Show context window usage"),
        ("exit", "Close current session"),
        ("help", "Show help information"),
        ("rename", "Rename current session"),
    ];

    builtins
        .iter()
        .map(|(name, desc)| SlashCommand {
            name: name.to_string(),
            description: desc.to_string(),
            category: "built-in".to_string(),
            source_path: None,
            argument_hint: if *name == "rename" {
                Some("new name".to_string())
            } else {
                None
            },
            model: None,
            user_invocable: true,
        })
        .collect()
}

/// v1.5.0 — Codex equivalents of `cli_only_commands` (Claude). Verified
/// against `codex --help` on cli 0.137.0.
///
/// Two dispatch paths (the frontend `useCommandExecution.executeCliOnly`
/// branches on agent + name):
///   * `config` and `mcp` open the **CodexManagementPanel** — driven by
///     the app-server JSON-RPC config/MCP methods. (`codex config` is not
///     a real subcommand — it forwards to the interactive TUI — and
///     `codex mcp` exits without a subcommand, so a PTY overlay was
///     broken for both.)
///   * Everything else opens `CliOverlay` and spawns `codex <name>` in a
///     PTY (genuinely interactive / one-shot subcommands).
///
/// Missing entries: `exec` / `review` / `debug` / `mcp-server` /
/// `app-server` / `remote-control` / `cloud` / `exec-server` /
/// `completion` — non-interactive or protocol modes that don't belong in
/// the user-facing palette.
fn codex_cli_only_commands() -> Vec<SlashCommand> {
    let cli_only = [
        ("config", "Configure Codex (settings, MCP, account)"),
        ("apply", "Apply the latest diff to your working tree"),
        ("features", "Inspect feature flags"),
        ("fork", "Fork a previous interactive session"),
        ("login", "Manage Codex login"),
        ("logout", "Sign out of Codex"),
        ("mcp", "Manage external MCP servers"),
        ("plugin", "Manage Codex plugins"),
        ("resume", "Resume a previous interactive session"),
        ("sandbox", "Run a command in the Codex sandbox"),
        ("update", "Update Codex to the latest version"),
    ];

    cli_only
        .iter()
        .map(|(name, desc)| SlashCommand {
            name: name.to_string(),
            description: desc.to_string(),
            category: "cli-only".to_string(),
            source_path: None,
            argument_hint: None,
            model: None,
            user_invocable: true,
        })
        .collect()
}

fn cli_only_commands() -> Vec<SlashCommand> {
    let cli_only = [
        ("add-dir", "Add a directory to context"),
        ("agents", "Manage agent configurations"),
        ("bug", "Report a bug to Anthropic"),
        ("chrome", "Open Chrome DevTools"),
        ("config", "Configure Claude Code preferences"),
        ("copy", "Copy last response to clipboard"),
        ("desktop", "Open desktop integration"),
        ("diff", "Show session diff"),
        ("doctor", "Run Claude doctor diagnostics"),
        ("export", "Export conversation"),
        ("fast", "Toggle fast mode"),
        ("fork", "Fork current session"),
        ("hooks", "Manage hooks"),
        ("ide", "Open IDE integration"),
        ("init", "Initialize CLAUDE.md in project"),
        ("keybindings", "Configure keybindings"),
        ("login", "Log in to Claude"),
        ("logout", "Log out of Claude"),
        ("loop", "Run a prompt on a recurring interval"),
        ("mcp", "Manage MCP servers"),
        ("memory", "Edit CLAUDE.md memory"),
        ("model", "Change model"),
        ("permissions", "Manage permissions"),
        ("plan", "Toggle plan mode"),
        ("plugin", "Manage plugins"),
        ("release-notes", "Show release notes"),
        ("remote-control", "Remote control settings"),
        ("resume", "Resume a session"),
        ("rewind", "Rewind conversation"),
        ("sandbox", "Sandbox settings"),
        ("skills", "List available skills"),
        ("stats", "Show usage stats"),
        ("status", "Show status"),
        ("statusline", "Configure status line"),
        ("terminal-setup", "Set up terminal"),
        ("theme", "Change theme"),
        ("usage", "Show account usage and billing"),
        ("vim", "Toggle vim mode"),
    ];

    cli_only
        .iter()
        .map(|(name, desc)| SlashCommand {
            name: name.to_string(),
            description: desc.to_string(),
            category: "cli-only".to_string(),
            source_path: None,
            argument_hint: None,
            model: None,
            user_invocable: true,
        })
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn discover_commands(
    project_path: String,
    // v1.5.0 — agent-aware command discovery. Claude Code sessions
    // scan `.claude/{commands,skills}` and surface Claude's CLI
    // commands; Codex sessions scan `.codex/prompts/` and surface
    // NEITHER Claude's skills (e.g. /seo-audit) nor Claude's CLI
    // commands (e.g. /bug "Report to Anthropic"). Both keep the
    // CodeMantis-level built-ins (/clear, /context, /cost, …).
    // Legacy callers omit this — `Option` deserialises to `None`,
    // which the body treats as `claude_code`.
    agent_id: Option<String>,
) -> Result<Vec<SlashCommand>, String> {
    let mut seen = std::collections::HashSet::new();
    let mut all_commands = Vec::new();

    let project = PathBuf::from(&project_path);
    let home = dirs::home_dir().unwrap_or_default();
    let is_codex = agent_id.as_deref() == Some("codex");

    if is_codex {
        // Codex custom prompts: flat `.md` files in `$CODEX_HOME/prompts`
        // (default `~/.codex/prompts`) and the project-level equivalent.
        // Non-existent dirs scan to empty — Codex creates the dir
        // lazily when the user adds their first prompt.
        let codex_dirs: Vec<PathBuf> = vec![
            project.join(".codex").join("prompts"),
            home.join(".codex").join("prompts"),
        ];
        for dir in &codex_dirs {
            all_commands.extend(scan_command_dir(dir, &mut seen).await);
        }
    } else {
        // Claude Code: project first, then user-level.
        let scan_dirs: Vec<PathBuf> = vec![
            project.join(".claude").join("commands"),
            project.join(".claude").join("skills"),
            home.join(".claude").join("commands"),
            home.join(".claude").join("skills"),
        ];
        for (i, dir) in scan_dirs.iter().enumerate() {
            if i % 2 == 0 {
                all_commands.extend(scan_command_dir(dir, &mut seen).await);
            } else {
                all_commands.extend(scan_skills_dir(dir, &mut seen).await);
            }
        }
    }

    // Built-in commands are CodeMantis-level (clear / context / cost /
    // compact / exit / help / rename) — agent-agnostic, always shown.
    all_commands.extend(builtin_commands());

    // CLI-only commands open the agent's interactive CLI in a PTY
    // overlay (CliOverlay.tsx). Each agent has its own subcommand
    // grammar — Claude's /bug, /init, /login etc. vs Codex's /login,
    // /mcp, /apply etc. — so we surface them per-agent. The overlay
    // pauses the stream-json process, spawns the binary with the
    // chosen subcommand as argv, and resumes when the user closes it.
    if is_codex {
        all_commands.extend(codex_cli_only_commands());
    } else {
        all_commands.extend(cli_only_commands());
    }

    // Sort by category then name
    all_commands.sort_by(|a, b| {
        let cat_order = |c: &str| match c {
            "skill" => 0,
            "built-in" => 1,
            "cli-only" => 2,
            _ => 3,
        };
        cat_order(&a.category)
            .cmp(&cat_order(&b.category))
            .then(a.name.cmp(&b.name))
    });

    Ok(all_commands)
}

#[tauri::command]
pub async fn expand_skill(
    project_path: String,
    source_path: String,
    arguments: String,
    cli_session_id: String,
) -> Result<ExpandedSkill, String> {
    // Resolve symlinks and verify path is within allowed directories
    let canonical = tokio::fs::canonicalize(&source_path)
        .await
        .map_err(|e| format!("Failed to resolve skill path: {}", e))?;
    let home = dirs::home_dir().unwrap_or_default();
    let home_claude = home.join(".claude");
    let project_dir = tokio::fs::canonicalize(&project_path).await.unwrap_or_else(|_| PathBuf::from(&project_path));
    let project_claude = project_dir.join(".claude");
    if !canonical.starts_with(&home_claude) && !canonical.starts_with(&project_claude) {
        return Err(format!(
            "Skill file path '{}' is outside allowed directories",
            canonical.to_string_lossy()
        ));
    }

    let content = tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|e| format!("Failed to read skill file: {}", e))?;

    let (fm, body) = parse_frontmatter(&content);

    let allowed_tools = fm.get("allowed-tools").map(|v| {
        v.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
    });

    let model = fm.get("model").cloned();

    let context_fork = fm
        .get("context")
        .map(|v| v == "fork")
        .unwrap_or(false);

    // Expand template variables
    let args_parts: Vec<&str> = arguments.split_whitespace().collect();
    let mut prompt = body.to_string();

    // Expand !`command` patterns BEFORE argument substitution so user args
    // can never inject into shell commands (prevents command injection)
    prompt = expand_shell_commands(&prompt).await;

    // $ARGUMENTS or ${ARGUMENTS}
    prompt = prompt.replace("$ARGUMENTS", &arguments);
    prompt = prompt.replace("${ARGUMENTS}", &arguments);

    // $0..$9 and $ARGUMENTS[0]..$ARGUMENTS[9]
    for i in 0..10 {
        let val = args_parts.get(i).copied().unwrap_or("");
        prompt = prompt.replace(&format!("${}", i), val);
        prompt = prompt.replace(&format!("$ARGUMENTS[{}]", i), val);
    }

    // ${CLAUDE_SESSION_ID}
    prompt = prompt.replace("${CLAUDE_SESSION_ID}", &cli_session_id);

    // ${CLAUDE_SKILL_DIR}
    let skill_dir = canonical
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    prompt = prompt.replace("${CLAUDE_SKILL_DIR}", &skill_dir);

    Ok(ExpandedSkill {
        prompt,
        allowed_tools,
        model,
        context_fork,
    })
}

/// Expand !`command` patterns by executing shell commands (10s timeout).
async fn expand_shell_commands(text: &str) -> String {
    let mut result = String::new();
    let mut remaining = text;

    while let Some(start) = remaining.find("!`") {
        result.push_str(&remaining[..start]);
        let after_marker = &remaining[start + 2..];

        if let Some(end) = after_marker.find('`') {
            let cmd = &after_marker[..end];
            let output = execute_shell_command(cmd).await;
            result.push_str(&output);
            remaining = &after_marker[end + 1..];
        } else {
            // No closing backtick — keep as-is
            result.push_str("!`");
            remaining = after_marker;
        }
    }

    result.push_str(remaining);
    result
}

/// Validate that a template shell command starts with an allowed binary.
fn validate_template_command(cmd: &str) -> Result<(), String> {
    let trimmed = cmd.trim();
    let first_token = trimmed
        .split(|c: char| c.is_whitespace() || c == ';' || c == '&' || c == '|')
        .find(|s| !s.is_empty() && !s.contains('='))
        .unwrap_or("");
    let basename = first_token.rsplit('/').next().unwrap_or(first_token);

    if basename.is_empty() {
        return Err("Empty template command".to_string());
    }
    if ALLOWED_TEMPLATE_COMMANDS.contains(&basename) {
        return Ok(());
    }
    Err(format!(
        "Template command '{}' is not in the allowed list",
        basename
    ))
}

async fn execute_shell_command(cmd: &str) -> String {
    if let Err(e) = validate_template_command(cmd) {
        return format!("[blocked: {}]", e);
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        Command::new("sh")
            .arg("-c")
            .arg(cmd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;

    match output {
        Ok(Ok(out)) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        Ok(Err(e)) => format!("[command error: {}]", e),
        Err(_) => "[command timed out]".to_string(),
    }
}

#[tauri::command]
pub async fn run_oneshot_command(
    project_path: String,
    args: Vec<String>,
    state: State<'_, AppState>,
) -> Result<OneshotResult, String> {
    let binary_str = {
        let guard = state.claude_binary.lock().await;
        guard
            .as_deref()
            .ok_or_else(|| "Claude binary not found".to_string())?
            .to_string()
    };

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        Command::new(&binary_str)
            .args(&args)
            .current_dir(&project_path)
            .output(),
    )
    .await
    .map_err(|_| "Command timed out after 30s".to_string())?
    .map_err(|e| format!("Failed to run command: {}", e))?;

    Ok(OneshotResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use tempfile::TempDir;

    fn temp_dir() -> TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // ── parse_frontmatter ──

    #[test]
    fn parse_frontmatter_empty_string_returns_empty_map() {
        let (map, body) = parse_frontmatter("");
        assert!(map.is_empty());
        assert_eq!(body, "");
    }

    #[test]
    fn parse_frontmatter_no_frontmatter_returns_empty_map() {
        let content = "Just some regular content\nwith multiple lines.";
        let (map, body) = parse_frontmatter(content);
        assert!(map.is_empty());
        assert_eq!(body, content);
    }

    #[test]
    fn parse_frontmatter_valid_extracts_key_value_pairs() {
        let content = "---\nname: my-command\n---\nBody content here";
        let (map, _body) = parse_frontmatter(content);
        assert_eq!(map.get("name").unwrap(), "my-command");
    }

    #[test]
    fn parse_frontmatter_description_field() {
        let content = "---\ndescription: A helpful command\n---\nBody";
        let (map, _body) = parse_frontmatter(content);
        assert_eq!(map.get("description").unwrap(), "A helpful command");
    }

    #[test]
    fn parse_frontmatter_ignores_content_after_closing() {
        let content = "---\nname: test\n---\nThis is the body.\nIt has multiple lines.";
        let (map, body) = parse_frontmatter(content);
        assert_eq!(map.len(), 1);
        assert!(body.starts_with("This is the body."));
    }

    #[test]
    fn parse_frontmatter_body_preserved_after_frontmatter() {
        let content = "---\nname: foo\n---\nLine 1\nLine 2\nLine 3";
        let (_map, body) = parse_frontmatter(content);
        assert!(body.contains("Line 1"));
        assert!(body.contains("Line 2"));
        assert!(body.contains("Line 3"));
    }

    #[test]
    fn parse_frontmatter_multiple_key_value_pairs() {
        let content = "---\nname: multi\ndescription: A multi-key command\nmodel: fast\nargument-hint: <file>\n---\nBody";
        let (map, _body) = parse_frontmatter(content);
        assert_eq!(map.len(), 4);
        assert_eq!(map.get("name").unwrap(), "multi");
        assert_eq!(map.get("description").unwrap(), "A multi-key command");
        assert_eq!(map.get("model").unwrap(), "fast");
        assert_eq!(map.get("argument-hint").unwrap(), "<file>");
    }

    #[test]
    fn parse_frontmatter_strips_quotes_from_values() {
        let content = "---\nname: \"quoted-name\"\ndescription: 'single-quoted'\n---\nBody";
        let (map, _body) = parse_frontmatter(content);
        assert_eq!(map.get("name").unwrap(), "quoted-name");
        assert_eq!(map.get("description").unwrap(), "single-quoted");
    }

    #[test]
    fn parse_frontmatter_keys_are_lowercased() {
        let content = "---\nName: test\nDESCRIPTION: caps\n---\nBody";
        let (map, _body) = parse_frontmatter(content);
        assert_eq!(map.get("name").unwrap(), "test");
        assert_eq!(map.get("description").unwrap(), "caps");
    }

    #[test]
    fn parse_frontmatter_skips_comment_lines() {
        let content = "---\nname: test\n# this is a comment\ndescription: desc\n---\nBody";
        let (map, _body) = parse_frontmatter(content);
        assert_eq!(map.len(), 2);
        assert_eq!(map.get("name").unwrap(), "test");
        assert_eq!(map.get("description").unwrap(), "desc");
    }

    #[test]
    fn parse_frontmatter_unclosed_returns_original() {
        let content = "---\nname: test\nNo closing delimiter";
        let (map, body) = parse_frontmatter(content);
        assert!(map.is_empty());
        assert_eq!(body, content);
    }

    // ── builtin_commands ──

    #[test]
    fn builtin_commands_returns_non_empty() {
        let cmds = builtin_commands();
        assert!(!cmds.is_empty());
    }

    #[test]
    fn builtin_commands_contains_clear() {
        let cmds = builtin_commands();
        assert!(cmds.iter().any(|c| c.name == "clear"));
    }

    #[test]
    fn builtin_commands_contains_help() {
        let cmds = builtin_commands();
        assert!(cmds.iter().any(|c| c.name == "help"));
    }

    #[test]
    fn builtin_commands_contains_exit() {
        let cmds = builtin_commands();
        assert!(cmds.iter().any(|c| c.name == "exit"));
    }

    #[test]
    fn builtin_commands_all_have_builtin_category() {
        let cmds = builtin_commands();
        for cmd in &cmds {
            assert_eq!(cmd.category, "built-in", "Command '{}' has wrong category", cmd.name);
        }
    }

    #[test]
    fn builtin_commands_rename_has_argument_hint() {
        let cmds = builtin_commands();
        let rename = cmds.iter().find(|c| c.name == "rename").unwrap();
        assert!(rename.argument_hint.is_some());
        assert_eq!(rename.argument_hint.as_deref().unwrap(), "new name");
    }

    // ── cli_only_commands ──

    #[test]
    fn cli_only_commands_returns_non_empty() {
        let cmds = cli_only_commands();
        assert!(!cmds.is_empty());
    }

    #[test]
    fn cli_only_commands_contains_config() {
        let cmds = cli_only_commands();
        assert!(cmds.iter().any(|c| c.name == "config"));
    }

    #[test]
    fn cli_only_commands_contains_model() {
        let cmds = cli_only_commands();
        assert!(cmds.iter().any(|c| c.name == "model"));
    }

    #[test]
    fn cli_only_commands_contains_usage() {
        let cmds = cli_only_commands();
        assert!(cmds.iter().any(|c| c.name == "usage"));
    }

    #[test]
    fn cli_only_commands_contains_bug() {
        let cmds = cli_only_commands();
        assert!(cmds.iter().any(|c| c.name == "bug"));
    }

    #[test]
    fn cli_only_commands_contains_loop() {
        let cmds = cli_only_commands();
        assert!(cmds.iter().any(|c| c.name == "loop"));
    }

    #[test]
    fn cli_only_commands_all_have_cli_only_category() {
        let cmds = cli_only_commands();
        for cmd in &cmds {
            assert_eq!(cmd.category, "cli-only", "Command '{}' has wrong category", cmd.name);
        }
    }

    // ── v1.5.0 — Codex cli-only commands ──

    #[test]
    fn codex_cli_only_commands_returns_non_empty() {
        assert!(!codex_cli_only_commands().is_empty());
    }

    #[test]
    fn codex_cli_only_commands_contains_login_and_mcp_and_apply() {
        // Empirically verified against `codex --help` on cli 0.130.0.
        // login + mcp are the most common configuration commands;
        // apply is the most common workflow command.
        let cmds = codex_cli_only_commands();
        let names: Vec<&str> = cmds.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"login"));
        assert!(names.contains(&"mcp"));
        assert!(names.contains(&"apply"));
    }

    #[test]
    fn codex_cli_only_commands_excludes_non_interactive_subcommands() {
        // exec / review / debug / mcp-server / app-server etc. are
        // non-interactive or protocol modes — surfacing them in the
        // user-facing palette would be misleading.
        let cmds = codex_cli_only_commands();
        let names: Vec<&str> = cmds.iter().map(|c| c.name.as_str()).collect();
        assert!(!names.contains(&"exec"));
        assert!(!names.contains(&"review"));
        assert!(!names.contains(&"debug"));
        assert!(!names.contains(&"mcp-server"));
        assert!(!names.contains(&"app-server"));
    }

    #[test]
    fn codex_cli_only_commands_all_have_cli_only_category() {
        for cmd in &codex_cli_only_commands() {
            assert_eq!(cmd.category, "cli-only");
        }
    }

    // ── expand_shell_commands (template expansion) ──

    #[tokio::test]
    async fn expand_shell_commands_no_markers_returns_unchanged() {
        let input = "This has no shell commands at all.";
        let result = expand_shell_commands(input).await;
        assert_eq!(result, input);
    }

    #[tokio::test]
    async fn expand_shell_commands_runs_echo() {
        let input = "Hello !`echo world`!";
        let result = expand_shell_commands(input).await;
        assert_eq!(result, "Hello world!");
    }

    #[tokio::test]
    async fn expand_shell_commands_unclosed_backtick_preserved() {
        let input = "Start !`no closing backtick here";
        let result = expand_shell_commands(input).await;
        assert_eq!(result, "Start !`no closing backtick here");
    }

    // ── validate_template_command ──

    #[test]
    fn validate_template_command_allows_echo() {
        assert!(validate_template_command("echo hello").is_ok());
    }

    #[test]
    fn validate_template_command_allows_git() {
        assert!(validate_template_command("git branch --show-current").is_ok());
    }

    #[test]
    fn validate_template_command_allows_pwd() {
        assert!(validate_template_command("pwd").is_ok());
    }

    #[test]
    fn validate_template_command_allows_uname() {
        assert!(validate_template_command("uname -a").is_ok());
    }

    #[test]
    fn validate_template_command_allows_which() {
        assert!(validate_template_command("which node").is_ok());
    }

    #[test]
    fn validate_template_command_allows_full_path() {
        assert!(validate_template_command("/usr/bin/git status").is_ok());
    }

    #[test]
    fn validate_template_command_allows_env_prefix() {
        assert!(validate_template_command("FOO=bar echo test").is_ok());
    }

    #[test]
    fn validate_template_command_blocks_rm() {
        let result = validate_template_command("rm -rf /");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not in the allowed list"));
    }

    #[test]
    fn validate_template_command_blocks_curl() {
        assert!(validate_template_command("curl https://evil.com").is_err());
    }

    #[test]
    fn validate_template_command_blocks_wget() {
        assert!(validate_template_command("wget https://evil.com").is_err());
    }

    #[test]
    fn validate_template_command_blocks_python() {
        assert!(validate_template_command("python3 -c 'import os; os.system(\"rm -rf /\")'").is_err());
    }

    #[test]
    fn validate_template_command_blocks_bash() {
        assert!(validate_template_command("bash -c 'dangerous stuff'").is_err());
    }

    #[test]
    fn validate_template_command_blocks_sh() {
        assert!(validate_template_command("sh -c 'evil'").is_err());
    }

    #[test]
    fn validate_template_command_blocks_chmod() {
        assert!(validate_template_command("chmod 777 /etc/passwd").is_err());
    }

    #[test]
    fn validate_template_command_rejects_empty() {
        let result = validate_template_command("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Empty template command"));
    }

    #[test]
    fn validate_template_command_rejects_whitespace_only() {
        assert!(validate_template_command("   ").is_err());
    }

    #[tokio::test]
    async fn expand_shell_commands_blocks_dangerous_command() {
        let input = "Before !`rm -rf /tmp/test` after";
        let result = expand_shell_commands(input).await;
        assert!(result.contains("[blocked:"));
        assert!(result.contains("not in the allowed list"));
    }

    #[tokio::test]
    async fn expand_shell_commands_allows_safe_commands() {
        let input = "Branch: !`echo main`";
        let result = expand_shell_commands(input).await;
        assert_eq!(result, "Branch: main");
    }

    // ── scan_command_dir ──

    #[tokio::test]
    async fn scan_command_dir_nonexistent_returns_empty() {
        let dir = PathBuf::from("/nonexistent_dir_12345_test");
        let mut seen = HashSet::new();
        let result = scan_command_dir(&dir, &mut seen).await;
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn scan_command_dir_with_md_files_returns_commands() {
        let dir = temp_dir();
        let cmd_file = dir.path().join("greet.md");
        std::fs::write(&cmd_file, "---\ndescription: Greet user\n---\nHello $ARGUMENTS").unwrap();

        let mut seen = HashSet::new();
        let result = scan_command_dir(dir.path(), &mut seen).await;
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "greet");
        assert_eq!(result[0].description, "Greet user");
        assert_eq!(result[0].category, "skill");
    }

    #[tokio::test]
    async fn scan_command_dir_skips_already_seen_names() {
        let dir = temp_dir();
        let cmd_file = dir.path().join("deploy.md");
        std::fs::write(&cmd_file, "---\ndescription: Deploy\n---\nDeploy it").unwrap();

        let mut seen = HashSet::new();
        seen.insert("deploy".to_string());
        let result = scan_command_dir(dir.path(), &mut seen).await;
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn scan_command_dir_skips_non_md_files() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("readme.txt"), "Not a command").unwrap();
        std::fs::write(dir.path().join("script.sh"), "#!/bin/bash").unwrap();

        let mut seen = HashSet::new();
        let result = scan_command_dir(dir.path(), &mut seen).await;
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn scan_command_dir_skips_user_invocable_false() {
        let dir = temp_dir();
        let cmd_file = dir.path().join("hidden.md");
        std::fs::write(&cmd_file, "---\nuser-invocable: false\n---\nHidden command").unwrap();

        let mut seen = HashSet::new();
        let result = scan_command_dir(dir.path(), &mut seen).await;
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn scan_command_dir_uses_frontmatter_name_over_filename() {
        let dir = temp_dir();
        let cmd_file = dir.path().join("filename.md");
        std::fs::write(&cmd_file, "---\nname: custom-name\ndescription: Custom\n---\nBody").unwrap();

        let mut seen = HashSet::new();
        let result = scan_command_dir(dir.path(), &mut seen).await;
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "custom-name");
    }

    // ── v1.5.0 — agent-aware discover_commands ──

    #[tokio::test]
    async fn discover_commands_codex_session_scans_codex_prompts_not_claude_skills() {
        // A project with BOTH a Claude skill and a Codex prompt.
        let project = temp_dir();
        let claude_skill = project.path().join(".claude").join("skills").join("zzclaudeskill");
        std::fs::create_dir_all(&claude_skill).unwrap();
        std::fs::write(
            claude_skill.join("SKILL.md"),
            "---\nname: zzclaudeskill\ndescription: A Claude skill\n---\nBody",
        )
        .unwrap();
        let codex_prompts = project.path().join(".codex").join("prompts");
        std::fs::create_dir_all(&codex_prompts).unwrap();
        std::fs::write(
            codex_prompts.join("zzcodexprompt.md"),
            "---\ndescription: A Codex prompt\n---\nBody",
        )
        .unwrap();

        let path = project.path().to_string_lossy().to_string();

        // Codex session: sees the Codex prompt + Codex CLI commands
        // (login, mcp, apply, ...), NOT the Claude skill, NOT Claude's
        // CLI-only commands (/bug "Report to Anthropic" etc.).
        let codex_cmds = discover_commands(path.clone(), Some("codex".into()))
            .await
            .unwrap();
        let names: Vec<&str> = codex_cmds.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"zzcodexprompt"), "codex prompt missing");
        assert!(!names.contains(&"zzclaudeskill"), "claude skill leaked into codex");
        assert!(!names.contains(&"bug"), "claude CLI command leaked into codex");
        // Built-ins are agent-agnostic — still present.
        assert!(names.contains(&"clear"), "built-in /clear missing for codex");
        // Codex CLI commands ARE present (v1.5.0 — overlay dispatch
        // spawns `codex <name>` directly).
        assert!(names.contains(&"login"), "codex /login missing");
        assert!(names.contains(&"mcp"), "codex /mcp missing");
        assert!(names.contains(&"apply"), "codex /apply missing");
        assert!(!names.contains(&"doctor"), "claude /doctor leaked into codex");

        // Claude session: sees the Claude skill + CLI commands, NOT the
        // Codex prompt.
        let claude_cmds = discover_commands(path, Some("claude_code".into()))
            .await
            .unwrap();
        let cnames: Vec<&str> = claude_cmds.iter().map(|c| c.name.as_str()).collect();
        assert!(cnames.contains(&"zzclaudeskill"), "claude skill missing");
        assert!(cnames.contains(&"bug"), "claude CLI command missing");
        assert!(!cnames.contains(&"zzcodexprompt"), "codex prompt leaked into claude");
        assert!(cnames.contains(&"clear"), "built-in /clear missing for claude");
    }

    #[tokio::test]
    async fn discover_commands_legacy_none_agent_defaults_to_claude() {
        // Callers that omit agent_id (legacy) get the Claude behaviour.
        let project = temp_dir();
        let cmds = discover_commands(
            project.path().to_string_lossy().to_string(),
            None,
        )
        .await
        .unwrap();
        let names: Vec<&str> = cmds.iter().map(|c| c.name.as_str()).collect();
        // Claude CLI-only commands present → defaulted to claude_code.
        assert!(names.contains(&"bug"));
    }
}
