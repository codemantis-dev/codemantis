use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;

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
}

#[derive(Debug, Clone, Serialize)]
pub struct ScaffoldResult {
    pub project_path: String,
    pub project_name: String,
    pub template_id: String,
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
struct CmdOutput {
    success: bool,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

impl CmdOutput {
    /// Combined stderr + stdout, truncated to last N lines
    fn summary(&self, max_lines: usize) -> String {
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

    fn error_msg(&self, context: &str) -> String {
        format!(
            "{} (exit code {})",
            context,
            self.exit_code.unwrap_or(-1)
        )
    }
}

// ── Helpers ──

fn emit_progress(app: &AppHandle, step: &str, status: &str, error: Option<&str>) {
    emit_progress_detail(app, step, status, error, None);
}

fn emit_progress_detail(
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

async fn run_command(
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

async fn run_shell(command_str: &str, cwd: &Path, timeout_secs: u64) -> Result<CmdOutput, String> {
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

fn validate_project_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    if name.starts_with('.') || name.starts_with('-') {
        return Err("Project name cannot start with '.' or '-'".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("Project name contains invalid characters".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(
            "Project name can only contain letters, numbers, hyphens, underscores, and dots"
                .to_string(),
        );
    }
    Ok(())
}

/// Extract CLI tool names required by a template's commands
fn detect_required_tools(template: &TemplateEntry) -> HashSet<String> {
    let mut tools = HashSet::new();

    fn first_word(cmd: &str) -> Option<String> {
        cmd.split_whitespace().next().map(|s| s.to_string())
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
fn validate_prerequisites(
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

    // Check all required CLI tools
    if let Some(tmpl) = template {
        let required = detect_required_tools(tmpl);
        let missing: Vec<&String> = required
            .iter()
            .filter(|t| which::which(t).is_err())
            .collect();
        if !missing.is_empty() {
            let msg = format!(
                "Required tools not found: {}. Please install them first.",
                missing
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            emit_progress(app, "validate", "error", Some(&msg));
            return Err(msg);
        }
    } else {
        // At minimum check git
        if which::which("git").is_err() {
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
pub async fn scaffold_from_template(
    app_handle: AppHandle,
    template_id: String,
    project_path: String,
    project_name: String,
) -> Result<ScaffoldResult, String> {
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

    Ok(ScaffoldResult {
        project_path: target_dir.to_string_lossy().to_string(),
        project_name,
        template_id,
        warnings,
    })
}
