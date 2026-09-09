; Ask a running TRS AIP Desktop instance to dispose its Harness generation
; before an upgrade overwrites application files. The fallback is scoped to
; the exact application executable name.
!macro customCheckAppRunning
  nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
  Pop $R0
  ${If} $R0 == 0
    IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 trs_aip_desktop_force_prompt
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --trs-installer-quit'
    StrCpy $R1 0

    trs_aip_desktop_wait:
      nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
      Pop $R0
      ${If} $R0 != 0
        Goto trs_aip_desktop_stopped
      ${EndIf}
      IntOp $R1 $R1 + 1
      ${If} $R1 < 60
        Sleep 500
        Goto trs_aip_desktop_wait
      ${EndIf}

    trs_aip_desktop_force_prompt:
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "TRS AIP Desktop is still running. Close it to continue the upgrade." /SD IDOK IDOK trs_aip_desktop_force
      Quit

    trs_aip_desktop_force:
      nsProcess::_KillProcess "${APP_EXECUTABLE_FILENAME}"
      Pop $R0
      Sleep 1000
  ${EndIf}

  trs_aip_desktop_stopped:
!macroend
