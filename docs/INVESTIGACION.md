# Investigación (consolidado)

Fecha: 2026-11-02. Informes completos, con fuentes, en `docs/investigacion/`:

| Informe | Tema |
|---|---|
| [R1](investigacion/R1-stack-ram.md) | Stack y RAM |
| [R2](investigacion/R2-senales-claude.md) | Señales reales de Claude Code 2.1.316 (grabaciones en `investigacion/fixtures/`) |
| [R3](investigacion/R3-copiar-pegar.md) | Copiar y pegar en Windows |
| [R4](investigacion/R4-atajos.md) | Atajos de Claude Code y de terminales |
| [R5](investigacion/R5-ux.md) | Referencias de UX |
| [R6](investigacion/R6-medir-ram.md) | Cómo medir la RAM |

## R1. Stack
- node-pty 1.1.0 trae binarios para win32-x64 y no compila C++ (verificado instalándolo). Incluye `conpty.dll` y `OpenConsole.exe` 1.23.
- `useConptyDll: true` deja pasar OSC y BEL literales y en orden. El ConPTY del sistema normaliza títulos y agrega repintados.
- En Windows, Tauri usa WebView2, que también es Chromium. Los datos públicos muestran ventaja nula o pequeña (issue tauri#5889). Hay que medirlo.
- xterm.js 6 ya no tiene renderer canvas: solo DOM o WebGL. Hay un límite de unos 16 contextos WebGL por página.
- El control WPF de Windows Terminal, libghostty y wezterm no son embebibles hoy.

## R2. Señales de Claude Code (lo más importante)
**El título es la señal.** Hipótesis corregidas:

| Hipótesis del brief | Realidad |
|---|---|
| Spinner braille | **Falso.** `◐ ◑` (U+25D0, U+25D1) alternan cada 961 ms por OSC 0 |
| `✳` cuando está listo | Cierto, pero también aparece **mientras espera** un permiso o una pregunta |
| OSC 9;4 | Solo con ConEmu, ghostty ≥ 1.2 o iTerm ≥ 3.6.6. `WT_SESSION` lo apaga |
| Campana al terminar | **Falso.** Solo en eventos Notification, y según `preferredNotifChannel` |

Interpretación: el "favicon" gris y verde de Windows Terminal es el propio título. `◐` se ve como un glifo gris y `✳` se pinta verde con Segoe UI Emoji. No es un ícono que Claude Code mande aparte (inferencia, compatible con todas las grabaciones).

Detección de cada estado:
- **Trabajando:** glifo `◐/◑` en el título. No sirve medir el ritmo: sin foco el título se congela.
- **Listo:** `✳` y no esperando. El título espera a que terminen **todos** los hooks Stop; con los hooks globales de esta máquina se atrasa 6 s respecto del hook Stop.
- **Esperando:** hook `PermissionRequest` al instante, o `status: waiting` en `~/.claude/sessions/<pid>.json`. `Notification` llega 6 s tarde.
- **Salir de esperando con Esc:** no hay hook ni cambio de título. Solo lo refleja el session file.
- **Muerto:** solo `pty.onExit`.

Flags:
- `--session-id` conserva el ID. Si se repite: `Session ID <uuid> is already in use`, exit 1.
- `--resume` conserva ID y transcript. No tiene bloqueo: abre un segundo proceso si la sesión está viva.
- `--name` existe y no rompe la detección (`✳ x`, `◐ x`).
- `--effort` acepta low, medium, high, xhigh y max. Un valor inválido se ignora en silencio.
- Los hooks de `--settings` se suman a los globales.

Otros:
- El diálogo de confianza: Enter elige "No, exit".
- Sin alt-screen ni mouse. Activa `?2004h`, `?2031h` y `?1004h`.
- Con `WT_SESSION`, Claude activa además `?2026` y el teclado kitty.
- El backend `dll` necesita que el emulador responda a `CSI c`; si no, hay unos 3 s de retraso.
- Tras salir, `?1004h` y `?9001h` siguen activos.

## R3. Copiar y pegar
- Pegar siempre con `term.paste()`, nunca `pty.write` a mano.
- Filtrar C0/C1 salvo tab, LF y CR antes de pegar (xterm 6.0.0 no sanea `ESC[201~`).
- VS Code ya no trocea en Windows (quitado en dic-2025). Hacer una sola escritura hasta 64 KB y, por encima, una cola FIFO sin timers que no corte surrogates.
- Claude Code trunca en silencio los mensajes de más de ~50.000 caracteres (claude-code#92118): vale avisar.
- Las líneas envueltas por Ink no quedan marcadas `isWrapped`, y no hay arreglo completo desde el emulador (claude-code#81472).
- Ctrl+V con `preventDefault` para no pegar dos veces. Actuar solo en `keydown`.
- `clipboard` desde el renderer está deprecado: usar main e IPC.
- Shift+Enter no llega con modificador en Windows (claude-code#92771).

## R4. Atajos
Claude Code no usa Ctrl+1..9, Ctrl+Tab, F2, F11, Ctrl+`,` ni Ctrl+Shift+letra (salvo Ctrl+Shift+C). Sí usa Ctrl+K y Ctrl+P, por eso el selector rápido va en **Ctrl+Shift+K**. Mapa completo en R4.

## R5. UX
- Barra lateral = triaje: lista completa. Pestañas = solo lo abierto.
- Filas de 28 px, cabecera de 24 px, barra de 240 px.
- Estado = forma + color + texto. Solo "trabajando" se anima.
- Prioridad de atención: esperando > error > no leído > trabajando > dormida.
- No leído se limpia al enfocar la sesión, no al pasar el ratón.
- Referencias más útiles: Warp (vertical tabs) y cmux.

## R6. Medición
Métrica principal: **Private Working Set**, el mismo número que muestra el Administrador de tareas. Sumar Working Set sobrecuenta en Chromium. Árbol de procesos por `ParentProcessId`, con WT medido en `wt -w new` por delta, porque el usuario tiene WT abierto. Script: `docs/investigacion/tools/medir-ram.ps1`.

## Incidente durante la investigación
En la prueba de Alt+V de R2, Claude tomó el **texto** del portapapeles del usuario (sin imagen) y el guion lo envió a Haiku. Queda en el transcript `59b42861-7925-4215-ab7f-08dfd9f1e6df.jsonl`. Consecuencias aplicadas:
1. Ningún test manda Enter después de Alt+V.
2. Los tests usan un portapapeles en memoria, y las pocas pruebas con el portapapeles real lo guardan y lo restauran.
