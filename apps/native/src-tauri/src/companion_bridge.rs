use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const FRAME_MAGIC: [u8; 4] = *b"EACF";
const FRAME_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "cmd")]
pub enum LocalControlCommand {
    GetStatus,
    ListRoots,
    AuthorizeRoot {
        path: PathBuf,
        label: String,
    },
    SelectActiveRoot {
        root_id: String,
    },
    ListCatalog,
    ListInstalledModels,
    StartDownload {
        artifact_id: String,
        #[serde(default)]
        license_accepted: bool,
    },
    GetOperationSnapshot {
        operation_id: String,
    },
    CancelOperation {
        operation_id: String,
    },
    PrepareCache {
        prefix_text: String,
        model_id: String,
        max_tokens: usize,
    },
    PurgeCache {
        namespace_hash: Option<String>,
    },
    Unpair {
        delete_caches: bool,
        #[serde(default)]
        device_id: Option<String>,
        #[serde(default)]
        tenant_id: Option<String>,
        #[serde(default)]
        user_id: Option<String>,
        #[serde(default)]
        enrollment_id: Option<String>,
        #[serde(default)]
        namespace_hash: Option<String>,
    },
    StopCompanion {
        keep_running: bool,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct FramedWireMessage<T> {
    pub version: u32,
    pub sequence: u64,
    pub request_id: String,
    pub generation: u64,
    pub body_sha256: String,
    pub payload: T,
}

fn compute_sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

pub fn get_companion_socket_path() -> PathBuf {
    if let Ok(dir) = std::env::var("EIGEN_AIR_COMPANION_DIR") {
        return PathBuf::from(dir).join("companion.sock");
    }
    if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home)
            .join(".eigen-air")
            .join("companion")
            .join("companion.sock")
    } else {
        PathBuf::from(".eigen-air-companion").join("companion.sock")
    }
}

pub async fn send_framed_local_command(
    cmd: LocalControlCommand,
) -> Result<serde_json::Value, String> {
    #[cfg(unix)]
    {
        let socket_path = get_companion_socket_path();
        let mut stream = tokio::net::UnixStream::connect(&socket_path)
            .await
            .map_err(|e| format!("Failed to connect to companion socket at {}: {e}", socket_path.display()))?;

        let payload_bytes = serde_json::to_vec(&cmd).map_err(|e| e.to_string())?;
        let body_sha256 = compute_sha256_hex(&payload_bytes);

        let wire = FramedWireMessage {
            version: FRAME_VERSION,
            sequence: 1,
            request_id: "tauri-desktop".to_string(),
            generation: 1,
            body_sha256,
            payload: cmd,
        };

        let wire_bytes = serde_json::to_vec(&wire).map_err(|e| e.to_string())?;
        if wire_bytes.len() > MAX_FRAME_BYTES {
            return Err("Payload exceeds MAX_FRAME_BYTES limit".to_string());
        }

        let mut frame_buf = Vec::with_capacity(8 + wire_bytes.len());
        frame_buf.extend_from_slice(&FRAME_MAGIC);
        frame_buf.extend_from_slice(&(wire_bytes.len() as u32).to_be_bytes());
        frame_buf.extend_from_slice(&wire_bytes);

        stream.write_all(&frame_buf).await.map_err(|e| e.to_string())?;
        stream.flush().await.map_err(|e| e.to_string())?;

        // Read header (8 bytes)
        let mut header = [0u8; 8];
        stream.read_exact(&mut header).await.map_err(|e| e.to_string())?;

        if header[0..4] != FRAME_MAGIC {
            return Err("Invalid magic header received from companion socket".to_string());
        }
        let body_len = u32::from_be_bytes([header[4], header[5], header[6], header[7]]) as usize;
        if body_len > MAX_FRAME_BYTES {
            return Err("Companion response frame exceeded maximum allowed size".to_string());
        }

        let mut body = vec![0u8; body_len];
        stream.read_exact(&mut body).await.map_err(|e| e.to_string())?;

        let resp_wire: FramedWireMessage<serde_json::Value> =
            serde_json::from_slice(&body).map_err(|e| e.to_string())?;

        Ok(resp_wire.payload)
    }

    #[cfg(not(unix))]
    {
        let _ = cmd;
        Err("Local companion IPC requires a Unix domain socket on this platform".to_string())
    }
}

#[tauri::command]
pub async fn companion_status() -> Result<serde_json::Value, String> {
    match send_framed_local_command(LocalControlCommand::GetStatus).await {
        Ok(res) => Ok(res),
        Err(_) => Ok(serde_json::json!({
            "response": "status",
            "version": "unknown",
            "status": "stopped",
            "active_root": "",
            "queued_requests": 0,
            "model_loaded": false
        })),
    }
}

#[tauri::command]
pub async fn companion_start(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let check = companion_status().await?;
    let status_str = check.get("status").and_then(|s| s.as_str());
    if status_str.is_some() && status_str != Some("stopped") {
        return Ok(serde_json::json!({ "started": true, "already_running": true }));
    }

    let exec_name = if cfg!(windows) { "eigen-air-companion.exe" } else { "eigen-air-companion" };
    let mut possible_paths = Vec::new();

    if let Ok(res_dir) = app.path().resource_dir() {
        possible_paths.push(res_dir.join(exec_name));
        possible_paths.push(res_dir.join("bin").join(exec_name));
    }
    if let Ok(app_dir) = app.path().app_local_data_dir() {
        possible_paths.push(app_dir.join("bin").join(exec_name));
    }

    if let Ok(dir) = std::env::var("EIGEN_AIR_COMPANION_DIR") {
        possible_paths.push(PathBuf::from(dir).join(exec_name));
    }

    let binary_path = possible_paths.into_iter().find(|p| p.is_file());

    if let Some(bin) = binary_path {
        tokio::process::Command::new(bin)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn companion controller: {e}"))?;

        for _ in 0..15 {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            let st = companion_status().await?;
            let st_str = st.get("status").and_then(|s| s.as_str());
            if st_str.is_some() && st_str != Some("stopped") {
                return Ok(serde_json::json!({ "started": true, "already_running": false }));
            }
        }
        Ok(serde_json::json!({ "started": true, "socket_pending": true }))
    } else {
        Err(format!("Bundled companion executable '{exec_name}' not found"))
    }
}

#[tauri::command]
pub async fn companion_stop(keep_running: bool) -> Result<serde_json::Value, String> {
    send_framed_local_command(LocalControlCommand::StopCompanion { keep_running }).await
}

#[tauri::command]
pub async fn companion_send(cmd: LocalControlCommand) -> Result<serde_json::Value, String> {
    // Security check: AuthorizeRoot cannot be sent directly from webview; it must originate from pick_storage_folder
    if matches!(cmd, LocalControlCommand::AuthorizeRoot { .. }) {
        return Err("Direct authorization of arbitrary paths is forbidden; use pick_storage_folder".to_string());
    }
    send_framed_local_command(cmd).await
}
