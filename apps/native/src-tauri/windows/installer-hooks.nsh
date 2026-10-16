; apps/native/src-tauri/windows/installer-hooks.nsh
; Tauri v2 NSIS installer and uninstaller lifecycle hooks for Eigen Air Desktop

!macro NSIS_HOOK_PREINSTALL
    ; Set user-level execution scope without requiring administrative UAC elevation
    SetShellVarContext current
!macroend

!macro NSIS_HOOK_POSTINSTALL
    DetailPrint "Configuring Eigen Air Desktop per-user environment..."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
    ; Default data retention policy:
    ; Ordinary uninstall preserves bulk model weights, local caches, and paired root configurations.
    ; /SD IDYES provides silent uninstall default answering YES (keep data) to avoid uninstaller hangs.

    MessageBox MB_YESNO|MB_ICONQUESTION /SD IDYES \
        "Do you want to KEEP your downloaded models, session caches, and registered storage roots?$\r$\n$\r$\n(Recommended: Yes. Select No only if you explicitly want to unpair this device and remove pairing credentials.)" \
        IDYES KeepData IDNO PurgeCredentials

KeepData:
    DetailPrint "Preserving user models, caches, and storage roots per retention policy."
    Goto EndUninstallPolicy

PurgeCredentials:
    ; Explicit unpair path:
    ; Remove paired client credentials and enrollment session caches, but preserve all bulk model weights.
    DetailPrint "Removing paired client credentials and enrollment tokens..."
    RMDir /r "$APPDATA\eigen-air\companion\credentials"
    DetailPrint "Removing local session KV caches for unpairing enrollment..."
    RMDir /r "$LOCALAPPDATA\eigen-air\companion\cache"
    DetailPrint "Preserved all registered model weights ($LOCALAPPDATA\eigen-air\companion\models) and external storage roots."
EndUninstallPolicy:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
    DetailPrint "Eigen Air uninstallation completed."
!macroend
