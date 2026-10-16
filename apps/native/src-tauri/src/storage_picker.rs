use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

use crate::companion_bridge::{send_framed_local_command, LocalControlCommand};

#[derive(Debug, Serialize)]
pub struct PickFolderResult {
    pub path: Option<String>,
    pub root_id: Option<String>,
    pub cancelled: bool,
}

#[tauri::command]
pub async fn pick_storage_folder(
    app: tauri::AppHandle,
    title: Option<String>,
) -> Result<PickFolderResult, String> {
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }

    let folder = builder.blocking_pick_folder();
    match folder {
        Some(file_path) => {
            let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
            let path_str = path_buf.to_string_lossy().to_string();
            let auth_res = send_framed_local_command(LocalControlCommand::AuthorizeRoot {
                path: path_buf,
                label: "Selected Storage".to_string(),
            })
            .await;

            let root_id = match auth_res {
                Ok(resp) => resp
                    .get("handle")
                    .and_then(|h| h.get("root_id"))
                    .and_then(|id| id.as_str())
                    .map(|s| s.to_string()),
                Err(_) => None,
            };

            Ok(PickFolderResult {
                path: Some(path_str),
                root_id,
                cancelled: false,
            })
        }
        None => Ok(PickFolderResult {
            path: None,
            root_id: None,
            cancelled: true,
        }),
    }
}
