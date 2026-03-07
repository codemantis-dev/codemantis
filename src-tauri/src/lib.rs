mod claude;
mod commands;
mod errors;
mod utils;

use claude::session::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::startup::check_claude_status,
            commands::session::create_session,
            commands::session::send_message,
            commands::session::respond_to_approval,
            commands::session::close_session,
            commands::session::get_session,
            commands::session::list_sessions,
            commands::files::read_file_tree,
            commands::files::read_file_content,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
