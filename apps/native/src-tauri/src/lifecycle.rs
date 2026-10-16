use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::companion_bridge::companion_stop;

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
pub async fn exit_app(app: AppHandle, keep_companion: bool) -> Result<(), String> {
    if !keep_companion {
        let _ = companion_stop(false).await;
    }
    app.exit(0);
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open eigen-air", true, None::<&str>)?;
    let quit_keep = MenuItem::with_id(
        app,
        "quit_keep",
        "Quit (Keep Companion Running)",
        true,
        None::<&str>,
    )?;
    let quit_all = MenuItem::with_id(app, "quit_all", "Quit (Stop Companion)", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &quit_keep, &quit_all])?;

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
            "quit_keep" => {
                app.exit(0);
            }
            "quit_all" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = companion_stop(false).await;
                    app_handle.exit(0);
                });
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
