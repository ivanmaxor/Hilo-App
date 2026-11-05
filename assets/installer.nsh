; Siempre para el usuario actual: sin la pantalla de "¿para quién instalar?" ni permisos de administrador.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Sueltos, y no en una macro: la pantalla final se define antes de customHeader.
!ifndef BUILD_UNINSTALLER
  ; La casilla de la pantalla final es la de "ver el léeme" de NSIS, con otro texto y otra acción.
  !define MUI_FINISHPAGE_RUN_TEXT "Abrir Hilo al terminar"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Crear un acceso directo en el escritorio"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopLink
!endif

; En una macro, y no suelta: aquí arriba todavía no están cargados los plugins.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Function CreateDesktopLink
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\Hilo.exe" "" "$INSTDIR\Hilo.exe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    FunctionEnd
  !endif
!macroend

!macro customInstall
  ; Sin pantallas no hay casilla, así que una instalación desatendida lo crea.
  ; Una actualización no toca nada: quien lo tiene lo conserva, y quien no lo quiso no lo recupera.
  ${if} ${Silent}
  ${andIfNot} ${isUpdated}
    Call CreateDesktopLink
  ${endif}
!macroend

!macro customUnInstall
  ; Todo instalador corre primero el desinstalador viejo, siempre con --updated: ahí no se borra nada de esto.
  ; hilo-updater es además la carpeta desde donde corre el instalador de la actualización.
  ${ifNot} ${isUpdated}
    ; La caché del actualizador, con la copia que deja el instalador: al desinstalar no debe quedar nada.
    RMDir /r "$LOCALAPPDATA\hilo-updater"
    ; Lo crea la casilla del instalador, así que el desinstalador estándar no lo conoce.
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${endIf}
!macroend
