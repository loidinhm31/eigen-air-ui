mod companion_bridge;
mod lifecycle;
mod storage_picker;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Err(e) = lifecycle::setup_tray(app.handle()) {
                eprintln!("[tray] Failed to setup system tray: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            companion_bridge::companion_status,
            companion_bridge::companion_start,
            companion_bridge::companion_stop,
            companion_bridge::companion_send,
            storage_picker::pick_storage_folder,
            lifecycle::get_autostart_status,
            lifecycle::set_autostart,
            lifecycle::exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
