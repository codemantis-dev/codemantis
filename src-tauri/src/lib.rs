mod changelog;
mod claude;
mod commands;
mod errors;
mod preview;
mod storage;
mod terminal;
mod utils;

use claude::approval_server::start_approval_server;
use claude::session::AppState;
use log::{error, info, warn};
use storage::Database;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Manager, RunEvent};
use tauri_plugin_opener::OpenerExt;

/// Recursively copy a directory and all its contents.
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Migrate data from old app identifier (dev.codemantis.app → dev.codemantis.myapp) ──
    // The APP_ID was updated to match tauri.conf.json's bundle identifier.
    // Move all files from the old data directory so existing users keep their
    // settings, database, API keys, and attachments.
    if let Some(data_root) = dirs::data_dir() {
        // Migrate both production and dev directories
        for (old_name, new_name) in [
            ("dev.codemantis.app", "dev.codemantis.myapp"),
            ("dev.codemantis.app.dev", "dev.codemantis.myapp.dev"),
        ] {
            let old_dir = data_root.join(old_name);
            let new_dir = data_root.join(new_name);
            if old_dir.is_dir() && !new_dir.exists() {
                eprintln!(
                    "[migration] Moving data from {:?} to {:?}",
                    old_dir, new_dir
                );
                if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
                    eprintln!(
                        "[migration] rename failed ({}), trying copy fallback",
                        e
                    );
                    if let Err(e2) = copy_dir_all(&old_dir, &new_dir) {
                        eprintln!(
                            "WARNING: Could not migrate data directory: {}. \
                             Old data remains at {:?}",
                            e2, old_dir
                        );
                    } else {
                        let _ = std::fs::remove_dir_all(&old_dir);
                    }
                }
            }
        }
    }

    let db_path = match utils::paths::app_data_dir() {
        Some(d) => d.join("codemantis.db"),
        None => {
            eprintln!("FATAL: Cannot determine data directory. Ensure your home directory exists.");
            std::process::exit(1);
        }
    };

    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("FATAL: Cannot create data directory {:?}: {}", parent, e);
            std::process::exit(1);
        }
    }

    let db_str = match db_path.to_str() {
        Some(s) => s,
        None => {
            eprintln!("FATAL: Database path contains invalid characters: {:?}", db_path);
            std::process::exit(1);
        }
    };

    // Back up the database before opening (which runs migrations).
    // Protects user data if a schema migration fails on version update.
    if db_path.exists() {
        let backup_path = db_path.with_extension("db.backup");
        if let Err(e) = std::fs::copy(&db_path, &backup_path) {
            eprintln!("WARNING: Could not back up database before migration: {}", e);
        }
    }

    let database = match Database::new(db_str) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("FATAL: Cannot initialize database at {:?}: {}", db_path, e);
            std::process::exit(1);
        }
    };

    // Clean up expired session messages based on retention settings
    if let Ok(settings) = commands::settings::get_settings() {
        if settings.session_logs_enabled && settings.session_logs_retention_days > 0 {
            match database.delete_expired_session_messages(settings.session_logs_retention_days) {
                Ok(deleted) if deleted > 0 => {
                    eprintln!("[startup] Cleaned up {} expired session message(s)", deleted);
                }
                Err(e) => {
                    eprintln!("[startup] Failed to clean up expired session messages: {}", e);
                }
                _ => {}
            }
        }
    }

    // Kill any orphan claude/node processes left behind by a previous crash
    utils::pid_tracker::kill_stale_orphans();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("codemantis".into()),
                    },
                ))
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new(database))
        .manage(terminal::pty_manager::TerminalPool::new())
        .manage(preview::PreviewState::new())
        .menu(|app| {
            // Credits text is in resources/Credits.rtf (centered, bundled into .app)
            // When present in Contents/Resources/, macOS uses it automatically in the About panel.
            let about_metadata = AboutMetadata::default();

            let app_submenu = Submenu::with_items(
                app,
                "CodeMantis",
                true,
                &[
                    &PredefinedMenuItem::about(
                        app,
                        Some("About CodeMantis"),
                        Some(about_metadata),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            let file_submenu = Submenu::with_items(
                app,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(app, None)?],
            )?;

            let edit_submenu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            let view_submenu = Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?;

            let window_submenu = Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?;

            let help_submenu = Submenu::with_items(
                app,
                "Help",
                true,
                &[&MenuItem::with_id(
                    app,
                    "help_website",
                    "CodeMantis Help",
                    true,
                    None::<&str>,
                )?],
            )?;

            Menu::with_items(
                app,
                &[
                    &app_submenu,
                    &file_submenu,
                    &edit_submenu,
                    &view_submenu,
                    &window_submenu,
                    &help_submenu,
                ],
            )
        })
        .on_menu_event(|app, event| {
            if event.id() == "help_website" {
                let _ = app.opener().open_url("https://codemantis.dev/docs", None::<&str>);
            }
        })
        .setup(|app| {
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            info!("CodeMantis {} starting", env!("CARGO_PKG_VERSION"));
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                // Give the approval server access to the app handle
                state.approval_state.set_app_handle(handle.clone()).await;
                // Start the HTTP approval server
                match start_approval_server(state.approval_state.clone()).await {
                    Ok(port) => {
                        let mut port_lock = state.approval_server_port.lock().await;
                        *port_lock = Some(port);
                        info!("[setup] Approval server started on port {}", port);
                    }
                    Err(e) => {
                        error!("[setup] Failed to start approval server: {}", e);
                    }
                }
            });
            // Bring window to front after launch — ensures visibility after update relaunch
            let focus_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                if let Some(window) = focus_handle.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::startup::check_claude_status,
            commands::startup::set_claude_binary_override,
            commands::session::create_session,
            commands::session::pause_session_process,
            commands::session::resume_session_process,
            commands::session::send_message,
            commands::session::set_session_mode,
            commands::session::sync_session_mode,
            commands::session::resolve_tool_approval,
            commands::session::close_session,
            commands::session::check_process_alive,
            commands::session::get_session,
            commands::session::list_sessions,
            commands::session::rename_session,
            commands::session::list_persisted_sessions,
            commands::session::delete_persisted_session,
            commands::session::list_session_history,
            commands::session::interrupt_session,
            commands::session::set_session_model,
            commands::session::initialize_session,
            commands::files::read_file_tree,
            commands::files::read_file_content,
            commands::files::write_file_content,
            commands::files::rename_file,
            commands::files::delete_file,
            commands::files::duplicate_file,
            commands::files::create_file,
            commands::files::create_directory,
            commands::terminal::create_terminal,
            commands::terminal::send_terminal_input,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::terminal::list_terminals,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::attachments::read_file_bytes,
            commands::attachments::save_clipboard_image,
            commands::attachments::get_file_info,
            commands::attachments::cleanup_old_attachments,
            commands::changelog::generate_changelog_entry,
            commands::changelog::get_changelog_entries,
            commands::changelog::delete_changelog_entry,
            commands::changelog::test_changelog_api_key,
            commands::changelog::get_project_changelog_entries,
            commands::git::get_git_status,
            commands::git::get_git_log,
            commands::mcp::get_mcp_servers,
            commands::mcp::save_mcp_server,
            commands::mcp::delete_mcp_server,
            commands::mcp::rename_mcp_server,
            commands::mcp::get_mcp_config_path,
            commands::slash_commands::discover_commands,
            commands::slash_commands::expand_skill,
            commands::slash_commands::run_oneshot_command,
            commands::api_logs::get_api_logs,
            commands::api_logs::get_api_cost_summary,
            commands::api_logs::cleanup_api_logs,
            commands::assistant_chat::send_assistant_chat,
            commands::assistant_chat::cancel_assistant_chat,
            commands::openrouter::fetch_openrouter_models,
            commands::openrouter::test_openrouter_key,
            commands::scaffold::list_templates,
            commands::scaffold::check_template_prerequisites,
            commands::scaffold::install_prerequisite,
            commands::scaffold::scaffold_from_template,
            commands::scaffold::scaffold_from_cli,
            commands::scaffold::verify_template,
            commands::clone::clone_from_git,
            commands::claude_md::analyze_project_cmd,
            commands::claude_md::generate_claude_md_cmd,
            commands::preview::open_preview_window,
            commands::preview::close_preview_window,
            commands::preview::navigate_preview,
            commands::preview::refresh_preview,
            commands::preview::focus_preview_window,
            commands::preview::start_dev_server,
            commands::preview::stop_dev_server,
            commands::preview::get_dev_server_status,
            commands::preview::get_preview_console_logs,
            commands::preview::capture_preview_screenshot,
            commands::session::save_session_messages,
            commands::session::load_session_messages,
            commands::session::search_session_messages,
            commands::session::cleanup_expired_session_logs,
            commands::session::create_specwriter_session,
            commands::session::close_specwriter_session,
            commands::specwriter::save_task_board_state,
            commands::specwriter::load_task_board_state,
            commands::specwriter::delete_task_plan_cmd,
            commands::specwriter::archive_task_plan_cmd,
            commands::specwriter::save_spec_document,
            commands::specwriter::list_spec_documents,
            commands::specwriter::read_spec_document,
            commands::specwriter::delete_spec_document,
            commands::specwriter::gather_spec_context,
            commands::specwriter::read_project_files,
            commands::specwriter::add_verification_workflow_to_claude_md,
            commands::snapshot::gather_project_snapshot,
            commands::help::read_user_guide,
            commands::guide::save_guide,
            commands::guide::load_guide,
            commands::guide::update_guide_data,
            commands::guide::delete_guide_cmd,
            commands::guide::delete_guides_for_project_cmd,
            commands::super_bro::save_observation,
            commands::super_bro::load_observations,
            commands::super_bro::delete_observation,
            commands::super_bro::read_super_bro_module,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } => {
                // Async cleanup while the tokio runtime is still alive.
                // Shut down all active Claude CLI processes and terminals gracefully.
                let handle = app_handle.clone();
                let (done_tx, done_rx) = std::sync::mpsc::channel();

                tauri::async_runtime::spawn(async move {
                    // Shut down all Claude CLI processes
                    if let Some(state) = handle.try_state::<AppState>() {
                        let mut processes = state.processes.lock().await;
                        for (sid, proc) in processes.iter_mut() {
                            info!("[exit] Shutting down CLI process for session {}", sid);
                            proc.shutdown().await;
                        }
                        processes.clear();
                    }

                    // Close all PTY terminals
                    if let Some(pool) = handle.try_state::<terminal::pty_manager::TerminalPool>() {
                        pool.close_all_terminals().await;
                    }

                    let _ = done_tx.send(());
                });

                // Wait up to 5 seconds for async cleanup to finish
                match done_rx.recv_timeout(std::time::Duration::from_secs(5)) {
                    Ok(()) => info!("[exit] Graceful cleanup completed"),
                    Err(_) => warn!("[exit] Graceful cleanup timed out after 5s"),
                }
            }
            RunEvent::Exit => {
                // Synchronous last-resort fallback: SIGKILL anything still tracked
                utils::pid_tracker::kill_all_registered_sync();
                utils::pid_tracker::clear_pid_file();
                info!("[exit] Final cleanup done");
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_dir_all_copies_files() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");

        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("a.txt"), "hello").unwrap();
        std::fs::write(src.join("b.txt"), "world").unwrap();

        copy_dir_all(&src, &dst).unwrap();

        assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "hello");
        assert_eq!(std::fs::read_to_string(dst.join("b.txt")).unwrap(), "world");
    }

    #[test]
    fn copy_dir_all_copies_nested_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let nested = src.join("sub").join("deep");
        let dst = tmp.path().join("dst");

        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("file.db"), "data").unwrap();
        std::fs::write(src.join("root.json"), "{}").unwrap();

        copy_dir_all(&src, &dst).unwrap();

        assert_eq!(
            std::fs::read_to_string(dst.join("sub/deep/file.db")).unwrap(),
            "data"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("root.json")).unwrap(),
            "{}"
        );
    }

    #[test]
    fn copy_dir_all_creates_destination() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("a/b/c");

        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("f.txt"), "ok").unwrap();

        copy_dir_all(&src, &dst).unwrap();

        assert!(dst.exists());
        assert_eq!(std::fs::read_to_string(dst.join("f.txt")).unwrap(), "ok");
    }

    #[test]
    fn copy_dir_all_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("empty");
        let dst = tmp.path().join("dst");

        std::fs::create_dir_all(&src).unwrap();

        copy_dir_all(&src, &dst).unwrap();

        assert!(dst.is_dir());
        assert_eq!(std::fs::read_dir(&dst).unwrap().count(), 0);
    }
}
