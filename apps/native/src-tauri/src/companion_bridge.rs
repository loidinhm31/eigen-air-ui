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

fn get_target_triple() -> &'static str {
    if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "aarch64-pc-windows-msvc"
    } else {
        "unknown"
    }
}

fn compute_file_sha256(path: &std::path::Path) -> Result<String, String> {
    use std::io::Read;
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open file {}: {e}", path.display()))?;
    let mut reader = std::io::BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buffer)
            .map_err(|e| format!("Failed to read file {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_binary_integrity(app: &tauri::AppHandle, bin_path: &std::path::Path) -> Result<(), String> {
    let mut manifest_candidates = vec![
        bin_path.parent().map(|p| p.join("manifest.json")),
        bin_path.parent().and_then(|p| p.parent()).map(|p| p.join("manifest.json")),
        bin_path.parent().and_then(|p| p.parent()).map(|p| p.join("binaries").join("manifest.json")),
    ];

    if let Ok(res_dir) = app.path().resource_dir() {
        manifest_candidates.push(Some(res_dir.join("manifest.json")));
        manifest_candidates.push(Some(res_dir.join("binaries").join("manifest.json")));
    }

    let mut manifest_found = false;
    for candidate in manifest_candidates.into_iter().flatten() {
        if candidate.is_file() {
            manifest_found = true;
            let manifest_str = std::fs::read_to_string(&candidate)
                .map_err(|e| format!("Failed to read manifest at {}: {e}", candidate.display()))?;
            let manifest_json: serde_json::Value = serde_json::from_str(&manifest_str)
                .map_err(|e| format!("Failed to parse manifest at {}: {e}", candidate.display()))?;
            let mut matched_entry = false;
            if let Some(files) = manifest_json.get("files").and_then(|f| f.as_array()) {
                let bin_name = bin_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                for file_entry in files {
                    let rel = file_entry.get("relative_path").and_then(|r| r.as_str()).unwrap_or("");
                    let is_match = rel == bin_name
                        || rel == format!("bin/{bin_name}")
                        || rel.ends_with(&format!("/{bin_name}"));
                    if is_match {
                        matched_entry = true;
                        if let Some(exp_size) = file_entry.get("size_bytes").and_then(|s| s.as_u64()) {
                            let meta = std::fs::metadata(bin_path)
                                .map_err(|e| format!("Failed to read metadata for {}: {e}", bin_path.display()))?;
                            if meta.len() != exp_size {
                                return Err(format!(
                                    "Companion binary size mismatch: expected {exp_size}, actual {}",
                                    meta.len()
                                ));
                            }
                        }
                        if let Some(exp_hash) = file_entry.get("sha256").and_then(|s| s.as_str()) {
                            let actual_hash = compute_file_sha256(bin_path)?;
                            if !actual_hash.eq_ignore_ascii_case(exp_hash) {
                                return Err(format!(
                                    "Companion binary checksum mismatch: expected {exp_hash}, actual {actual_hash}"
                                ));
                            }
                        }
                    }
                }
            }
            if !matched_entry {
                return Err(format!(
                    "Companion binary '{}' not declared in bundle manifest.json",
                    bin_path.display()
                ));
            }
            break;
        }
    }

    #[cfg(not(debug_assertions))]
    if !manifest_found {
        return Err("Companion manifest.json not found in trusted bundle locations; release launch forbidden".to_string());
    }
    #[cfg(debug_assertions)]
    let _ = manifest_found;

    Ok(())
}

#[tauri::command]
pub async fn companion_start(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let check = companion_status().await?;
    let status_str = check.get("status").and_then(|s| s.as_str());
    if status_str.is_some() && status_str != Some("stopped") {
        // Compatibility verification on already-running companion
        let version = check.get("version").and_then(|v| v.as_str()).unwrap_or("unknown");
        return Ok(serde_json::json!({
            "started": true,
            "already_running": true,
            "status": status_str,
            "version": version
        }));
    }

    let exec_name = if cfg!(windows) { "eigen-air-companion.exe" } else { "eigen-air-companion" };
    let triple = get_target_triple();
    let sidecar_name = if cfg!(windows) {
        format!("eigen-air-companion-{triple}.exe")
    } else {
        format!("eigen-air-companion-{triple}")
    };

    let mut possible_paths = Vec::new();

    // 1. Installed sidecar location beside running executable (standard Tauri v2 installation)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            possible_paths.push(exe_dir.join(&sidecar_name));
            possible_paths.push(exe_dir.join(exec_name));
            possible_paths.push(exe_dir.join("binaries").join(&sidecar_name));
            possible_paths.push(exe_dir.join("bin").join(exec_name));
        }
    }

    // 2. Bundle resource paths
    if let Ok(res_dir) = app.path().resource_dir() {
        possible_paths.push(res_dir.join(&sidecar_name));
        possible_paths.push(res_dir.join(exec_name));
        possible_paths.push(res_dir.join("binaries").join(&sidecar_name));
        possible_paths.push(res_dir.join("bin").join(exec_name));
    }

    // 3. In debug builds only, allow local developer fallback
    #[cfg(debug_assertions)]
    {
        if let Ok(dir) = std::env::var("EIGEN_AIR_COMPANION_DIR") {
            let dir_path = PathBuf::from(dir);
            possible_paths.push(dir_path.join(exec_name));
            possible_paths.push(dir_path.join(&sidecar_name));
        }
        if let Ok(app_dir) = app.path().app_local_data_dir() {
            possible_paths.push(app_dir.join("bin").join(exec_name));
            possible_paths.push(app_dir.join("binaries").join(&sidecar_name));
        }
    }

    let binary_path = possible_paths.into_iter().find(|p| p.is_file());

    if let Some(bin) = binary_path {
        // Validate binary integrity asynchronously via spawn_blocking
        let bin_clone = bin.clone();
        let app_handle = app.clone();
        tokio::task::spawn_blocking(move || verify_binary_integrity(&app_handle, &bin_clone))
            .await
            .map_err(|e| format!("Integrity check task failed: {e}"))??;

        let mut child = tokio::process::Command::new(&bin)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn companion controller at {}: {e}", bin.display()))?;

        for _ in 0..15 {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            let st = companion_status().await?;
            let st_str = st.get("status").and_then(|s| s.as_str());
            if st_str.is_some() && st_str != Some("stopped") {
                let version = st.get("version").and_then(|v| v.as_str()).unwrap_or("unknown");
                return Ok(serde_json::json!({
                    "started": true,
                    "already_running": false,
                    "status": st_str,
                    "version": version
                }));
            }
        }

        // Kill orphaned child on readiness timeout
        let _ = child.kill().await;
        let mut stderr_msg = String::new();
        if let Some(mut err_pipe) = child.stderr.take() {
            let mut buf = Vec::new();
            if tokio::io::AsyncReadExt::read_to_end(&mut err_pipe, &mut buf).await.is_ok() {
                stderr_msg = String::from_utf8_lossy(&buf).trim().to_string();
            }
        }
        let diag = if stderr_msg.is_empty() { String::new() } else { format!(": {stderr_msg}") };
        Err(format!(
            "Companion process spawned from '{}' failed to become ready within 3000ms{diag}",
            bin.display()
        ))
    } else {
        Err(format!("Bundled companion executable '{exec_name}' (target: {triple}) not found in trusted resource or installation locations"))
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
