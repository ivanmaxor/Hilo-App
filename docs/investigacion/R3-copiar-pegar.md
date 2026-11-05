# R3 - Copiar/pegar en terminales embebidas (xterm.js + ConPTY + Claude Code TUI, Win11)
Fecha: 2026-11-02. Fuentes: gh api sobre repos publicos. [V]=verificado en codigo/issue, [I]=inferencia a validar con la bateria de pruebas.

## 0. Version de xterm.js: decision previa
- `@xterm/xterm` latest = 6.0.0 (dic 2025); beta 6.1.0-beta.336 (29-oct-2026). [V npm]
- `win32InputMode` (DECSET 9001) entro en main en ene-2026 (milestone 7.0.0): https://github.com/xtermjs/xterm.js/pull/5603 ; NO esta en 6.0.0 (404 en tag). [V]
- Sanitizado de ESC en bracketed paste (ESC -> U+241B) entro feb-2026: https://github.com/xtermjs/xterm.js/pull/5716 ; NO esta en 6.0.0. [V]
- Mitigacion: fijar la beta 6.1.x (o 6.0.0 + sanitizar tu mismo) y cubrir ambos casos en tests. `@xterm/addon-unicode-graphemes` es experimental (0.4.0 latest) y se anuncia "no estandar".

## 1. Pegados grandes (100 KB+)
- Problema: VS Code troceaba escrituras (WRITE_MAX_CHUNK_SIZE=50 chars, 5 ms) por corrupcion con textos grandes (https://github.com/microsoft/vscode/issues/38137). El troceo causaba reordenamientos: "los primeros 50 chars rotados al final" en Windows https://github.com/microsoft/vscode/issues/127699 [V].
- CONFIRMADO en codigo actual: `terminalProcess.ts` (microsoft/vscode main) ya NO trocea; `write()` llama `_ptyProcess.write(data)` directo. Se quito "throttle on pty input" el 12-dic-2025 (https://github.com/microsoft/vscode/issues/283056). La causa real era unix: node-pty escribia a pty no bloqueante y perdia bytes (limite ~1 KB macOS); arreglado en https://github.com/microsoft/node-pty/pull/831 (node-pty >=1.1.0, 22-dic-2025). En marzo 2026 VS Code anadio y revirtio chunking solo-macOS (#298993/#300933). Hoy: no hay chunking en Windows. [V]
- Windows/ConPTY: node-pty escribe via socket a named pipe (`windowsTerminal.ts` `_agent.inSocket.write`), sin limite documentado de truncado. Lento en pegados enormes: https://github.com/microsoft/terminal/issues/9232 (abierto).
- Mitigacion recomendada:
  1. Una sola `pty.write()` hasta ~64 KB; por encima, trocear en bloques de 16-32 KB SIN timers (cola FIFO propia, siguiente bloque cuando el anterior resuelve/`drain`) para no reordenar (leccion de #127699). Nunca `setTimeout` por trozo.
  2. Troceo respetando surrogates: no cortar entre high/low surrogate ni dentro de ESC[200~...ESC[201~ (enviar marcadores en bloques propios, en orden).
  3. Usar node-pty >=1.1.0 (o beta con conpty actual). Pegado >5 KiB: aviso de confirmacion (WT lo hace, `largePasteWarning`).
  4. Claude Code tiene su propio limite: mensajes >~50 000 chars se truncan en silencio https://github.com/anthropics/claude-code/issues/92118 ; avisar al usuario al superar ese tamano. [V issue]
- Flow control de salida: xterm.js `write(data, cb)` + ack (VS Code `AckDataBufferer`, FlowControlConstants.CharCountAckSize, pausa del pty por ack). Imprescindible si Claude vuelca mucho (Tabby tiene su `FlowControl`).

## 2. Bracketed paste
- xterm.js `paste()` = `prepareTextForTerminal` (`/\r?\n/g -> \r`) + `bracketTextForPaste` (envuelve con ESC[200~/201~ solo si DECSET 2004 activo y `ignoreBracketedPasteMode` != true) [V Clipboard.ts]. En modo bracketed, WezTerm NO convierte newlines (NewlineCanon::None) y elimina ESC[200~/201~ del texto (`send_paste`, term/src/terminalstate/mod.rs); WT filtra C0/C1 salvo HT/LF/CR (`Utils::FilterStringForPaste`) [V].
- Riesgo paste injection: con xterm 6.0.0, un portapapeles con `ESC[201~` + comandos sale del bracket. Mitigacion: antes de `term.paste()`, eliminar `\x1b`, `\x9b` y C0 (excepto \t \n \r) como WT; con 6.1 beta ya lo hace xterm para ESC.
- Claude Code pone `?2004h` (hay precedentes: https://github.com/anthropics/claude-code/issues/3134 lo deja activo al salir -> `00~...01~`). Resetear modos (?2004l ?1000l ?1006l ?9001l) al cerrar/reiniciar un PTY.
- ConPTY: conhost/ConPTY propaga el modo 2004 al terminal (el handler existe en `src/host/outputStream.cpp`, WT lo usa con pwsh) [V parcial; I que `?2004h` de Claude llega al xterm: probar].
- Con win32-input-mode (?9001) activo, TODO lo que envias (incluido ESC[200~ y el texto pegado) lo reinterpreta ConPTY como teclas; WT tiene bug abierto: https://github.com/microsoft/terminal/issues/17656 (DHowett: "bracketed paste como key events es esperado"). Mitigacion: no activar `win32InputMode` de xterm salvo necesidad (ver seccion 7) y probar paste con y sin el.
- Bug real en un wrapper de Claude Code: reemplazo manual de \n->\r fuera del flujo de xterm hacia que Claude enviara en la primera linea (Sterll/claude-terminal#63). Siempre usar `term.paste()`, nunca `pty.write(texto)`.

## 3. CRLF / Unicode
- Pegar: xterm convierte CRLF/LF -> CR. Claude Code (renderer fullscreen) tuvo bug de decodificar UTF-8 pegado como Latin-1 en Windows https://github.com/anthropics/claude-code/issues/65394 (cerrado) y `/copy` en Latin-1 #79482: no es tuyo, pero incluir caso de prueba (CJK, tildes, emoji).
- Asegurar UTF-8 extremo a extremo: node-pty `encoding: null`/utf8 y decodificar con `TextDecoder(stream:true)` para no partir multibyte entre chunks de salida.
- Ancho: por defecto xterm usa Unicode 6; cargar `@xterm/addon-unicode11` y `term.unicode.activeVersion='11'` (Tabby lo hace). Emoji ZWJ/banderas solo con unicode-graphemes (experimental; bug de banderas https://github.com/xtermjs/xterm.js/issues/6274 cerrado). Claude Code mide anchos por su cuenta (no verificado); riesgo de desalineacion en emoji ZWJ -> ofrecer ajuste y test visual. [I]
- Salida Windows: `selectionText` une con `\r\n` en Windows (`Browser.isWindows`) [V SelectionService.ts]. Decidir: ok para pegar en apps Windows.

## 4. Lineas envueltas / limpieza al copiar
- `getSelection()` une filas `isWrapped` sin salto y recorta espacios finales (`translateBufferLineToString(trimRight=true)`) [V]. Opcion `windowsPty:{backend:'conpty',buildNumber}`: con build >=21376 se usa el reflow de ConPTY; con menos, reflow desactivado y "linea envuelta si el ultimo char no es blanco"; ademas reserva scrollback al agrandar filas [V typings]. Pasar el buildNumber real (`os.release()`), `windowsMode` esta obsoleto. VS Code activa ademas `reflowCursorLine` solo con conpty.dll propio.
- Ink/Claude Code: dibuja con saltos de linea y posicionamiento propio; las lineas envueltas por la app NO quedan marcadas `isWrapped` => al copiar salen saltos duros + relleno + sangria de 2 espacios. Es el problema mas citado: meta-issue https://github.com/anthropics/claude-code/issues/81472 (42 issues), p.ej. #48037, #23014 (padding con espacios en vez de ESC[K), #37796 (indentacion). No se puede arreglar al 100% desde el emulador.
- Mitigaciones: (a) trimRight por linea (ya); (b) opcion "copiar limpio": quitar sangria comun, unir lineas de prosa (heuristica: linea previa de ancho = cols-k sin puntuacion final) - desactivable, con "Copiar tal cual" aparte; (c) rectangulo (Alt+arrastre) con trimBlockSelection como WT (default true); (d) atajo a `/copy` de Claude; (e) soportar OSC 52 escritura (xterm no lo trae; usar `addon-clipboard` o handler propio): ver Sterll/claude-terminal#71 (idea: ignorar lecturas `?`, limite 1 MB, escribir por IPC main).

## 5. Clic derecho y raton
- WT: clic derecho = copia si hay seleccion (sin re-copiar si ya copyOnSelect), si no pega; `copyOnSelect` default false; `trimPaste` true; `multiLinePasteWarning`/`largePasteWarning` true; menu contextual solo con `experimental.rightClickContextMenu` (ControlInteractivity.cpp) [V].
- xterm.js: su `contextmenu` handler mueve el textarea bajo el raton (para menu nativo) y no pega solo [V Clipboard.ts]. Implementar: `contextmenu` -> `preventDefault()`; si `term.hasSelection()` -> copiar + `clearSelection()`; si no -> pegar. `rightClickSelectsWord` solo por defecto en mac.
- Con mouse tracking activo (Claude fullscreen lo activa) xterm no selecciona; Shift+arrastrar fuerza seleccion (`shouldForceSelection` = shiftKey en Windows) [V]. Quejas: https://github.com/anthropics/claude-code/issues/66056 (clic derecho capturado), #104855 (pedido de copia con clic derecho). Mitigacion: si mouse tracking activo, clic derecho con seleccion de xterm -> copiar; sin seleccion -> pegar; no reenviar clic derecho a la app salvo que el usuario lo pida. Barra/boton "Copiar" y toggle "Shift automatico".
- Tabby (Eugeny/tabby): `rightClick: 'menu'|'clipboard'`, `copyOnSelect`, `warnOnMultilinePaste`, `trimWhitespaceOnPaste`, aviso desactivado en alternate screen (baseTerminalTab.component.ts); envia `\r\n -> \r` en Windows [V].

## 6. Ctrl+C / Ctrl+V / Alt+V / clipboard Electron
- Patron `attachCustomKeyEventHandler(ev)`: actuar solo en `ev.type==='keydown'` (xterm lo llama en keydown Y keypress [V CoreBrowserTerminal.ts]); devolver `false` para que xterm no envie nada.
  - Ctrl+C: si `hasSelection()` -> copiar, `clearSelection()`, `return false`; si no -> `return true` (SIGINT/0x03 va a la app). Ctrl+Shift+C: siempre copiar.
  - Ctrl+V / Ctrl+Shift+V: `ev.preventDefault()` + leer portapapeles (IPC main) + `term.paste(texto)` + `return false`. Sin `preventDefault`, el navegador dispara ademas el evento `paste` del textarea => doble pegado; si xterm procesa la tecla manda 0x16 (^V) pero cancela el evento. Elegir UNA via.
  - Ctrl+C con seleccion NO debe interrumpir una tarea en curso: es un cambio de comportamiento a documentar (WT igual).
- Alt+V (imagen en Claude Code Windows/WSL: `chat:imagePaste` = alt+v; Linux/mac ctrl+v): llega como ESC v (0x1b 0x76); NO interceptar Alt+V ni Alt+letra; Claude lee el portapapeles nativo con PowerShell (lento, bugs: #101444, #103062 "deja de funcionar", #90657). Patron de referencia (Sterll PR 67): si el portapapeles tiene imagen, enviar ESC v; si no, pegar texto. Ctrl+V de texto con imagen en portapapeles: decidir via `clipboard.availableFormats()` en main.
- Electron: `clipboard` desde renderer esta DEPRECADO (electron PR 48877); usar main + IPC (`ipcMain.handle('clip:read'/'clip:write')`, sin exponer lectura arbitraria a webviews). `navigator.clipboard.readText` exige foco/permiso (`setPermissionRequestHandler` 'clipboard-read') -> evitar. Electron actual 45.x.

## 7. win32-input-mode y teclas especiales
- ConPTY pide ?9001; xterm >=6.1 beta lo soporta tras opcion `win32InputMode` (formato `CSI Vk;Sc;Uc;Kd;Cs;Rc _`). Pendientes: Vk sale de `KeyboardEvent.code` (US-QWERTY): https://github.com/xtermjs/xterm.js/issues/6169 (teclado ES/AltGr -> ojo con `ñ`, `@`, `\`). VS Code lo expone como setting (`enableWin32InputMode`).
- Shift+Enter en Claude Code Windows NO funciona ni con ?9001: libuv/Bun descarta modificadores (https://github.com/anthropics/claude-code/issues/92771, abierto; medicion de un emulador xterm.js+ConPTY dice que 9001/kitty no ayudan). Workaround verificado en 10 TUIs: enviar `ESC CR` (\x1b\r) en Shift+Enter, con `"alt+enter":"chat:newline"` en keybindings.json (el `/terminal-setup` de Claude usa lo mismo). Ctrl+Enter llega como 0x0A.
- Shift+Tab (ESC[Z) y Alt+tecla (ESC+char) los gestiona xterm; probarlos con y sin 9001.

## 8. Referencia Claude Terminal (Sterll, GPL-3.0; solo ideas)
- Corrigio paste multilinea pasando por el camino de xterm en vez de reemplazo manual (#63); relays de Alt+V/Ctrl+V segun plataforma (PR 67); OSC 52 con politica de seguridad (PR 71); `claudeSignals.js` raspa el buffer (spinners braille, "Allow/Approve") para estado; heuristica fragil, no usarla para decidir que enviar.

## 9. Bateria de pruebas propuesta
1. Pegar 1 KB / 100 KB / 1 MB (ASCII, con \n y con \r\n), verificar byte a byte (hash) vs. lo recibido por un script eco en el PTY (`node -e` raw stdin) y en Claude Code (aviso >50k).
2. Pegado con bracketed ON/OFF: markers presentes solo si ON; multilinea no envia en la 1a linea.
3. Payload `hola\x1b[201~; calc` y `\x1b]52;c;...` y C1 (\u009b): no debe salir del bracket ni ejecutar nada.
4. Unicode: `ñ á ü`, `😀`, `👨‍👩‍👧`, `🇪🇸`, CJK, combinantes; en pegado grande con corte en frontera de surrogate; ancho de cursor correcto (unicode11 vs graphemes).
5. Copiar: linea envuelta por xterm (shell), linea envuelta por Ink (Claude), bloque de codigo con sangria, rectangulo; sin espacios finales; CRLF final.
6. Ctrl+C con seleccion copia y no manda 0x03; sin seleccion manda 0x03 (una sola vez); Ctrl+Shift+C; Ctrl+V pega una sola vez; Ctrl+Shift+V.
7. Clic derecho: seleccion -> copia; sin seleccion -> pega; sin menu; con mouse tracking activo (Claude fullscreen) y con Shift.
8. Alt+V con imagen en el portapapeles llega ESC v a Claude y se adjunta; Alt+V sin imagen; Shift+Enter -> ESC CR inserta salto.
9. Con y sin `win32InputMode`: Shift+Tab, Alt+b/f, Ctrl+Enter, teclas con teclado ES (ñ, @, \, AltGr).
10. Salir de Claude (o kill) y comprobar que el siguiente shell no hereda ?2004/?1000/?9001 (sin `00~`).
11. Redimensionar durante salida de Claude y copiar: no hay duplicados ni huecos (`windowsPty` con buildNumber real).
12. Pegar con la app ocupada emitiendo mucho output (flow control): el pegado no se pierde ni reordena.
