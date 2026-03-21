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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
                let _ = app.opener().open_url("https://codementis.dev/help", None::<&str>);
            }
        })
        .setup(|app| {
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
