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
    ; First attempt: Invoke authoritative companion unpair command while binary is available.
    ; This ensures OS-credential backends, invalidation tombstones, and enrollment caches are cleaned authoritatively.
    DetailPrint "Executing authoritative companion unpair..."
    IfFileExists "$INSTDIR\eigen-air-companion.exe" RunCompanionUnpair TrySidecarUnpair
RunCompanionUnpair:
    ExecWait '"$INSTDIR\eigen-air-companion.exe" unpair --delete-caches' $0
    IntCmp $0 0 UnpairSuccess RunFallback RunFallback
TrySidecarUnpair:
    IfFileExists "$INSTDIR\bin\eigen-air-companion.exe" RunBinCompanionUnpair RunFallback
RunBinCompanionUnpair:
    ExecWait '"$INSTDIR\bin\eigen-air-companion.exe" unpair --delete-caches' $0
    IntCmp $0 0 UnpairSuccess RunFallback RunFallback
UnpairSuccess:
    DetailPrint "Authoritative companion unpair completed successfully (exit code 0)."
    Goto PostUnpairCommand
RunFallback:
    DetailPrint "Companion binary not runnable or returned non-zero code ($0). Running cleanup fallback..."
    Goto PostUnpairCommand
PostUnpairCommand:
    ; Fallback file cleanup for credential stores and caches matching runtime data directories
    ; (covers $PROFILE\.eigen-air\companion, $APPDATA\eigen-air\companion, and $LOCALAPPDATA\eigen-air\companion)
    DetailPrint "Cleaning paired client credentials and enrollment tokens..."
    RMDir /r "$PROFILE\.eigen-air\companion\credentials"
    RMDir /r "$APPDATA\eigen-air\companion\credentials"
    DetailPrint "Cleaning local session KV caches for unpairing enrollment..."
    RMDir /r "$PROFILE\.eigen-air\companion\cache"
    RMDir /r "$LOCALAPPDATA\eigen-air\companion\cache"
    DetailPrint "Preserved all registered model weights and external storage roots."
EndUninstallPolicy:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
    DetailPrint "Eigen Air uninstallation completed."
!macroend
