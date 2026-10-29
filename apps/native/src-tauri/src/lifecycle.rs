use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};



#[derive(Debug, Serialize)]
pub struct AutostartStatus {
    pub enabled: bool,
}

#[tauri::command]
pub fn get_autostart_status() -> AutostartStatus {
    // Check if autostart entry exists in user config / desktop entries
    AutostartStatus { enabled: false }
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> AutostartStatus {
    AutostartStatus { enabled }
}

#[tauri::command]
pub async fn exit_app(app: AppHandle, _keep_companion: bool) -> Result<(), String> {
    // Managed OS services persist after UI closes; never stop background OS service on app exit.
    app.exit(0);
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open eigen-air", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit eigen-air", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &quit])?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
