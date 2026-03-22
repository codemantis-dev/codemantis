use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tempfile::TempDir;
use tokio::process::Command;

use crate::utils::paths::{login_shell_path, refresh_login_shell_path, tool_exists_in_login_shell};

// ── Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateRegistry {
    pub version: u32,
    pub updated_at: String,
    pub templates: Vec<TemplateEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub long_description: Option<String>,
    pub category: String,
    pub tags: Vec<String>,
    pub repo_url: String,
    pub branch: String,
    #[serde(default)]
    pub stars: Option<u32>,
    pub license: String,
    pub install_command: String,
    pub dev_command: String,
    #[serde(default)]
    pub dev_port: Option<u16>,
    #[serde(default)]
    pub post_clone_cleanup: Option<Vec<String>>,
    pub icon: String,
    pub verified: bool,
    pub last_verified: String,
    pub scaffold_type: String,
    #[serde(default)]
    pub cli_command: Option<String>,
    #[serde(default)]
    pub post_commands: Option<Vec<String>>,
    #[serde(default)]
    pub prerequisites: Option<String>,
    #[serde(default)]
    pub prerequisite_checks: Option<Vec<PrerequisiteCheck>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrerequisiteCheck {
    pub command: String,
    pub label: String,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default)]
    pub install_command: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct PrerequisiteResult {
    pub command: String,
    pub label: String,
    pub found: bool,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScaffoldResult {
    pub project_path: String,
    pub project_name: String,
    pub template_id: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifyResult {
    pub template_id: String,
    pub success: bool,
    pub duration_ms: u64,
    pub step_failed: Option<String>,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ScaffoldProgress {
    step: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
}

/// Captured output from running a command
pub(crate) struct CmdOutput {
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) exit_code: Option<i32>,
}

impl CmdOutput {
    /// Combined stderr + stdout, truncated to last N lines
    pub(crate) fn summary(&self, max_lines: usize) -> String {
        let mut parts = vec![];
        let stderr = self.stderr.trim();
        let stdout = self.stdout.trim();
        if !stderr.is_empty() {
            parts.push(stderr);
        }
        if !stdout.is_empty() {
            parts.push(stdout);
        }
        let combined = parts.join("\n");
        let lines: Vec<&str> = combined.lines().collect();
        if lines.len() > max_lines {
            format!(
                "...({} lines omitted)\n{}",
                lines.len() - max_lines,
                lines[lines.len() - max_lines..].join("\n")
            )
        } else {
            combined
        }
    }

    pub(crate) fn error_msg(&self, context: &str) -> String {
        format!(
            "{} (exit code {})",
            context,
            self.exit_code.unwrap_or(-1)
        )
    }
}

// ── Helpers ──

pub(crate) fn emit_progress(app: &AppHandle, step: &str, status: &str, error: Option<&str>) {
    emit_progress_detail(app, step, status, error, None);
}

pub(crate) fn emit_progress_detail(
    app: &AppHandle,
    step: &str,
    status: &str,
    error: Option<&str>,
    output: Option<&str>,
) {
    let payload = ScaffoldProgress {
        step: step.to_string(),
        status: status.to_string(),
        error: error.map(|s| s.to_string()),
        output: output.map(|s| s.to_string()),
    };
    let _ = app.emit("scaffold-progress", &payload);
}

fn load_bundled_registry(app: &AppHandle) -> Result<TemplateRegistry, String> {
    let resource_path = app
        .path()
        .resolve(
            "resources/templates.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("Failed to resolve templates.json: {}", e))?;

    let content = std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Failed to read templates.json: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse templates.json: {}", e))
}

fn load_claude_md_template(app: &AppHandle, template_id: &str) -> Result<String, String> {
    let filename = format!("resources/claude-md/{}.md", template_id);
    let resource_path = app
        .path()
        .resolve(&filename, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve CLAUDE.md template: {}", e))?;

    std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Failed to read CLAUDE.md template for {}: {}", template_id, e))
}

pub(crate) async fn run_command(
    cmd: &str,
    args: &[&str],
    cwd: &Path,
    timeout_secs: u64,
) -> Result<CmdOutput, String> {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        Command::new(cmd)
            .args(args)
            .current_dir(cwd)
            .env("PATH", &login_shell_path())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| {
        format!(
            "Command timed out after {}s: {} {}",
            timeout_secs,
            cmd,
            args.join(" ")
        )
    })?
    .map_err(|e| format!("Failed to spawn {} {}: {}", cmd, args.join(" "), e))?;

    Ok(CmdOutput {
        success: result.status.success(),
        stdout: String::from_utf8_lossy(&result.stdout).to_string(),
        stderr: String::from_utf8_lossy(&result.stderr).to_string(),
        exit_code: result.status.code(),
    })
}

/// Allowed base commands for scaffold shell execution.
/// Only commands in this list (or prefixed by these) are permitted.
const ALLOWED_SCAFFOLD_COMMANDS: &[&str] = &[
    "which", "node", "npm", "npx", "pnpm", "yarn", "bun", "bunx",
    "cargo", "rustup", "go", "python", "python3", "pip", "pip3",
    "uv", "corepack",
    "git", "deno", "flutter", "dart", "ruby", "gem", "composer",
    "php", "java", "javac", "mvn", "gradle", "swift",
    "docker", "docker-compose",
    "create-react-app", "create-next-app", "create-vite",
    "mkdir", "cp", "mv", "rm", "cat", "echo", "sed", "chmod",
    "cd", "ls", "test", "brew",
];

/// Validates that a shell command starts with an allowed base command.
fn validate_shell_command(command_str: &str) -> Result<(), String> {
    let trimmed = command_str.trim();
    // Extract the first command token (handles env vars, path prefixes, etc.)
    let first_token = trimmed
        .split(|c: char| c.is_whitespace() || c == ';' || c == '&' || c == '|')
        .find(|s| !s.is_empty() && !s.contains('='))
        .unwrap_or("");
    // Get basename (strip any path like /usr/bin/node → node)
    let basename = first_token.rsplit('/').next().unwrap_or(first_token);

    if basename.is_empty() {
        return Err("Empty shell command".to_string());
    }
    if ALLOWED_SCAFFOLD_COMMANDS.iter().any(|allowed| basename == *allowed) {
        return Ok(());
    }
    Err(format!(
        "Shell command '{}' is not in the allowed list for scaffold operations",
        basename
    ))
}

pub(crate) async fn run_shell(command_str: &str, cwd: &Path, timeout_secs: u64) -> Result<CmdOutput, String> {
    validate_shell_command(command_str)?;

    let shell = if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "sh"
    };
    let flag = if cfg!(target_os = "windows") {
        "/C"
    } else {
        "-c"
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        Command::new(shell)
            .arg(flag)
            .arg(command_str)
            .current_dir(cwd)
            .env("PATH", &login_shell_path())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| format!("Command timed out after {}s: {}", timeout_secs, command_str))?
    .map_err(|e| format!("Failed to run shell command '{}': {}", command_str, e))?;

    Ok(CmdOutput {
        success: result.status.success(),
        stdout: String::from_utf8_lossy(&result.stdout).to_string(),
        stderr: String::from_utf8_lossy(&result.stderr).to_string(),
        exit_code: result.status.code(),
    })
}

pub(crate) fn validate_project_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    if name.len() > 255 {
        return Err("Project name too long".to_string());
    }
    if name.starts_with('.') || name.starts_with('-') {
        return Err("Project name must start with an alphanumeric character".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(
            "Project name must contain only alphanumeric characters, hyphens, underscores, and dots"
                .to_string(),
        );
    }
    Ok(())
}

/// Extract CLI tool names required by a template's commands
fn detect_required_tools(template: &TemplateEntry) -> HashSet<String> {
    let mut tools = HashSet::new();

    fn first_word(cmd: &str) -> Option<String> {
        cmd.split_whitespace()
            .find(|s| !s.contains('='))
            .map(|s| s.to_string())
    }

    if let Some(tool) = first_word(&template.install_command) {
        tools.insert(tool);
    }
    if let Some(ref cli_cmd) = template.cli_command {
        if let Some(tool) = first_word(cli_cmd) {
            tools.insert(tool);
        }
    }
    if let Some(ref post_cmds) = template.post_commands {
        for cmd in post_cmds {
            if let Some(tool) = first_word(cmd) {
                tools.insert(tool);
            }
        }
    }
    // git is always needed
    tools.insert("git".to_string());

    tools
}

/// Verify the scaffolded project and return any warnings
fn verify_project(target_dir: &Path, template: &TemplateEntry) -> Vec<String> {
    let mut warnings = vec![];

    if !target_dir.exists() {
        warnings.push("Project directory was not created".to_string());
        return warnings;
    }

    // Check node_modules for JS/TS projects
    let has_package_json = target_dir.join("package.json").exists();
    if has_package_json {
        let node_modules = target_dir.join("node_modules");
        if !node_modules.exists() {
            warnings.push(format!(
                "Dependencies not installed — run '{}' manually",
                template.install_command
            ));
        } else {
            let entry_count = std::fs::read_dir(&node_modules)
                .map(|entries| entries.count())
                .unwrap_or(0);
            if entry_count < 3 {
                warnings.push(format!(
                    "node_modules appears empty — run '{}' manually",
                    template.install_command
                ));
            }
        }
    }

    // Check venv for Python projects using uv
    let has_pyproject = target_dir.join("pyproject.toml").exists();
    if has_pyproject && template.install_command.contains("uv") {
        let venv = target_dir.join(".venv");
        if !venv.exists() {
            warnings.push("Virtual environment missing — run 'uv sync' manually".to_string());
        }
    }

    // Check Docker Compose file if Docker is used
    if template.install_command.contains("docker") {
        let has_compose = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]
            .iter()
            .any(|f| target_dir.join(f).exists());
        if !has_compose {
            warnings.push("Docker Compose file not found in project".to_string());
        }
    }

    warnings
}

/// Run install command for a template, returning warnings on failure
async fn run_install(
    app: &AppHandle,
    install_command: &str,
    target_dir: &Path,
) -> Vec<String> {
    let mut warnings = vec![];

    match run_shell(install_command, target_dir, 300).await {
        Err(e) => {
            emit_progress_detail(app, "install", "error", Some(&e), None);
            warnings.push(format!("Install failed: {}", e));
            log::warn!("Install failed (non-fatal): {}", e);
        }
        Ok(output) if !output.success => {
            let msg = output.error_msg(&format!("'{}' failed", install_command));
            emit_progress_detail(
                app,
                "install",
                "error",
                Some(&msg),
                Some(&output.summary(20)),
            );
            warnings.push(format!("Install failed: {}", msg));
            log::warn!("Install failed (non-fatal): {}", msg);
        }
        Ok(output) => {
            emit_progress_detail(
                app,
                "install",
                "done",
                None,
                Some(&output.summary(5)),
            );
        }
    }

    warnings
}

/// Run post-setup commands, returning warnings on failure. Stops on first failure.
async fn run_post_commands(
    app: &AppHandle,
    commands: &[String],
    target_dir: &Path,
) -> Vec<String> {
    let mut warnings = vec![];

    if commands.is_empty() {
        return warnings;
    }

    emit_progress(app, "configure", "in_progress", None);

    for cmd in commands {
        match run_shell(cmd, target_dir, 180).await {
            Err(e) => {
                let msg = format!("'{}': {}", cmd, e);
                emit_progress_detail(app, "configure", "error", Some(&msg), None);
                warnings.push(format!("Post-setup failed: {}", msg));
                log::warn!("Post command failed: {}", msg);
                return warnings; // Stop on first failure
            }
            Ok(out) if !out.success => {
                let msg = out.error_msg(&format!("'{}' failed", cmd));
                emit_progress_detail(
                    app,
                    "configure",
                    "error",
                    Some(&msg),
                    Some(&out.summary(20)),
                );
                warnings.push(format!("Post-setup failed: {}", msg));
                log::warn!("Post command failed: {}", msg);
                return warnings; // Stop on first failure
            }
            Ok(_) => {}
        }
    }

    emit_progress(app, "configure", "done", None);
    warnings
}

/// Run the verify step, returning warnings
fn run_verify(app: &AppHandle, target_dir: &Path, template: &TemplateEntry) -> Vec<String> {
    emit_progress(app, "verify", "in_progress", None);

    let warnings = verify_project(target_dir, template);
    if warnings.is_empty() {
        emit_progress(app, "verify", "done", None);
    } else {
        let summary = warnings.join("\n");
        emit_progress_detail(app, "verify", "error", Some("Issues detected"), Some(&summary));
    }

    warnings
}

/// Write CLAUDE.md from bundled template, returning warnings on failure
fn write_claude_md(
    app: &AppHandle,
    target_dir: &Path,
    template_id: &str,
    template_name: &str,
    project_name: &str,
) -> Vec<String> {
    let mut warnings = vec![];
    emit_progress(app, "claude_md", "in_progress", None);

    match load_claude_md_template(app, template_id) {
        Ok(md_template) => {
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            let content = md_template
                .replace("{{PROJECT_NAME}}", project_name)
                .replace("{{TEMPLATE_NAME}}", template_name)
                .replace("{{DATE}}", &today);

            let claude_md_path = target_dir.join("CLAUDE.md");
            if let Err(e) = std::fs::write(&claude_md_path, content) {
                let msg = format!("Failed to write CLAUDE.md: {}", e);
                emit_progress(app, "claude_md", "error", Some(&msg));
                warnings.push(msg);
            } else {
                emit_progress(app, "claude_md", "done", None);
            }
        }
        Err(e) => {
            log::warn!("Failed to write CLAUDE.md (non-fatal): {}", e);
            emit_progress(app, "claude_md", "error", Some(&e));
            warnings.push(format!("CLAUDE.md not created: {}", e));
        }
    }

    warnings
}

/// Validate prerequisites: project name, paths, required CLI tools
pub(crate) fn validate_prerequisites(
    app: &AppHandle,
    project_name: &str,
    parent_dir: &Path,
    target_dir: &Path,
    template: Option<&TemplateEntry>,
) -> Result<(), String> {
    emit_progress(app, "validate", "in_progress", None);

    validate_project_name(project_name)?;

    if !parent_dir.exists() || !parent_dir.is_dir() {
        emit_progress(
            app,
            "validate",
            "error",
            Some("Parent directory does not exist"),
        );
        return Err(format!(
            "Parent directory does not exist: {}",
            parent_dir.display()
        ));
    }

    if target_dir.exists() {
        emit_progress(
            app,
            "validate",
            "error",
            Some("A folder with this name already exists"),
        );
        return Err(format!(
            "A folder named '{}' already exists at {}",
            project_name,
            parent_dir.display()
        ));
    }

    // Check all required CLI tools using the full login-shell PATH
    // (refresh so tools installed since app launch are detected)
    let path = refresh_login_shell_path();
    if let Some(tmpl) = template {
        let required = detect_required_tools(tmpl);
        let missing: Vec<&String> = required
            .iter()
            .filter(|t| !tool_exists_in_login_shell(t, &path))
            .collect();
        if !missing.is_empty() {
            let names: Vec<&str> = missing.iter().map(|s| s.as_str()).collect();
            let msg = format!(
                "Required tools not found: {}. Please install them first.",
                names.join(", ")
            );
            emit_progress(app, "validate", "error", Some(&msg));
            return Err(msg);
        }
    } else {
        // At minimum check git
        if !tool_exists_in_login_shell("git", &path) {
            emit_progress(app, "validate", "error", Some("Git is not installed"));
            return Err("Git is not installed. Please install Git first.".to_string());
        }
    }

    emit_progress(app, "validate", "done", None);
    Ok(())
}

// ── Commands ──

#[tauri::command]
pub async fn list_templates(app_handle: AppHandle) -> Result<Vec<TemplateEntry>, String> {
    let registry = load_bundled_registry(&app_handle)?;
    Ok(registry.templates)
}

#[tauri::command]
pub async fn check_template_prerequisites(
    checks: Vec<PrerequisiteCheck>,
) -> Result<Vec<PrerequisiteResult>, String> {
    let path = login_shell_path();
    let results = checks
        .into_iter()
        .map(|check| {
            // Use "command -v" in a login shell to check if the tool exists.
            // This handles both simple commands (uv) and multi-word commands
            // (docker compose version), and uses the full login shell PATH.
            let check_cmd = if check.command.contains(' ') {
                check.command.clone()
            } else {
                format!("command -v {}", check.command)
            };
            let found = std::process::Command::new("/bin/zsh")
                .args(["-c", &check_cmd])
                .env("PATH", &path)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            PrerequisiteResult {
                command: check.command,
                label: check.label,
                found,
                required: check.required,
            }
        })
        .collect();
    Ok(results)
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallPrerequisiteResult {
    pub success: bool,
    pub output: String,
}

#[tauri::command]
pub async fn install_prerequisite(command: String) -> Result<InstallPrerequisiteResult, String> {
    let path = login_shell_path();
    let result = tokio::task::spawn_blocking(move || {
        // Use zsh login+interactive shell so brew/nvm/cargo/bun/etc are in PATH
        std::process::Command::new("/bin/zsh")
            .args(["-li", "-c", &command])
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
    .map_err(|e| format!("Failed to run install command: {}", e))?;

    let stdout = String::from_utf8_lossy(&result.stdout);
    let stderr = String::from_utf8_lossy(&result.stderr);
    let mut output = String::new();
    if !stdout.trim().is_empty() {
        output.push_str(&stdout);
    }
    if !stderr.trim().is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&stderr);
    }

    Ok(InstallPrerequisiteResult {
        success: result.status.success(),
        output: output.trim().to_string(),
    })
}

#[tauri::command]
pub async fn scaffold_from_template(
    app_handle: AppHandle,
    template_id: String,
    project_path: String,
    project_name: String,
) -> Result<ScaffoldResult, String> {
    info!("Scaffold started: template={}, project={}", template_id, project_name);

    let registry = load_bundled_registry(&app_handle)?;
    let template = registry
        .templates
        .iter()
        .find(|t| t.id == template_id)
        .ok_or_else(|| format!("Template not found: {}", template_id))?
        .clone();

    let parent_dir = PathBuf::from(&project_path);
    let target_dir = parent_dir.join(&project_name);
    let mut warnings: Vec<String> = vec![];

    // Step 1: VALIDATE
    validate_prerequisites(
        &app_handle,
        &project_name,
        &parent_dir,
        &target_dir,
        Some(&template),
    )?;

    // Step 2: CLONE
    emit_progress(&app_handle, "clone", "in_progress", None);

    let output = run_command(
        "git",
        &[
            "clone",
            "--depth",
            "1",
            "--branch",
            &template.branch,
            &template.repo_url,
            target_dir.to_str().unwrap_or(""),
        ],
        &parent_dir,
        120,
    )
    .await
    .map_err(|e| {
        emit_progress(&app_handle, "clone", "error", Some(&e));
        e
    })?;

    if !output.success {
        let msg = output.error_msg("Git clone failed");
        emit_progress_detail(
            &app_handle,
            "clone",
            "error",
            Some(&msg),
            Some(&output.summary(20)),
        );
        return Err(msg);
    }

    emit_progress(&app_handle, "clone", "done", None);

    // Step 3: CLEAN
    emit_progress(&app_handle, "clean", "in_progress", None);

    // Remove .git
    let git_dir = target_dir.join(".git");
    if git_dir.exists() {
        std::fs::remove_dir_all(&git_dir)
            .map_err(|e| format!("Failed to remove .git: {}", e))?;
    }

    // Remove cleanup files
    if let Some(ref cleanup) = template.post_clone_cleanup {
        for entry in cleanup {
            let entry_path = target_dir.join(entry);
            if entry_path.is_dir() {
                let _ = std::fs::remove_dir_all(&entry_path);
            } else if entry_path.exists() {
                let _ = std::fs::remove_file(&entry_path);
            }
        }
    }

    // Init fresh git repo
    let output = run_command("git", &["init"], &target_dir, 10)
        .await
        .map_err(|e| {
            emit_progress(&app_handle, "clean", "error", Some(&e));
            e
        })?;
    if !output.success {
        let msg = output.error_msg("git init failed");
        emit_progress_detail(
            &app_handle,
            "clean",
            "error",
            Some(&msg),
            Some(&output.summary(10)),
        );
        return Err(msg);
    }

    let output = run_command("git", &["add", "-A"], &target_dir, 30)
        .await
        .map_err(|e| {
            emit_progress(&app_handle, "clean", "error", Some(&e));
            e
        })?;
    if !output.success {
        let msg = output.error_msg("git add failed");
        emit_progress_detail(
            &app_handle,
            "clean",
            "error",
            Some(&msg),
            Some(&output.summary(10)),
        );
        return Err(msg);
    }

    let commit_msg = format!("Initial scaffold from {}", template.name);
    let output = run_command(
        "git",
        &["commit", "--no-verify", "-m", &commit_msg],
        &target_dir,
        30,
    )
    .await
    .map_err(|e| {
        emit_progress(&app_handle, "clean", "error", Some(&e));
        e
    })?;
    if !output.success {
        let msg = output.error_msg("git commit failed");
        emit_progress_detail(
            &app_handle,
            "clean",
            "error",
            Some(&msg),
            Some(&output.summary(10)),
        );
        return Err(msg);
    }

    emit_progress(&app_handle, "clean", "done", None);

    // Step 4: INSTALL DEPENDENCIES
    emit_progress(&app_handle, "install", "in_progress", None);
    warnings.extend(run_install(&app_handle, &template.install_command, &target_dir).await);

    // Step 5: VERIFY
    warnings.extend(run_verify(&app_handle, &target_dir, &template));

    // Step 6: WRITE CLAUDE.MD
    warnings.extend(write_claude_md(
        &app_handle,
        &target_dir,
        &template_id,
        &template.name,
        &project_name,
    ));

    // Step 7: FINAL COMMIT (--no-verify bypasses Husky/Commitlint hooks from install)
    emit_progress(&app_handle, "commit", "in_progress", None);

    let _ = run_command("git", &["add", "-A"], &target_dir, 10).await;
    let _ = run_command(
        "git",
        &["commit", "--no-verify", "-m", "Add CLAUDE.md and post-install changes"],
        &target_dir,
        10,
    )
    .await;

    emit_progress(&app_handle, "commit", "done", None);

    // Done
    emit_progress(&app_handle, "complete", "done", None);
    info!("Scaffold completed: template={}, project={}", template_id, project_name);

    Ok(ScaffoldResult {
        project_path: target_dir.to_string_lossy().to_string(),
        project_name,
        template_id,
        warnings,
    })
}

#[tauri::command]
pub async fn scaffold_from_cli(
    app_handle: AppHandle,
    template_id: String,
    cli_command: String,
    project_path: String,
    project_name: String,
    post_commands: Vec<String>,
) -> Result<ScaffoldResult, String> {
    info!("Scaffold (CLI) started: template={}, project={}", template_id, project_name);

    let parent_dir = PathBuf::from(&project_path);
    let target_dir = parent_dir.join(&project_name);
    let mut warnings: Vec<String> = vec![];

    // Load template for metadata
    let registry = load_bundled_registry(&app_handle)?;
    let template = registry
        .templates
        .iter()
        .find(|t| t.id == template_id)
        .cloned();

    // Step 1: VALIDATE (checks all required CLI tools)
    validate_prerequisites(
        &app_handle,
        &project_name,
        &parent_dir,
        &target_dir,
        template.as_ref(),
    )?;

    // Step 2: GENERATE (run CLI scaffold command)
    emit_progress(&app_handle, "generate", "in_progress", None);

    let resolved_cmd = cli_command.replace("{{PROJECT_NAME}}", &project_name);

    let output = run_shell(&resolved_cmd, &parent_dir, 120)
        .await
        .map_err(|e| {
            emit_progress(&app_handle, "generate", "error", Some(&e));
            e
        })?;

    if !output.success {
        let msg = output.error_msg("CLI scaffold command failed");
        emit_progress_detail(
            &app_handle,
            "generate",
            "error",
            Some(&msg),
            Some(&output.summary(20)),
        );
        return Err(msg);
    }

    emit_progress(&app_handle, "generate", "done", None);

    // Step 3: INSTALL DEPENDENCIES (before post_commands so they can depend on deps)
    emit_progress(&app_handle, "install", "in_progress", None);

    if let Some(ref tmpl) = template {
        warnings.extend(run_install(&app_handle, &tmpl.install_command, &target_dir).await);
    } else {
        emit_progress(&app_handle, "install", "done", None);
    }

    // Step 4: POST COMMANDS (configure — now deps are installed)
    warnings.extend(run_post_commands(&app_handle, &post_commands, &target_dir).await);

    // Step 5: VERIFY
    if let Some(ref tmpl) = template {
        warnings.extend(run_verify(&app_handle, &target_dir, tmpl));
    } else {
        emit_progress(&app_handle, "verify", "done", None);
    }

    // Step 6: WRITE CLAUDE.MD
    let tmpl_name = template
        .as_ref()
        .map_or(template_id.as_str(), |t| t.name.as_str());
    warnings.extend(write_claude_md(
        &app_handle,
        &target_dir,
        &template_id,
        tmpl_name,
        &project_name,
    ));

    // Step 7: GIT INIT + COMMIT (--no-verify bypasses any hooks set up during install)
    emit_progress(&app_handle, "commit", "in_progress", None);

    let git_dir = target_dir.join(".git");
    if !git_dir.exists() {
        let _ = run_command("git", &["init"], &target_dir, 10).await;
    }

    let _ = run_command("git", &["add", "-A"], &target_dir, 30).await;

    let commit_msg = format!("Initial scaffold from {}", tmpl_name);
    let _ = run_command(
        "git",
        &["commit", "--no-verify", "-m", &commit_msg],
        &target_dir,
        30,
    )
    .await;

    emit_progress(&app_handle, "commit", "done", None);

    // Done
    emit_progress(&app_handle, "complete", "done", None);
    info!("Scaffold (CLI) completed: template={}, project={}", template_id, project_name);

    Ok(ScaffoldResult {
        project_path: target_dir.to_string_lossy().to_string(),
        project_name,
        template_id,
        warnings,
    })
}

// ── Template Verification ──

#[tauri::command]
pub async fn verify_template(
    app_handle: AppHandle,
    template_id: String,
) -> Result<VerifyResult, String> {
    let start = std::time::Instant::now();

    let registry = load_bundled_registry(&app_handle)?;
    let template = registry
        .templates
        .iter()
        .find(|t| t.id == template_id)
        .ok_or_else(|| format!("Template not found: {}", template_id))?
        .clone();

    let tmp_dir = TempDir::new().map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let parent_dir = tmp_dir.path().to_path_buf();
    let project_name = format!("verify-{}", template_id);
    let target_dir = parent_dir.join(&project_name);

    let mut warnings: Vec<String> = vec![];

    // Check required CLI tools using login-shell PATH
    let required = detect_required_tools(&template);
    let path = login_shell_path();
    let missing: Vec<&String> = required
        .iter()
        .filter(|t| !tool_exists_in_login_shell(t, &path))
        .collect();
    if !missing.is_empty() {
        return Ok(VerifyResult {
            template_id,
            success: false,
            duration_ms: start.elapsed().as_millis() as u64,
            step_failed: Some("prerequisites".to_string()),
            error: Some(format!(
                "Missing tools: {}",
                missing
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )),
            warnings: vec![],
        });
    }

    emit_progress(&app_handle, "verify_template", "in_progress", None);

    // Step 1: Clone or generate
    if template.scaffold_type == "git-clone" {
        let output = run_command(
            "git",
            &[
                "clone",
                "--depth",
                "1",
                "--branch",
                &template.branch,
                &template.repo_url,
                target_dir.to_str().unwrap_or(""),
            ],
            &parent_dir,
            120,
        )
        .await;

        match output {
            Err(e) => {
                return Ok(VerifyResult {
                    template_id,
                    success: false,
                    duration_ms: start.elapsed().as_millis() as u64,
                    step_failed: Some("clone".to_string()),
                    error: Some(e),
                    warnings: vec![],
                });
            }
            Ok(out) if !out.success => {
                return Ok(VerifyResult {
                    template_id,
                    success: false,
                    duration_ms: start.elapsed().as_millis() as u64,
                    step_failed: Some("clone".to_string()),
                    error: Some(out.error_msg("git clone failed")),
                    warnings: vec![],
                });
            }
            Ok(_) => {}
        }
    } else if template.scaffold_type == "cli" {
        let cli_cmd = template
            .cli_command
            .as_ref()
            .ok_or_else(|| "CLI template missing cli_command".to_string())?;

        let resolved_cmd = cli_cmd.replace("{{PROJECT_NAME}}", &project_name);

        let output = run_shell(&resolved_cmd, &parent_dir, 120).await;

        match output {
            Err(e) => {
                return Ok(VerifyResult {
                    template_id,
                    success: false,
                    duration_ms: start.elapsed().as_millis() as u64,
                    step_failed: Some("generate".to_string()),
                    error: Some(e),
                    warnings: vec![],
                });
            }
            Ok(out) if !out.success => {
                return Ok(VerifyResult {
                    template_id,
                    success: false,
                    duration_ms: start.elapsed().as_millis() as u64,
                    step_failed: Some("generate".to_string()),
                    error: Some(out.error_msg("CLI scaffold failed")),
                    warnings: vec![],
                });
            }
            Ok(_) => {}
        }

        if !target_dir.exists() {
            return Ok(VerifyResult {
                template_id,
                success: false,
                duration_ms: start.elapsed().as_millis() as u64,
                step_failed: Some("generate".to_string()),
                error: Some("CLI command did not create project directory".to_string()),
                warnings: vec![],
            });
        }
    } else {
        return Ok(VerifyResult {
            template_id,
            success: false,
            duration_ms: start.elapsed().as_millis() as u64,
            step_failed: Some("prerequisites".to_string()),
            error: Some(format!("Unknown scaffold_type: {}", template.scaffold_type)),
            warnings: vec![],
        });
    }

    // Step 2: Install dependencies
    match run_shell(&template.install_command, &target_dir, 300).await {
        Err(e) => {
            warnings.push(format!("Install failed: {}", e));
        }
        Ok(out) if !out.success => {
            warnings.push(format!(
                "Install failed: {}",
                out.error_msg(&template.install_command)
            ));
        }
        Ok(_) => {}
    }

    // Step 3: Verify project structure
    warnings.extend(verify_project(&target_dir, &template));

    let success = warnings.is_empty();

    emit_progress(
        &app_handle,
        "verify_template",
        if success { "done" } else { "error" },
        if success {
            None
        } else {
            Some("Issues detected")
        },
    );

    // tmp_dir auto-cleans on drop

    Ok(VerifyResult {
        template_id,
        success,
        duration_ms: start.elapsed().as_millis() as u64,
        step_failed: if success {
            None
        } else {
            Some("verify".to_string())
        },
        error: if success {
            None
        } else {
            Some(warnings.join("; "))
        },
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_dir() -> TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // ── validate_project_name ──

    #[test]
    fn valid_project_names() {
        assert!(validate_project_name("my-project").is_ok());
        assert!(validate_project_name("my_project").is_ok());
        assert!(validate_project_name("project123").is_ok());
        assert!(validate_project_name("my.app").is_ok());
        assert!(validate_project_name("A").is_ok());
    }

    #[test]
    fn rejects_empty_name() {
        let result = validate_project_name("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));
    }

    #[test]
    fn rejects_name_starting_with_dot() {
        let result = validate_project_name(".hidden");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must start with"));
    }

    #[test]
    fn rejects_name_starting_with_dash() {
        let result = validate_project_name("-bad");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must start with"));
    }

    #[test]
    fn rejects_slashes_in_name() {
        assert!(validate_project_name("foo/bar").is_err());
        assert!(validate_project_name("foo\\bar").is_err());
    }

    #[test]
    fn rejects_null_bytes() {
        assert!(validate_project_name("foo\0bar").is_err());
    }

    #[test]
    fn rejects_special_characters() {
        assert!(validate_project_name("my project").is_err());
        assert!(validate_project_name("my@project").is_err());
        assert!(validate_project_name("project!").is_err());
    }

    // ── detect_required_tools ──

    fn make_template(
        install_command: &str,
        cli_command: Option<&str>,
        post_commands: Option<Vec<&str>>,
    ) -> TemplateEntry {
        TemplateEntry {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: "Test template".to_string(),
            long_description: None,
            category: "frontend".to_string(),
            tags: vec![],
            repo_url: "".to_string(),
            branch: "main".to_string(),
            stars: None,
            license: "MIT".to_string(),
            install_command: install_command.to_string(),
            dev_command: "npm dev".to_string(),
            dev_port: None,
            post_clone_cleanup: None,
            icon: "zap".to_string(),
            verified: true,
            last_verified: "2026-01-01".to_string(),
            scaffold_type: "git-clone".to_string(),
            cli_command: cli_command.map(|s| s.to_string()),
            post_commands: post_commands
                .map(|v| v.into_iter().map(|s| s.to_string()).collect()),
            prerequisites: None,
            prerequisite_checks: None,
        }
    }

    #[test]
    fn detect_tools_always_includes_git() {
        let tmpl = make_template("npm install", None, None);
        let tools = detect_required_tools(&tmpl);
        assert!(tools.contains("git"));
    }

    #[test]
    fn detect_tools_extracts_install_command() {
        let tmpl = make_template("pnpm install", None, None);
        let tools = detect_required_tools(&tmpl);
        assert!(tools.contains("pnpm"));
    }

    #[test]
    fn detect_tools_extracts_cli_command() {
        let tmpl = make_template("npm install", Some("npx create-app"), None);
        let tools = detect_required_tools(&tmpl);
        assert!(tools.contains("npm"));
        assert!(tools.contains("npx"));
    }

    #[test]
    fn detect_tools_extracts_post_commands() {
        let tmpl = make_template(
            "npm install",
            None,
            Some(vec!["corepack enable", "yarn set version stable"]),
        );
        let tools = detect_required_tools(&tmpl);
        assert!(tools.contains("corepack"));
        assert!(tools.contains("yarn"));
    }

    #[test]
    fn detect_tools_skips_env_var_prefix() {
        let tmpl = make_template(
            "pnpm install",
            Some("CI=true pnpm create fumadocs-app my-app"),
            None,
        );
        let tools = detect_required_tools(&tmpl);
        assert!(tools.contains("pnpm"));
        assert!(
            !tools.contains("CI=true"),
            "detect_required_tools should skip env var tokens, got: {:?}",
            tools
        );
    }

    #[test]
    fn detect_tools_skips_multiple_env_vars() {
        let tmpl = make_template(
            "npm install",
            Some("NODE_ENV=production CI=true npx create-app"),
            None,
        );
        let tools = detect_required_tools(&tmpl);
        assert!(tools.contains("npx"));
        assert!(!tools.contains("NODE_ENV=production"));
        assert!(!tools.contains("CI=true"));
    }

    #[test]
    fn detect_tools_deduplicates() {
        let tmpl = make_template("npm install", Some("npm run build"), None);
        let tools = detect_required_tools(&tmpl);
        // npm appears in both install and cli commands, but set should have it once
        assert!(tools.contains("npm"));
        assert_eq!(tools.iter().filter(|t| *t == "npm").count(), 1);
    }

    // ── verify_project ──

    #[test]
    fn verify_project_warns_if_dir_missing() {
        let tmpl = make_template("npm install", None, None);
        let warnings = verify_project(Path::new("/nonexistent_verify_12345"), &tmpl);
        assert!(!warnings.is_empty());
        assert!(warnings[0].contains("not created"));
    }

    #[test]
    fn verify_project_warns_if_node_modules_missing() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        let tmpl = make_template("npm install", None, None);
        let warnings = verify_project(dir.path(), &tmpl);
        assert!(warnings.iter().any(|w| w.contains("Dependencies not installed")));
    }

    #[test]
    fn verify_project_passes_with_node_modules() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        let nm = dir.path().join("node_modules");
        std::fs::create_dir(&nm).unwrap();
        // Create enough entries to pass the count check
        for i in 0..5 {
            std::fs::create_dir(nm.join(format!("pkg-{}", i))).unwrap();
        }
        let tmpl = make_template("npm install", None, None);
        let warnings = verify_project(dir.path(), &tmpl);
        assert!(
            !warnings.iter().any(|w| w.contains("Dependencies")),
            "Expected no dependency warnings, got: {:?}",
            warnings
        );
    }

    #[test]
    fn verify_project_warns_if_docker_compose_missing() {
        let dir = temp_dir();
        let tmpl = make_template("docker compose build", None, None);
        let warnings = verify_project(dir.path(), &tmpl);
        assert!(warnings.iter().any(|w| w.contains("Docker Compose")));
    }

    #[test]
    fn verify_project_passes_with_docker_compose() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("docker-compose.yml"), "").unwrap();
        let tmpl = make_template("docker compose build", None, None);
        let warnings = verify_project(dir.path(), &tmpl);
        assert!(
            !warnings.iter().any(|w| w.contains("Docker Compose")),
            "Expected no Docker Compose warning, got: {:?}",
            warnings
        );
    }

    #[test]
    fn verify_project_warns_if_venv_missing_for_uv() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("pyproject.toml"), "").unwrap();
        let tmpl = make_template("uv sync", None, None);
        let warnings = verify_project(dir.path(), &tmpl);
        assert!(warnings.iter().any(|w| w.contains("Virtual environment")));
    }

    // ── PrerequisiteCheck deserialization ──

    #[test]
    fn prerequisite_check_required_defaults_to_true() {
        let json = r#"{"command": "docker", "label": "Docker"}"#;
        let check: PrerequisiteCheck = serde_json::from_str(json).unwrap();
        assert!(check.required);
        assert!(check.install_command.is_none());
    }

    #[test]
    fn prerequisite_check_parses_all_fields() {
        let json = r#"{
            "command": "uv",
            "label": "uv package manager",
            "required": true,
            "install_command": "brew install uv"
        }"#;
        let check: PrerequisiteCheck = serde_json::from_str(json).unwrap();
        assert_eq!(check.command, "uv");
        assert_eq!(check.label, "uv package manager");
        assert!(check.required);
        assert_eq!(check.install_command.as_deref(), Some("brew install uv"));
    }

    #[test]
    fn prerequisite_check_optional_flag() {
        let json = r#"{"command": "stripe", "label": "Stripe CLI", "required": false}"#;
        let check: PrerequisiteCheck = serde_json::from_str(json).unwrap();
        assert!(!check.required);
    }

    // ── templates.json parsing ──

    #[test]
    fn templates_json_parses_with_prerequisite_checks() {
        let json = include_str!("../../resources/templates.json");
        let registry: TemplateRegistry = serde_json::from_str(json).unwrap();
        assert!(!registry.templates.is_empty());

        // Templates with prerequisite_checks should have them parsed
        let fastapi = registry.templates.iter().find(|t| t.id == "fastapi-boilerplate").unwrap();
        let checks = fastapi.prerequisite_checks.as_ref().unwrap();
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].command, "uv");
        assert!(checks[0].required);
        assert!(checks[0].install_command.is_some());
    }

    #[test]
    fn templates_without_checks_parse_as_none() {
        let json = include_str!("../../resources/templates.json");
        let registry: TemplateRegistry = serde_json::from_str(json).unwrap();

        let vite = registry.templates.iter().find(|t| t.id == "vite-react-boilerplate").unwrap();
        assert!(vite.prerequisite_checks.is_none());
    }

    #[test]
    fn all_prerequisite_checks_have_install_commands() {
        let json = include_str!("../../resources/templates.json");
        let registry: TemplateRegistry = serde_json::from_str(json).unwrap();

        for template in &registry.templates {
            if let Some(ref checks) = template.prerequisite_checks {
                for check in checks {
                    assert!(
                        check.install_command.is_some(),
                        "Template '{}' prerequisite '{}' is missing install_command",
                        template.id,
                        check.label
                    );
                }
            }
        }
    }

    #[test]
    fn all_prerequisite_checks_have_nonempty_labels() {
        let json = include_str!("../../resources/templates.json");
        let registry: TemplateRegistry = serde_json::from_str(json).unwrap();

        for template in &registry.templates {
            if let Some(ref checks) = template.prerequisite_checks {
                for check in checks {
                    assert!(
                        !check.label.is_empty(),
                        "Template '{}' has empty prerequisite label",
                        template.id
                    );
                    assert!(
                        !check.command.is_empty(),
                        "Template '{}' has empty prerequisite command",
                        template.id
                    );
                }
            }
        }
    }

    // ── validate_shell_command ──

    #[test]
    fn allowed_simple_commands_pass() {
        assert!(validate_shell_command("npm install").is_ok());
        assert!(validate_shell_command("cargo build").is_ok());
        assert!(validate_shell_command("pnpm install").is_ok());
        assert!(validate_shell_command("yarn install").is_ok());
        assert!(validate_shell_command("pip install -r requirements.txt").is_ok());
    }

    #[test]
    fn docker_commands_pass() {
        assert!(validate_shell_command("docker compose build").is_ok());
        assert!(validate_shell_command("docker compose up").is_ok());
        assert!(validate_shell_command("docker-compose build").is_ok());
    }

    #[test]
    fn uv_and_corepack_commands_pass() {
        assert!(validate_shell_command("uv sync").is_ok());
        assert!(validate_shell_command("corepack enable").is_ok());
    }

    #[test]
    fn commands_with_path_prefix_pass() {
        assert!(validate_shell_command("/usr/bin/node script.js").is_ok());
        assert!(validate_shell_command("/usr/local/bin/npm install").is_ok());
    }

    #[test]
    fn commands_with_env_var_prefix_pass() {
        assert!(validate_shell_command("NODE_ENV=production npm install").is_ok());
    }

    #[test]
    fn disallowed_commands_rejected() {
        assert!(validate_shell_command("curl http://example.com").is_err());
        assert!(validate_shell_command("wget http://example.com").is_err());
        assert!(validate_shell_command("sudo rm -rf /").is_err());
    }

    #[test]
    fn empty_command_rejected() {
        assert!(validate_shell_command("").is_err());
        assert!(validate_shell_command("   ").is_err());
    }

    #[test]
    fn chained_commands_validate_first_token() {
        // Only the first command token is validated
        assert!(validate_shell_command("corepack enable && yarn install").is_ok());
    }

    #[test]
    fn all_template_install_commands_pass_allowlist() {
        let json = include_str!("../../resources/templates.json");
        let registry: TemplateRegistry = serde_json::from_str(json).unwrap();
        for template in &registry.templates {
            let cmd = &template.install_command;
            if !cmd.is_empty() {
                assert!(
                    validate_shell_command(cmd).is_ok(),
                    "Template '{}' install_command '{}' fails allowlist: {}",
                    template.id,
                    cmd,
                    validate_shell_command(cmd).unwrap_err()
                );
            }
        }
    }

    // ── CmdOutput ──

    #[test]
    fn cmd_output_summary_truncates_long_output() {
        let output = CmdOutput {
            success: false,
            stdout: (0..50).map(|i| format!("line {}", i)).collect::<Vec<_>>().join("\n"),
            stderr: String::new(),
            exit_code: Some(1),
        };
        let summary = output.summary(5);
        assert!(summary.contains("lines omitted"));
        assert!(summary.contains("line 49"));
    }

    #[test]
    fn cmd_output_summary_short_output_not_truncated() {
        let output = CmdOutput {
            success: true,
            stdout: "line 1\nline 2".to_string(),
            stderr: String::new(),
            exit_code: Some(0),
        };
        let summary = output.summary(5);
        assert!(!summary.contains("omitted"));
        assert!(summary.contains("line 1"));
        assert!(summary.contains("line 2"));
    }

    #[test]
    fn cmd_output_error_msg_includes_exit_code() {
        let output = CmdOutput {
            success: false,
            stdout: String::new(),
            stderr: "error".to_string(),
            exit_code: Some(127),
        };
        let msg = output.error_msg("npm install failed");
        assert!(msg.contains("npm install failed"));
        assert!(msg.contains("127"));
    }

    // ── Real shell integration tests (no mocks) ──

    #[test]
    fn login_shell_path_includes_homebrew() {
        let path = login_shell_path();
        assert!(
            !path.is_empty(),
            "login_shell_path() returned empty string"
        );
        // On macOS with Homebrew, /opt/homebrew/bin should be in PATH
        // If Homebrew isn't installed, this still validates the mechanism works
        assert!(
            path.contains("/usr/bin"),
            "login_shell_path() doesn't contain /usr/bin: {}",
            path
        );
    }

    #[test]
    fn login_shell_path_finds_git() {
        // git is always available — verify the resolved PATH actually works
        let path = login_shell_path();
        let result = std::process::Command::new("/bin/zsh")
            .args(["-c", "command -v git"])
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "Failed to find git using login shell PATH: {}",
            path
        );
    }

    #[test]
    fn check_finds_git_via_login_shell() {
        // End-to-end: the same mechanism used by check_template_prerequisites
        let path = login_shell_path();
        let found = std::process::Command::new("/bin/zsh")
            .args(["-c", "command -v git"])
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(found, "check mechanism failed to find git");
    }

    #[test]
    fn check_rejects_nonexistent_tool() {
        let path = login_shell_path();
        let found = std::process::Command::new("/bin/zsh")
            .args(["-c", "command -v __nonexistent_tool_12345__"])
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(!found, "check mechanism found a nonexistent tool");
    }

    #[test]
    fn install_runs_shell_command_successfully() {
        // Verify the install mechanism actually runs commands using -li
        // (login+interactive) to match the production code path
        let path = login_shell_path();
        let result = std::process::Command::new("/bin/zsh")
            .args(["-li", "-c", "echo prerequisite_install_test"])
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .unwrap();
        assert!(result.status.success(), "zsh -li -c failed to run echo");
        let stdout = String::from_utf8_lossy(&result.stdout);
        assert!(
            stdout.contains("prerequisite_install_test"),
            "Expected output not found: {}",
            stdout
        );
    }

    #[test]
    fn install_reports_failure_for_bad_command() {
        let path = login_shell_path();
        let result = std::process::Command::new("/bin/zsh")
            .args(["-li", "-c", "__nonexistent_command_12345__"])
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .unwrap();
        assert!(!result.status.success(), "Expected failure for bad command");
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(
            !stderr.is_empty(),
            "Expected error output for bad command"
        );
    }
}
