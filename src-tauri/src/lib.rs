mod changelog;
mod claude;
mod commands;
mod errors;
mod storage;
mod terminal;
mod utils;

use claude::session::AppState;
use storage::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let db_path = dirs::data_dir()
        .map(|d| d.join("com.claudeforge.app").join("claudeforge.db"))
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
        .invoke_handler(tauri::generate_handler![
            commands::startup::check_claude_status,
            commands::session::create_session,
            commands::session::send_message,
            commands::session::respond_to_approval,
            commands::session::respond_to_question,
            commands::session::close_session,
            commands::session::get_session,
            commands::session::list_sessions,
            commands::session::rename_session,
            commands::session::list_persisted_sessions,
            commands::session::delete_persisted_session,
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
            commands::attachments::save_clipboard_image,
            commands::attachments::get_file_info,
            commands::attachments::cleanup_old_attachments,
            commands::changelog::generate_changelog_entry,
            commands::changelog::get_changelog_entries,
            commands::changelog::delete_changelog_entry,
            commands::changelog::test_changelog_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
