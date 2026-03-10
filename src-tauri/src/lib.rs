mod changelog;
mod claude;
mod commands;
mod errors;
mod storage;
mod terminal;
mod utils;

use claude::approval_server::start_approval_server;
use claude::session::AppState;
use log::info;
use storage::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let db_path = dirs::data_dir()
        .map(|d| d.join("dev.codemantis.app").join("codemantis.db"))
        .expect("Failed to determine data directory");

    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create data directory");
    }

    let database = Database::new(
        db_path.to_str().expect("Invalid database path"),
    )
    .expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(database))
        .manage(terminal::pty_manager::TerminalPool::new())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                // Give the approval server access to the app handle
                state.approval_state.set_app_handle(handle.clone()).await;
                // Start the HTTP approval server
                let port = start_approval_server(state.approval_state.clone()).await;
                {
                    let mut port_lock = state.approval_server_port.lock().await;
                    *port_lock = Some(port);
                }
                info!("[setup] Approval server started on port {}", port);
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
            commands::session::resolve_tool_approval,
            commands::session::close_session,
            commands::session::get_session,
            commands::session::list_sessions,
            commands::session::rename_session,
            commands::session::list_persisted_sessions,
            commands::session::delete_persisted_session,
            commands::session::list_session_history,
            commands::files::read_file_tree,
            commands::files::read_file_content,
            commands::files::write_file_content,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
