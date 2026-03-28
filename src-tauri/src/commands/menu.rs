use tauri::menu::MenuItemKind;
use tauri::AppHandle;

#[tauri::command]
pub async fn enable_update_menu_item(app: AppHandle, version: String) -> Result<(), String> {
    let menu = app.menu().ok_or("No app menu found")?;
    if let Some(MenuItemKind::MenuItem(item)) = menu.get("check_for_updates") {
        item.set_text(format!("Restart to Update (v{version})..."))
            .map_err(|e| e.to_string())?;
        item.set_enabled(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn disable_update_menu_item(app: AppHandle) -> Result<(), String> {
    let menu = app.menu().ok_or("No app menu found")?;
    if let Some(MenuItemKind::MenuItem(item)) = menu.get("check_for_updates") {
        item.set_text("Check for Updates...")
            .map_err(|e| e.to_string())?;
        item.set_enabled(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}
