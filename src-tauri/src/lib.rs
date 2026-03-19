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
use log::{error, info};
use storage::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("warn")
    ).init();

    let db_path = match dirs::data_dir() {
        Some(d) => d.join("dev.codemantis.app").join("codemantis.db"),
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

    let database = match Database::new(db_str) {
        Ok(db) => db,
        Err(e) => {
            eprintln!("FATAL: Cannot initialize database at {:?}: {}", db_path, e);
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(database))
        .manage(terminal::pty_manager::TerminalPool::new())
        .manage(preview::PreviewState::new())
        .setup(|app| {
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
            commands::slash_commands::discover_commands,
            commands::slash_commands::expand_skill,
            commands::slash_commands::run_oneshot_command,
            commands::api_logs::get_api_logs,
            commands::api_logs::get_api_cost_summary,
            commands::api_logs::cleanup_api_logs,
            commands::assistant_chat::send_assistant_chat,
            commands::scaffold::list_templates,
            commands::scaffold::check_template_prerequisites,
            commands::scaffold::install_prerequisite,
            commands::scaffold::scaffold_from_template,
            commands::scaffold::scaffold_from_cli,
            commands::scaffold::verify_template,
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
            commands::snapshot::gather_project_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
