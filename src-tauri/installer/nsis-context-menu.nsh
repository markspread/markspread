; S-WS-012: Windows Explorer "Open with Markspread" entry for folders.
;
; Tauri's NSIS template invokes a hook NSH file at install/uninstall time
; (configured via bundle.windows.nsis.installerHooks). We append registry
; entries that surface "Markspread로 열기" in the Directory and Drive context
; menus, both for the clicked item ("Directory\shell\Markspread") and the
; folder background ("Directory\Background\shell\Markspread").

!macro NSIS_HOOK_POSTINSTALL
  ; Display name + icon for the menu item
  WriteRegStr HKCU "Software\Classes\Directory\shell\Markspread" "" "Markspread로 열기"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Markspread" "Icon" "$INSTDIR\markspread.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Markspread\command" "" '"$INSTDIR\markspread.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Markspread" "" "Markspread로 열기"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Markspread" "Icon" "$INSTDIR\markspread.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Markspread\command" "" '"$INSTDIR\markspread.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\Markspread" "" "Markspread로 열기"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Markspread" "Icon" "$INSTDIR\markspread.exe,0"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Markspread\command" "" '"$INSTDIR\markspread.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Markspread"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Markspread"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Markspread"
!macroend
