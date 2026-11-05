# R4 - Atajos de teclado (Claude Code, terminales Windows) y mapa propuesto

Fecha: 2026-11-02. Claude Code instalado: 2.1.316. `C:\Users\dev\.claude\keybindings.json` NO existe (todo por defecto, sin personalizaciones).
Fuentes leidas hoy: https://code.claude.com/docs/en/interactive-mode , https://code.claude.com/docs/en/keybindings
Windows Terminal, VS Code y PSReadLine: conocimiento propio, NO verificado hoy. Referencias: https://learn.microsoft.com/windows/terminal/customize-settings/actions , https://learn.microsoft.com/powershell/module/psreadline/about/about_psreadline_functions

## 1. Claude Code (defaults actuales)
| Tecla | Accion |
|---|---|
| Ctrl+C (reservada) | Interrumpe / limpia input; 2.a vez sale |
| Ctrl+D (reservada) | Salir (2 pulsaciones en 800 ms); con texto borra caracter |
| Esc / Esc Esc | Interrumpir o cerrar dialogo / limpiar input o abrir rewind |
| Ctrl+L | Redibujar pantalla |
| Ctrl+O | Transcript (Ctrl+E dentro = mostrar todo) |
| Ctrl+R | Busqueda en historial (Ctrl+S cambia ambito en fullscreen) |
| Ctrl+T | Checklist de tareas (en agent view: pin) |
| Ctrl+B | Segundo plano (tmux: doble) |
| Ctrl+G / Ctrl+X Ctrl+E | Editor externo |
| Ctrl+S | Stash/restaurar prompt |
| Ctrl+V / Alt+V (Windows) | Pegar imagen del portapapeles |
| Shift+Tab (Alt+M si el runtime no tiene VT) | Ciclar modos de permiso |
| Alt+P / Alt+T / Alt+O | Modelo / thinking / fast mode |
| Ctrl+A, Ctrl+E | Inicio / fin de linea |
| Ctrl+K | Borrar hasta fin de linea (se recupera con Ctrl+Y) |
| Ctrl+U | Borrar hasta inicio de linea |
| Ctrl+W | Borrar hasta whitespace anterior |
| Ctrl+Y, Alt+Y | Pegar lo borrado, ciclar |
| Alt+B / Alt+F / Alt+D | Palabra atras / adelante / borrar palabra |
| Ctrl+_ o Ctrl+Shift+- | Deshacer edicion |
| Ctrl+P / Ctrl+N | Historial arriba/abajo, listas |
| Shift+Enter (nativo en Windows Terminal), Ctrl+J, `\`+Enter | Nueva linea |
| Ctrl+Enter / Ctrl+X Ctrl+S | Enviar mensajes encolados ya |
| Ctrl+X + (Ctrl+K, Enter, Ctrl+A, Tab, B, X, flechas) | Acordes con prefijo Ctrl+X (subagentes, diff panel, panes) |
| Ctrl+Shift+C | Copiar seleccion (fullscreen); Shift+flechas extienden seleccion |
| Ctrl+Up/Down, Meta+Up/Down | Lista de archivos del diff panel / grupos en agent view |
| Ctrl+F | Solo en agent view (`claude agents`): buscar |
| Ctrl+Z | Solo Unix; no aplica en Windows |
Reservadas (no reasignables): Ctrl+C, Ctrl+D, Ctrl+M, Ctrl+[, Ctrl+I, Ctrl+H.
**Claude Code NO usa**: Alt+1..9, Ctrl+1..9, Ctrl+Tab, F2, F11, Ctrl+, ni ninguna Ctrl+Shift+letra salvo Ctrl+Shift+C (y Ctrl+Shift+-).

## 2. Terminales Windows (defaults, conocimiento propio)
| Programa | Atajos relevantes |
|---|---|
| Windows Terminal | Ctrl+Shift+T nueva pestana, Ctrl+Shift+1..9 perfil N, Ctrl+Tab / Ctrl+Shift+Tab siguiente/anterior, Ctrl+Alt+1..9 ir a pestana N, Ctrl+Shift+W cerrar, Ctrl+Shift+N ventana, Ctrl+Shift+F buscar, Ctrl+Shift+P paleta, Ctrl+Shift+C/V, Alt+Shift+D duplicar panel, Alt+Shift+-/+ dividir, Alt+flechas foco, Alt+Shift+flechas redimensionar, Ctrl+= / Ctrl+- / Ctrl+0 zoom, Ctrl+, ajustes, F11 y Alt+Enter pantalla completa |
| VS Code terminal | Ctrl+` abrir, Ctrl+Shift+` nueva, Ctrl+Shift+5 dividir, Alt+flechas foco entre paneles, Ctrl+PageUp/Down cambiar terminal, Ctrl+F buscar, Ctrl+Shift+C/V; algunas teclas (p. ej. Ctrl+K como prefijo) las consume VS Code segun `commandsToSkipShell` |
| PSReadLine (modo Windows) | Ctrl+R / Ctrl+S historial, Ctrl+Space MenuComplete, Ctrl+Alt+? lista de atajos, Alt+? ayuda, Alt+F7 limpiar historial, F2 alterna vista de predicciones, F7 historial, Ctrl+Left/Right palabra, Ctrl+Backspace/Del, Ctrl+Z/Y, Alt+0..9 / Alt+- argumento-digito; en modo Emacs: Ctrl+A/E/K/U/W/Y/F/B/P/N |

## 3. Colisiones relevantes
- **Ctrl+K**: Claude lo usa (borrar a fin de linea) y PSReadLine-Emacs tambien; ademas hay acorde Ctrl+X Ctrl+K. NO usar tal cual.
- **Ctrl+P**: Claude (historial arriba, listas) y PSReadLine-Emacs. NO usar.
- **Ctrl+T / B / O / R / L / G / S / F**: Claude. No usar solos.
- **Alt+1..9**: PSReadLine los usa como argumento-digito; preferir Ctrl+1..9.
- **Ctrl+Alt+letra/digito**: en teclado espanol Ctrl+Alt = AltGr (@, #, [, ]...). Evitar.
- **Alt+Shift**: Windows lo usa para cambiar idioma del teclado. Evitar.
- **Ctrl+-**: el terminal envia 0x1F = Ctrl+_ (deshacer de Claude). Si la app captura Ctrl+- para zoom no llega al PTY (bien).
- **Ctrl+Shift+letra**: libres en Claude/PSReadLine, pero xterm.js las manda como Ctrl+letra al PTY salvo que se intercepten (`attachCustomKeyEventHandler` devolviendo false + preventDefault). Reservar Ctrl+Shift+C/V para copiar/pegar. En Electron evitar Ctrl+Shift+I y Ctrl+Shift+R si el menu por defecto esta activo.
- **Alt+Up/Down**: en Claude solo cuentan en diff panel / agent view (Meta+Up/Down); choque menor.

## 4. Mapa propuesto para la app
| Accion | Atajo | Nota |
|---|---|---|
| Nueva sesion claude | Ctrl+Shift+T | como WT |
| Nueva terminal PowerShell | Ctrl+Shift+H | h de shell |
| Cerrar sesion | Ctrl+Shift+W | confirmar si esta activa |
| Renombrar | F2 | Claude no lo usa; el F2 de PSReadLine solo importa con foco en prompt |
| Dormir / Despertar | Ctrl+Shift+Z (alterna) | tambien en paleta |
| Siguiente / anterior sesion | Ctrl+Tab / Ctrl+Shift+Tab (alt: Ctrl+PageDown/Up) | libres |
| Ir a sesion N | Ctrl+1..9 (9 = ultima) | no usados por Claude/PSReadLine |
| Selector rapido | **Ctrl+Shift+K** (alias Ctrl+Shift+P) | ver 5 |
| Buscar en terminal | Ctrl+Shift+F | como WT |
| Zoom + / - / 0 | Ctrl+= / Ctrl+- / Ctrl+0 | tambien Ctrl+rueda |
| Barra lateral | Ctrl+Shift+B | Ctrl+B es de Claude |
| Vista dividida 1/2/4 | Ctrl+Shift+1 / 2 / 4 | usar `event.code` (layout espanol cambia el simbolo) |
| Foco entre paneles | Alt+Flechas | como WT/VS Code |
| Ajustes | Ctrl+, | convencion WT/VS Code |
| Nuevo proyecto | Ctrl+Shift+N | |
| Siguiente sesion no leida | Ctrl+Shift+U | u de unread |
| Pantalla completa | F11 | |

## 5. Selector rapido: Ctrl+K si o no
Verificado: Ctrl+K es "Delete to end of line" en Claude Code (y en PSReadLine Emacs), ademas del acorde Ctrl+X Ctrl+K. Ctrl+P tambien colisiona (historial). Alternativa exacta: **Ctrl+Shift+K**, libre en Claude, PSReadLine, WT y VS Code por defecto; alias Ctrl+Shift+P (paleta, familiar). Opcional en ajustes: "Ctrl+K abre selector cuando el foco NO esta en un terminal" (barra lateral), sin sacrificar el kill-line.
Implementacion: interceptar en la capa de la app antes de xterm.js; atajos reasignables.
