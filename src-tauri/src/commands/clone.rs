use log::info;
use std::path::PathBuf;
use tauri::AppHandle;

use super::claude_md;
use super::scaffold::{
    emit_progress, emit_progress_detail, run_command, run_shell, validate_prerequisites,
    ScaffoldResult,
};

/// Auto-detect install command from lock files in the cloned project
fn detect_install_command(target_dir: &std::path::Path) -> Option<String> {
    claude_md::detect_install_command(target_dir)
}

/// Run install, emitting progress events. Returns warnings on failure (non-fatal).
async fn run_clone_install(
    app: &AppHandle,
    install_command: &str,
    target_dir: &std::path::Path,
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

/// Verify a cloned project (simpler than template verify — just check dir exists and has files)
fn verify_clone(target_dir: &std::path::Path) -> Vec<String> {
    let mut warnings = vec![];

    if !target_dir.exists() {
        warnings.push("Project directory was not created".to_string());
        return warnings;
    }

    let entry_count = std::fs::read_dir(target_dir)
        .map(|entries| entries.count())
        .unwrap_or(0);

    if entry_count == 0 {
        warnings.push("Cloned directory appears empty".to_string());
    }

    // Check node_modules for JS/TS projects that should have deps installed
    let has_package_json = target_dir.join("package.json").exists();
    if has_package_json {
        let node_modules = target_dir.join("node_modules");
        if node_modules.exists() {
            let nm_count = std::fs::read_dir(&node_modules)
                .map(|entries| entries.count())
                .unwrap_or(0);
            if nm_count < 3 {
                warnings.push("node_modules appears empty — dependencies may not have installed correctly".to_string());
            }
        }
    }

    warnings
}

#[tauri::command]
pub async fn clone_from_git(
    app_handle: AppHandle,
    repo_url: String,
    project_path: String,
    project_name: String,
    install_deps: bool,
    generate_claude_md: bool,
) -> Result<ScaffoldResult, String> {
    info!(
        "Clone started: repo={}, project={}",
        repo_url, project_name
    );

    let parent_dir = PathBuf::from(&project_path);
    let target_dir = parent_dir.join(&project_name);
    let mut warnings: Vec<String> = vec![];

    // Step 1: VALIDATE
    validate_prerequisites(
        &app_handle,
        &project_name,
        &parent_dir,
        &target_dir,
        None, // no template — just checks git
    )?;

    // Step 2: CLONE (full depth — user wants full history)
    emit_progress(&app_handle, "clone", "in_progress", None);

    let output = run_command(
        "git",
        &[
            "clone",
            &repo_url,
            target_dir.to_str().unwrap_or(""),
        ],
        &parent_dir,
        300, // generous timeout for large repos
    )
    .await
    .inspect_err(|e| {
        emit_progress(&app_handle, "clone", "error", Some(e));
    })?;

    if !output.success {
        let stderr = output.stderr.to_lowercase();
        let msg = if stderr.contains("authentication")
            || stderr.contains("could not read username")
            || stderr.contains("permission denied")
            || stderr.contains("401")
            || stderr.contains("403")
        {
            "This repository requires authentication. Clone it manually via terminal, then open the folder in CodeMantis.".to_string()
        } else if stderr.contains("not found")
            || stderr.contains("does not exist")
            || stderr.contains("404")
        {
            "Repository not found. Check the URL and try again.".to_string()
        } else {
            output.error_msg("Git clone failed")
        };

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

    // Step 3: INSTALL DEPENDENCIES (if requested)
    if install_deps {
        emit_progress(&app_handle, "install", "in_progress", None);

        if let Some(install_cmd) = detect_install_command(&target_dir) {
            info!("Auto-detected install command: {}", install_cmd);
            warnings.extend(run_clone_install(&app_handle, &install_cmd, &target_dir).await);
        } else {
            emit_progress_detail(
                &app_handle,
                "install",
                "done",
                None,
                Some("No package manager lock file found — skipping install"),
            );
        }
    } else {
        emit_progress(&app_handle, "install", "done", None);
    }

    // Step 4: GENERATE CLAUDE.md (if requested and not existing)
    if generate_claude_md {
        emit_progress(&app_handle, "claude_md", "in_progress", None);

        let claude_md_path = target_dir.join("CLAUDE.md");
        if claude_md_path.exists() {
            emit_progress_detail(
                &app_handle,
                "claude_md",
                "done",
                None,
                Some("CLAUDE.md already exists — keeping the existing one"),
            );
            warnings.push("CLAUDE.md already exists — keeping the existing one".to_string());
        } else {
            let analysis = claude_md::analyze_project(&target_dir);
            let content = claude_md::generate_claude_md(&analysis);
            match std::fs::write(&claude_md_path, &content) {
                Ok(_) => {
                    emit_progress(&app_handle, "claude_md", "done", None);
                    info!("Generated CLAUDE.md for {}", project_name);
                }
                Err(e) => {
                    let msg = format!("Failed to write CLAUDE.md: {}", e);
                    emit_progress(&app_handle, "claude_md", "error", Some(&msg));
                    warnings.push(msg);
                }
            }
        }
    } else {
        emit_progress(&app_handle, "claude_md", "done", None);
    }

    // Step 5: VERIFY
    emit_progress(&app_handle, "verify", "in_progress", None);

    let verify_warnings = verify_clone(&target_dir);
    if verify_warnings.is_empty() {
        emit_progress(&app_handle, "verify", "done", None);
    } else {
        let summary = verify_warnings.join("\n");
        emit_progress_detail(
            &app_handle,
            "verify",
            "error",
            Some("Issues detected"),
            Some(&summary),
        );
    }
    warnings.extend(verify_warnings);

    // Done
    emit_progress(&app_handle, "complete", "done", None);
    info!(
        "Clone completed: repo={}, project={}",
        repo_url, project_name
    );

    Ok(ScaffoldResult {
        project_path: target_dir.to_string_lossy().to_string(),
        project_name,
        template_id: "git-clone".to_string(),
        warnings,
    })
}
