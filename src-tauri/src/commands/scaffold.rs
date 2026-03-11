use serde::{Deserialize, Serialize};
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
}

#[derive(Debug, Clone, Serialize)]
struct ScaffoldProgress {
    step: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ── Helpers ──

fn emit_progress(app: &AppHandle, step: &str, status: &str, error: Option<&str>) {
    let payload = ScaffoldProgress {
        step: step.to_string(),
        status: status.to_string(),
        error: error.map(|s| s.to_string()),
    };
    let _ = app.emit("scaffold-progress", &payload);
}

fn load_bundled_registry(app: &AppHandle) -> Result<TemplateRegistry, String> {
    let resource_path = app
        .path()
        .resolve("resources/templates.json", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve templates.json: {}", e))?;

    let content =
        std::fs::read_to_string(&resource_path).map_err(|e| format!("Failed to read templates.json: {}", e))?;

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

async fn run_command(cmd: &str, args: &[&str], cwd: &Path, timeout_secs: u64) -> Result<String, String> {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        Command::new(cmd)
            .args(args)
            .current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| format!("Command timed out after {}s: {} {}", timeout_secs, cmd, args.join(" ")))?
    .map_err(|e| format!("Failed to run {} {}: {}", cmd, args.join(" "), e))?;

    if result.status.success() {
        Ok(String::from_utf8_lossy(&result.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let stdout = String::from_utf8_lossy(&result.stdout);
        Err(format!(
            "Command failed (exit {}): {} {}\nstderr: {}\nstdout: {}",
            result.status.code().unwrap_or(-1),
            cmd,
            args.join(" "),
            stderr,
            stdout
        ))
    }
}

/// Run a shell command string (supports piped / complex commands)
async fn run_shell(command_str: &str, cwd: &Path, timeout_secs: u64) -> Result<String, String> {
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
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| format!("Command timed out after {}s: {}", timeout_secs, command_str))?
    .map_err(|e| format!("Failed to run shell command '{}': {}", command_str, e))?;

    if result.status.success() {
        Ok(String::from_utf8_lossy(&result.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let stdout = String::from_utf8_lossy(&result.stdout);
        Err(format!(
            "Shell command failed (exit {}): {}\nstderr: {}\nstdout: {}",
            result.status.code().unwrap_or(-1),
            command_str,
            stderr,
            stdout
        ))
    }
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
    // Allow alphanumeric, hyphens, underscores, dots
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err("Project name can only contain letters, numbers, hyphens, underscores, and dots".to_string());
    }
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

    // Step 1: VALIDATE
    emit_progress(&app_handle, "validate", "in_progress", None);

    validate_project_name(&project_name)?;

    if !parent_dir.exists() || !parent_dir.is_dir() {
        emit_progress(
            &app_handle,
            "validate",
            "error",
            Some("Parent directory does not exist"),
        );
        return Err(format!("Parent directory does not exist: {}", project_path));
    }

    if target_dir.exists() {
        emit_progress(
            &app_handle,
            "validate",
            "error",
            Some("A folder with this name already exists"),
        );
        return Err(format!(
            "A folder named '{}' already exists at {}",
            project_name, project_path
        ));
    }

    // Check git is installed
    which::which("git").map_err(|_| {
        emit_progress(
            &app_handle,
            "validate",
            "error",
            Some("Git is not installed"),
        );
        "Git is not installed. Please install Git first.".to_string()
    })?;

    emit_progress(&app_handle, "validate", "done", None);

    // Step 2: CLONE
    emit_progress(&app_handle, "clone", "in_progress", None);

    if let Err(e) = run_command(
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
    {
        emit_progress(&app_handle, "clone", "error", Some(&e));
        return Err(e);
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
    run_command("git", &["init"], &target_dir, 10).await.map_err(|e| {
        emit_progress(&app_handle, "clean", "error", Some(&e));
        e
    })?;

    run_command("git", &["add", "-A"], &target_dir, 30).await.map_err(|e| {
        emit_progress(&app_handle, "clean", "error", Some(&e));
        e
    })?;

    let commit_msg = format!("Initial scaffold from {}", template.name);
    run_command("git", &["commit", "-m", &commit_msg], &target_dir, 30)
        .await
        .map_err(|e| {
            emit_progress(&app_handle, "clean", "error", Some(&e));
            e
        })?;

    emit_progress(&app_handle, "clean", "done", None);

    // Step 4: INSTALL DEPENDENCIES
    emit_progress(&app_handle, "install", "in_progress", None);

    if let Err(e) = run_shell(&template.install_command, &target_dir, 180).await {
        // Install failure is non-fatal — emit error but continue
        emit_progress(&app_handle, "install", "error", Some(&e));
        log::warn!("Install failed (non-fatal): {}", e);
    } else {
        emit_progress(&app_handle, "install", "done", None);
    }

    // Step 5: WRITE CLAUDE.MD
    emit_progress(&app_handle, "claude_md", "in_progress", None);

    match load_claude_md_template(&app_handle, &template_id) {
        Ok(md_template) => {
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            let content = md_template
                .replace("{{PROJECT_NAME}}", &project_name)
                .replace("{{TEMPLATE_NAME}}", &template.name)
                .replace("{{DATE}}", &today);

            let claude_md_path = target_dir.join("CLAUDE.md");
            std::fs::write(&claude_md_path, content)
                .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;

            emit_progress(&app_handle, "claude_md", "done", None);
        }
        Err(e) => {
            log::warn!("Failed to write CLAUDE.md (non-fatal): {}", e);
            emit_progress(&app_handle, "claude_md", "error", Some(&e));
        }
    }

    // Step 6: FINAL COMMIT
    emit_progress(&app_handle, "commit", "in_progress", None);

    let _ = run_command("git", &["add", "CLAUDE.md"], &target_dir, 10).await;
    let _ = run_command(
        "git",
        &["commit", "-m", "Add CLAUDE.md for AI-assisted development"],
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

    // Step 1: VALIDATE
    emit_progress(&app_handle, "validate", "in_progress", None);

    validate_project_name(&project_name)?;

    if !parent_dir.exists() || !parent_dir.is_dir() {
        emit_progress(
            &app_handle,
            "validate",
            "error",
            Some("Parent directory does not exist"),
        );
        return Err(format!("Parent directory does not exist: {}", project_path));
    }

    if target_dir.exists() {
        emit_progress(
            &app_handle,
            "validate",
            "error",
            Some("A folder with this name already exists"),
        );
        return Err(format!(
            "A folder named '{}' already exists at {}",
            project_name, project_path
        ));
    }

    emit_progress(&app_handle, "validate", "done", None);

    // Step 2: RUN CLI
    emit_progress(&app_handle, "generate", "in_progress", None);

    // Replace placeholder in CLI command
    let resolved_cmd = cli_command.replace("{{PROJECT_NAME}}", &project_name);

    if let Err(e) = run_shell(&resolved_cmd, &parent_dir, 120).await {
        emit_progress(&app_handle, "generate", "error", Some(&e));
        return Err(e);
    }

    emit_progress(&app_handle, "generate", "done", None);

    // Step 3: POST COMMANDS
    if !post_commands.is_empty() {
        emit_progress(&app_handle, "configure", "in_progress", None);

        for cmd in &post_commands {
            if let Err(e) = run_shell(cmd, &target_dir, 120).await {
                emit_progress(&app_handle, "configure", "error", Some(&e));
                log::warn!("Post command failed (non-fatal): {}", e);
            }
        }

        emit_progress(&app_handle, "configure", "done", None);
    }

    // Step 4: INSTALL
    emit_progress(&app_handle, "install", "in_progress", None);

    // Load template registry to get install_command
    let registry = load_bundled_registry(&app_handle)?;
    let template = registry.templates.iter().find(|t| t.id == template_id);

    if let Some(tmpl) = template {
        if let Err(e) = run_shell(&tmpl.install_command, &target_dir, 180).await {
            emit_progress(&app_handle, "install", "error", Some(&e));
            log::warn!("Install failed (non-fatal): {}", e);
        } else {
            emit_progress(&app_handle, "install", "done", None);
        }
    } else {
        emit_progress(&app_handle, "install", "done", None);
    }

    // Step 5: WRITE CLAUDE.MD
    emit_progress(&app_handle, "claude_md", "in_progress", None);

    match load_claude_md_template(&app_handle, &template_id) {
        Ok(md_template) => {
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            let content = md_template
                .replace("{{PROJECT_NAME}}", &project_name)
                .replace("{{TEMPLATE_NAME}}", template.map_or(&template_id, |t| &t.name))
                .replace("{{DATE}}", &today);

            let claude_md_path = target_dir.join("CLAUDE.md");
            std::fs::write(&claude_md_path, content)
                .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;

            emit_progress(&app_handle, "claude_md", "done", None);
        }
        Err(e) => {
            log::warn!("Failed to write CLAUDE.md (non-fatal): {}", e);
            emit_progress(&app_handle, "claude_md", "error", Some(&e));
        }
    }

    // Step 6: GIT INIT + COMMIT
    emit_progress(&app_handle, "commit", "in_progress", None);

    // Only init git if the CLI tool didn't already
    let git_dir = target_dir.join(".git");
    if !git_dir.exists() {
        let _ = run_command("git", &["init"], &target_dir, 10).await;
    }

    let _ = run_command("git", &["add", "-A"], &target_dir, 30).await;

    let template_name = template.map_or("template", |t| &t.name);
    let commit_msg = format!("Initial scaffold from {}", template_name);
    let _ = run_command("git", &["commit", "-m", &commit_msg], &target_dir, 30).await;

    emit_progress(&app_handle, "commit", "done", None);

    // Done
    emit_progress(&app_handle, "complete", "done", None);

    Ok(ScaffoldResult {
        project_path: target_dir.to_string_lossy().to_string(),
        project_name,
        template_id,
    })
}
