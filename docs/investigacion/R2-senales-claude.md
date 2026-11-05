# R2 - Señales reales de Claude Code 2.1.316 en un pty propio (Windows)

Fecha: 2026-11-02. Máquina: Windows 11 Pro 10.0.26200. Harness: node-pty 1.1.0 (prebuilds win32-x64, no compiló), `@xterm/headless` para pantalla y respuestas a queries, cols 120, rows 30, `TERM=xterm-256color`. Modelo: `--model haiku --effort low`.

Herramientas: `docs/investigacion/tools/record.js`, `analyze.js`, `probe.js`. Salida completa de `claude --help`: `docs/investigacion/claude-2.1.316-help.txt`. Grabaciones: `docs/investigacion/fixtures/`.

Niveles de evidencia usados abajo:
- **[E]** observado en grabación.
- **[S]** leído en el JS embebido en `claude.exe` (análisis estático con `scanbin.js`, minificado; los nombres de función pueden cambiar en cada versión).
- **[I]** inferencia sin observación directa.

## 0. Incidente que hay que conocer

En el escenario 9 envié `ESC v` (Alt+V) tras comprobar que el portapapeles no tenía imagen, esperando solo un aviso. Claude insertó el **texto** del portapapeles del usuario como `[Pasted text #2 +198 lines]`, y el paso siguiente del guion hizo Enter: **ese texto se envió a Haiku** y quedó en el transcript de la sesión `59b42861-7925-4215-ab7f-08dfd9f1e6df.jsonl`.

- Por las primeras líneas parece el brief de este mismo proyecto, pero no lo verifiqué más para no leerlo.
- Redacté la grabación local (`scrub-s9.js`) y no la incluí en fixtures.
- **No borré el transcript** porque la instrucción fue no borrar sesiones. El usuario decide si lo elimina.

## 1. Calibración: lo que ConPTY deja pasar (crítico para interpretar todo lo demás)

`probe.js` emite secuencias conocidas con marcadores. node-pty ofrece dos backends y se comportan de forma muy distinta.

| Secuencia emitida por la app | `system` (conhost del SO, default de node-pty) | `dll` (`useConptyDll:true`, OpenConsole incluido en node-pty) |
|---|---|---|
| OSC 0 / 1 / 2 | Se **normalizan a `OSC 0 ... BEL`** | Literal, terminador original |
| OSC 7, 9, 9;4, 133, 633, 777, 1337, 99 | Pasan (pueden adelantarse al texto del mismo frame) | Literal y en orden |
| OSC 8 | Pasa, conhost añade `id=` si falta | Literal |
| BEL suelto | Pasa | Pasa |
| `?1004h` / `?1004l` | Pasa `h`; **`l` se traga** | `?1004l` sale como `?1004l ?1004h` (OpenConsole lo reafirma) |
| `?9001h` / `?9001l` | Se tragan | `?9001l` sale como `?9001l ?9001h` |
| `?2004`, `?1049`, `?25`, `?2026`, `?1000-1006`, `?2031`, `?2027` | Pasan (1049 con repintado completo) | Literal |
| kitty `CSI >1u`, `?u`, `<u`, `=1;1u`, `CSI >4;2m`, XTVERSION | Pasan | Literal |
| DA1, DA2, DSR 6n, DECRQM | **Las responde conhost**, no llegan al terminal (`?2026` responde `0$y`: no soportado) | Llegan al terminal; responde el emulador |
| `OSC 10;?` | Se traga, sin respuesta visible | Llega al terminal |
| DCS, APC | Se tragan | Literal |
| Propio del backend al arrancar | `CSI ?9001h ?1004h`, luego `?25l 2J H` y título con ruta del exe si la app no fija uno | `CSI 1t`, `CSI c`, `?1004h ?9001h` |
| Bytes renderizado | Re-render con CUP absolutos | Bytes reales de Claude (CUU/CUD/CHA relativos) |

**Trampa del backend `dll`:** OpenConsole espera respuesta a `CSI c`. Sin respuesta todo va unos **3 s tarde** (el mismo guion de calibración terminó a 6,8 s frente a 3,9 s con respuesta). Hay que conectar `term.onData -> pty.write`.

Entrada hacia la app, registrada en stdin raw (ambos backends):

| Escrito al pty | Recibe la app |
|---|---|
| `ESC v` | `ESC v` |
| `ESC[200~a\nb ESC[201~` | Idéntico (intacto) |
| `\r`, `\x03`, `ESC[A`, texto | Idéntico |
| `ESC[I` / `ESC[O` | Nada en stdin: conhost lo consume como evento de foco (Claude sí reacciona, ver 2.3) |
| `ESC[86;47;118;1;2;1_` (win32-input-mode) | `ESC v` |

## 2. Escenarios

### 2.1 Arranque (fixtures `arranque.jsonl`, `trabajando-y-listo-dll.jsonl`)

Tiempos típicos desde spawn (6 sesiones): primer byte 72-79 ms, `OSC 0;claude` a 283-311 ms, `✳ Claude Code` a 860-1116 ms, TUI visible a 900-1200 ms, session file a 830-1490 ms. Idle: **0 bytes/s** durante 59 s medidos.

Bytes exactos (backend `dll`, sin SGR):

```
72    CSI 1t  CSI c  CSI ?1004h  CSI ?9001h            <- OpenConsole
295   OSC 0;claude ST
931   ESC 7  CSI r  ESC 8  CSI ?25h
1076  CSI ?25l  CSI ?2004h  CSI ?2031h  CSI ?1004h
1077  CSI ?9001l CSI ?9001h
1077  OSC 0;✳ Claude Code ST
1142  (primer frame)
1499  CSI >0q  CSI ?u  OSC 7501;? BEL  CSI c           <- sondeo de capacidades
```

- Sin alt-screen (`?1049` nunca) ni mouse (`?1000-1006` solo `l` al salir). `?2026` y kitty dependen del entorno, ver 2.2.
- `OSC 7501;?`: consulta sin respuesta en esta prueba; no identifiqué su destinatario.
- RAM: `claude.exe` 203-277 MB, sin procesos hijos con `--strict-mcp-config`.

**Diálogo de confianza** (primer arranque en `r2\cwd`), visible a unos 800 ms:

```
Accessing workspace: <ruta>
Quick safety check: Is this a project you created or one you trust? ...
❯ No, exit
  Yes, I trust this folder
Enter to confirm · Esc to cancel
```

- **Enter a secas elige `No, exit`: sale con código 1.** La indicación de "enviar Enter" no sirve; hay que enviar `ESC[B` y luego `\r`.
- Una flecha enviada a 100 ms de aparecer el diálogo se ignoró [E]; a 2,5 s funcionó. La causa no está determinada. Conviene esperar más de 1 s o verificar que `❯` se movió antes de Enter.
- Aceptarlo hace que el propio Claude guarde la confianza en `~/.claude.json`. Yo no toqué el archivo, pero esa entrada de `r2\cwd` queda ahí.
- Título durante el diálogo: `claude`. El session file no existe todavía.

### 2.2 Trabajando (fixtures `trabajando-y-listo*.jsonl`)

**Hipótesis de braille refutada.** El código [S]: `LZ=["\u25D0","\u25D1"], BZ="\u2733", dbt=960`.

| Estado | Título | Secuencia |
|---|---|---|
| Arranque antes de TUI | `claude` | OSC 0 |
| Listo sin conversación | `✳ Claude Code` | OSC 0 |
| Trabajando | `◐ <t>` y `◑ <t>` alternando cada **961 ms** | OSC 0 (U+25D0 / U+25D1) |
| Listo | `✳ <t>` | OSC 0 (U+2733) |
| Esperando permiso o pregunta | `✳ <t>` (**idéntico a listo**) | OSC 0 |

- Claude emite **OSC 0 con terminador ST**; por el backend `system` llega con BEL.
- `<t>`: `Claude Code` hasta que Haiku genera un título, unos **800-930 ms tras el Enter**, en el idioma del prompt (`Respuesta OK`, `Crear archivo x.txt`).
- La línea de spinner en pantalla usa otros glifos (`· ✢ * ✶ ✻ ✽`) a 8-11 chunks/s. No sirve como señal de título.

Modos y teclado según entorno [E]:

| Entorno | `?2026` | `CSI <u CSI >5u` + `CSI >4;2m` | OSC 9;4 |
|---|---|---|---|
| Sin variables (`TERM` solo) | No | No | No |
| `WT_SESSION=<guid>` (s5, junto con `ConEmuPID=1`) | Sí | **Sí** | No |
| `TERM_PROGRAM=ghostty`, versión 1.2.0 | Sí | **Sí** | Sí |
| `ConEmuPID=1` | No | No | Sí |

**OSC 9;4.** Función de puerta [S]:

```js
function agt(){ ...; if(!process.stdout.isTTY)return!1; if(i.WT_SESSION)return!1;
  if(i.ConEmuANSI||i.ConEmuPID||i.ConEmuTask)return!0;
  let n=coerce(i.TERM_PROGRAM_VERSION); if(!n)return!1;
  if(TERM_PROGRAM==="ghostty")return n>=1.2.0; if(TERM_PROGRAM==="iTerm.app")return n>=3.6.6; return!1}
```

| Prueba | Resultado [E] |
|---|---|
| Sin variables | Ninguna OSC 9;4 |
| `ConEmuPID=1` (s4) | `OSC 9;4;3; BEL` en el mismo instante que `◐`; `OSC 9;4;0; BEL` en el mismo instante que `✳` |
| `WT_SESSION` + `ConEmuPID=1` (s5) | **Ninguna**: `WT_SESSION` gana a todo |
| `ConEmuPID=1` + `--settings {"terminalProgressBarEnabled":false}` (s6) | Sin `9;4;3`; solo un `9;4;0` final. **El setting funciona por `--settings`** |
| `TERM_PROGRAM=ghostty` 1.2.0, backend `system` (s7) | Igual que ConEmu. **Sí pasa por ConPTY** |

Solo se emiten 3 (indeterminado) y 0 (limpiar), sin porcentaje. `9;4;3` **sigue activo durante la espera de permiso**: marca turno en curso, no trabajo.

### 2.3 Foco: la frecuencia del título no es fiable

Con `ESC[O` durante el trabajo (s4), el título queda fijo en `◑` 5229 ms y retoma tras `ESC[I` [E]. El código `Fa(cb, ...||!Ee?null:960)` pausa el intervalo si el terminal no tiene foco [S]. El glifo sigue indicando trabajo, pero **un detector por "cambió hace menos de X s" da falso listo en pestañas de fondo**. Un emulador con varias pestañas enviará `ESC[O` a las inactivas si reenvía foco.

### 2.4 Terminó (fixtures `trabajando-y-listo*.jsonl`)

Latencias en ms desde spawn. Hook = inicio del proceso del hook; escribe unos 25 ms después. Session file sondeado cada 100 ms.

| Sesión | Enter | `◐` | Hook UserPromptSubmit | `busy` | Hook Stop | `✳` | `idle` |
|---|---|---|---|---|---|---|---|
| s5 dll | ~4730 | 4790 | 4844 | 4861 | 6691 | 6744 | 6807 |
| s6 dll | ~4730 | 4782 | 4832 | 4852 | 6211 | 6265 | 6374 |
| s8 system | ~4950 | 5003 | 5055 | 5056 | 6622 | 6674 | 6716 |
| s4 dll (Stop extra 7 s) | 4733 | 4786 | 4836 | 4857 | 5845 | **12906** | 13003 |
| s3 system (hooks globales) | 5542 | 5601 | 5650 | 5714 | 7557 | **13521** | 13541 |

- Sin hooks lentos, el hook Stop arranca unos **53 ms antes** que `✳`. `◐` sale unos 55 ms tras el Enter, 50 ms antes que UserPromptSubmit.
- **`✳`, `idle` y `9;4;0` esperan a que acaben todos los hooks Stop.** En s3 el Stop global tardó 6021 ms y el título siguió en `◐/◑` ese tiempo con la respuesta ya en pantalla. Con los hooks globales de esta máquina, "listo" se retrasa 6 s respecto al hook Stop.
- **No hay BEL, OSC 9 ni OSC 777 al terminar un turno.** Las notificaciones de canal solo salen con eventos Notification.
- `preferredNotifChannel` por `--settings` funciona. En `auto` sin terminal reconocido no emite nada [S]:

| Canal | Bytes observados | Disparo |
|---|---|---|
| `terminal_bell` (s3) | `BEL` | [E] Notification |
| `iterm2_with_bell` (s11) | `OSC 9;Claude needs your permission BEL` + `BEL` | [E] |
| `auto` + `TERM_PROGRAM=ghostty` (s7) | `OSC 777;notify;Claude Code;Claude needs your permission BEL` | [E] |
| `kitty`, `iterm2` | No probados [S: existen] | |
| `auto` con `WT_SESSION` o sin nada | Ninguno: `no_method_available` | [S] |

Valores válidos [S]: `auto, iterm2, terminal_bell, iterm2_with_bell, kitty, ghostty, notifications_disabled`.

### 2.5 Esperando entrada (fixtures `permiso.jsonl`, `pregunta.jsonl`)

Con `--permission-mode manual`. `default` no aparece en la ayuda pero se acepta y muestra "manual mode". Se canceló con Esc; `x.txt` no se creó.

| Señal | Permiso, s7 | Permiso, s11 | AskUserQuestion, s7 |
|---|---|---|---|
| Título `✳` | 9131 | 7332 | 24247 |
| Session file `status:"waiting"` + `waitingFor` | 9154 `permission prompt` | 7369 `permission prompt` | 24294 **`input needed`** |
| Hook PreToolUse (`tool_name`) | 9046 `Write` | 7238 `Write` | 24180 `AskUserQuestion` |
| Hook PermissionRequest | 9204 | 7403 | 24287 |
| Hook Notification `permission_prompt` | **15206 (+6,0 s)** | **13400 (+6,0 s)** | **30308 (+6,0 s)** |
| Canal de notificación | OSC 777 15239 | OSC 9 + BEL 13440 | OSC 777 30341 |

- El retardo de 6 s de Notification no depende de la entrada: en s11 el Esc llegó a 17458, después. Por tanto [I]: si el usuario responde antes de 6 s no habrá Notification.
- `AskUserQuestion` también dispara PermissionRequest y Notification `permission_prompt`, con el mismo texto "Claude needs your permission". Para distinguirlos: `tool_name` o `waitingFor`.
- Otros valores de `waitingFor` [S]: `dialog open`, `worker request`, `sandbox request`.
- Tras Esc: `idle` en unos 150 ms y `9;4;0`. **No se dispara Stop ni ningún otro hook** (s7 y s11). El título tampoco cambia: pasa de `✳` a `✳`.

Tabla de estado con solo VT, posible únicamente con OSC 9;4 activo:

| Título | OSC 9;4 | Estado |
|---|---|---|
| `◐/◑` | 3 | Trabajando |
| `✳` | 3 | Esperando |
| `✳` | 0 | Listo |

Observado con `TERM_PROGRAM=ghostty` (s7). Con `ConEmuPID` la espera no se observó, pero comparte puerta [I]. Coste: ghostty además activa kitty, `?2026` y OSC 777; `ConEmuPID` no activó nada de eso en s4, aunque otros efectos no están descartados.

### 2.6 Salida (fixtures `salida.jsonl`, `salida-ctrlc.jsonl`, `salida-taskkill.jsonl`)

| Cómo | Exit code | Enter/kill -> onExit | SessionEnd (`reason`) | Último título | Session file |
|---|---|---|---|---|---|
| `/exit` | 0 | 1,6 s system; 0,6 s dll | `prompt_input_exit` | **`✳ <t>` tras un `''`** (sin turnos previos: `''`) | Se borra |
| Ctrl+C × 2 | 0 | 1,7 s system | `prompt_input_exit` | `''` | Se borra |
| Diálogo de confianza "No, exit" | 1 | | No hubo sesión | `''` | No existía |
| `pty.kill()` system | 1 | 112 ms | `other`, sí corre | `''` | Se borra |
| `pty.kill()` dll | 1 | 71 ms | **No corre** | Sin bytes finales | **Queda stale** |
| `taskkill /F` | 1 | | **No corre** | Sin bytes finales | **Queda stale** |
| Error de flags | 1 | 1,7-2,9 s | | | |

- **Ctrl+C:** "Press Ctrl-C again to exit" dura **791 ms**. A 878 ms se trató como primera pulsación y no salió; a 250-300 ms sí.
- **Última secuencia `/exit`, backend `dll`:**
  ```
  OSC 0;◑ <t> ST      <- destello: /exit cuenta como turno
  CSI ?1006l ?1003l ?1002l ?1000l
  CSI >4m  CSI ?2031l  CSI ?2004l  ESC ( B  SI  CSI ?1016l  (mouse otra vez)  CSI ?25h  ESC 7 CSI r ESC 8
  OSC 0; ST
  \r\nResume this session with:\r\nclaude --resume <uuid>\r\n
  OSC 0;✳ <t> ST      <- 30 ms después del título vacío
  ```
  En sesiones con kitty añade `CSI <u`.
- **Modos no restaurados:** `?1004h` y `?9001h` siguen activos por ConPTY. El emulador debe resetearlos al morir el proceso.
- **Muerto:** ninguna señal VT es fiable. `✳` puede ser lo último emitido y el proceso tarda hasta 1,7 s en salir. Solo `onExit`.
- Los session files stale desaparecieron cuando otra sesión arrancó después (`11428.json` y `45380.json` ya no estaban). Lo atribuyo a un barrido al iniciar [I].

### 2.7 Flags

| Flag | Resultado [E] |
|---|---|
| `--session-id <uuid>` | Se conserva: nombre del transcript, `session_id` de hooks y session file |
| Transcript | `~/.claude/projects/<cwd con cada no alfanumérico -> ->/<uuid>.jsonl` |
| Repetir uuid (ya terminada o viva) | `Error: Session ID <uuid> is already in use.` exit 1 |
| UUID inválido | `Error: Invalid session ID. Must be a valid UUID.` exit 1 |
| `--resume <id>` | **Conserva id**, añade al mismo `.jsonl`, SessionStart `source:"resume"`, título guardado (`✳ Crear archivo x.txt`) desde unos 1050 ms |
| `--resume <nombre>` | Funciona. **El session file muestra un id temporal unos 300 ms** (`def31e9a...`) y luego el real |
| `--resume` inexistente | `No conversation found with session ID: <uuid>` exit 1, 2,9 s |
| `--resume` de sesión viva | **Sin bloqueo:** abre un segundo proceso con el mismo id |
| `--resume A --session-id B` | `Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.` |
| `--name x` / `-n` | Existe. Título `✳ x`, `◐ x`: **el prefijo se mantiene y no rompe la detección por glifo**. Sustituye al título automático, persiste al reanudar |
| `--model` | Alias (`haiku`, `opus`, `sonnet`, `fable`) o nombre completo. Inválido con `-p`: error y exit 1. Sin `-p` no probado |
| `--effort` | `low, medium, high, xhigh, max`. **Inválido (`ultra`) se ignora en silencio**, muestra medium |
| `--permission-mode` | Ayuda: `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan` |
| Otros relevantes | `--setting-sources`, `--strict-mcp-config`, `--fork-session`, `--bare` (sin hooks ni OAuth) |
| `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` | Sin OSC de Claude; solo el título de conhost con la ruta del exe. **Mata la detección por título** |

### 2.8 Hooks con `--settings` (s3 a s12)

- **Dispararon** 7 de los 10 configurados: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, Notification, Stop, SessionEnd. PostToolUse, SubagentStop y StopFailure no se dieron en estas pruebas (ninguna herramienta llegó a ejecutarse).
- **Se suman, no reemplazan** [E, s3]: el debug log muestra para Stop tres comandos: el mío y los dos globales.
- Con `--setting-sources project,local` los globales no corren y `--settings` sí: es la forma de aislar.

Campos de stdin (solo nombres). Todos llevan `session_id, transcript_path, cwd, scratchpad_dir, hook_event_name`:

| Evento | Campos adicionales |
|---|---|
| SessionStart | `source` (`startup`, `resume`), `model` |
| UserPromptSubmit | `prompt_id, permission_mode, prompt` |
| PreToolUse | `prompt_id, permission_mode, effort, tool_name, tool_input, tool_use_id` |
| PermissionRequest | `prompt_id, permission_mode, effort, tool_name, tool_input`, `permission_suggestions` (solo Write) |
| Notification | `prompt_id, message, notification_type` (`permission_prompt`, `idle_prompt`) |
| Stop | `prompt_id, permission_mode, effort, stop_hook_active, last_assistant_message, background_tasks, session_crons` |
| SessionEnd | `prompt_id, reason` (`prompt_input_exit`, `other`) |

- Latencia del hook: Node arranca y escribe en unos 25 ms; el debug log da 121 ms de duración total al hook Stop.
- `idle_prompt` llega **60,07 s** tras `✳` (s3). Tras él, el BEL salió 4,1 s más tarde porque la notificación espera al hook Notification global [I].

**Mejor señal de "esperando input":** PermissionRequest al instante, confirmada por `waitingFor` del session file. **No** Notification: tiene 6 s de retardo, y `idle_prompt` no significa bloqueo.

### 2.9 Session file: señal no documentada, la más precisa

`~/.claude/sessions/<pid>.json` [E]: `pid, sessionId, cwd, startedAt, procStart, version, kind, entrypoint, name, nameSource, status, waitingFor, updatedAt, statusUpdatedAt, messagingSocketPath...`

- `status` = `busy | idle | waiting`. Es el único que distingue idle de waiting sin configuración y refleja el fin tras Esc.
- **Interno y sin contrato**: puede cambiar en cualquier versión.
- Junto a él hay un `<pid>.<hash>.key` que **no debe leerse**. Usar solo el `.json`.
- Tras `taskkill` o `pty.kill` en dll queda stale: validar por pid vivo y `procStart`.

### 2.10 Pegado de imagen

- Atajo [S]: `h = windows||wsl ? "alt+v" : "ctrl+v"`, enlazado a `chat:imagePaste`. **Confirmado Alt+V en Windows.** Ctrl+V no está enlazado en Windows.
- Bytes: `ESC v` llega como `ESC v` en ambos backends [E].
- **Claude lee el portapapeles por su cuenta**, no pasa por el terminal [E]: sin imagen pero con texto, Alt+V insertó el texto como `[Pasted text #2 +198 lines]`, sin ningún byte de pegado desde el pty. El binario contiene `Get-Clipboard -Raw` y `Set-Clipboard` [S].
- **Pegado con imagen real: no probado**, por las reglas. Sigue pendiente, igual que el mecanismo exacto de lectura de imagen.

### 2.11 Bracketed paste

Claude activa `?2004h` a unos 800-1090 ms y lo reafirma al recibir input tras unos segundos de inactividad. Lo desactiva al salir.

| Entrada | Resultado [E] |
|---|---|
| `ESC[200~` + 3 líneas + `ESC[201~` | Multilínea en el prompt, sin enviar |
| `ESC[200~` + 12 líneas + `ESC[201~` | `[Pasted text #1 +11 lines]`, sin enviar |
| `alfa\nbeta` sin marcadores | Multilínea, sin enviar (LF no es Enter) |
| Pegado y `\r` aparte | Se envía normal |

## 3. Hipótesis

| Hipótesis | Veredicto |
|---|---|
| Spinner braille U+2801-U+28FF en el título | **Refutada**: `◐ ◑` (U+25D0, U+25D1) |
| `✳` U+2733 al terminar | **Confirmada**, pero también en arranque y **en espera** |
| Título por OSC 0 | **Confirmada**; ST real, BEL tras conhost |
| Frecuencia de cambio utilizable | **Refutada**: 961 ms, pero se detiene sin foco |
| OSC 9;4 se emite siempre | **Refutada**: solo ConEmu*, ghostty >= 1.2.0, iTerm >= 3.6.6 |
| OSC 9;4 se emite en Windows Terminal | **Refutada**: `WT_SESSION` lo bloquea explícitamente |
| OSC 9;4 pasa por ConPTY | **Confirmada** en ambos backends |
| `terminalProgressBarEnabled` vale por `--settings` | **Confirmada** |
| BEL / OSC 9 / OSC 777 al terminar turno | **Refutada**: solo en Notification y según canal |
| `preferredNotifChannel` vale por `--settings` | **Confirmada** |
| `--session-id` conserva id y falla al repetir | **Confirmada** |
| `--resume` crea id nuevo | **Refutada**: conserva id |
| `--name` rompe detección por spinner | **Refutada** |
| Hooks de `--settings` se suman | **Confirmada** |
| Notification es buena señal de espera | **Refutada** como primaria: +6 s |
| Enter resuelve el diálogo de confianza | **Refutada**: elige "No, exit" |
| Alt+V pega imagen en Windows | **Atajo confirmado**, imagen real no probada; también pega texto |

## 4. Recomendación de detección

| Estado | Señal primaria | Respaldo | No usar |
|---|---|---|---|
| **Trabajando** | Primer glifo del título en `◐ ◑` | UserPromptSubmit, `status:busy` | Ritmo de cambio del título (foco); añadir braille al regex como tolerancia futura |
| **Listo** | Título `✳` **y** no esperando | `status:idle`; `9;4;0` si está activo | Solo hook Stop: no salta tras Esc y va antes de terminar los hooks |
| **Esperando** | Hook PermissionRequest (`tool_name`), o `status:waiting` + `waitingFor` | PreToolUse `AskUserQuestion`; `✳`+`9;4;3` | Título solo; Notification como señal inicial |
| **Muerto** | `pty.onExit` | Pid vivo | Título (último puede ser `✳`), SessionEnd (no corre en kill duro), session file (stale) |

- **Salir de "esperando":** el título vuelve a `◐` al aprobar [I], pero **tras un Esc no hay señal de hook ni de título**. Solo `status:idle` o `9;4;0`. Si no se usa ninguno, habrá que reconocer `Do you want` en pantalla o el Esc enviado por el propio gestor.
- **Combinación sugerida:** título para trabajando/listo; `--settings` con hooks para waiting e identidad (`session_id`); session file como refuerzo opcional con fallo tolerante.
- **Backend:** usar `dll` y conectar `term.onData -> pty.write` para recibir los bytes reales. Con `system` todo funciona, pero con títulos normalizados y queries contestadas por conhost.
- **No fijar `WT_SESSION`** en el entorno hijo: apaga OSC 9;4 y activa kitty. Quitarlo también si el gestor corre dentro de Windows Terminal. Lo mismo con `TERM_PROGRAM` si se hereda.
- Valorar `ConEmuPID=1` como truco para obtener OSC 9;4. Depende de una puerta interna, así que debe tratarse como optimización y no como requisito. Verificar la espera bajo `ConEmuPID` antes de apoyarse en ella.
- **Usuario con `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`:** el título no aporta; hace falta fallback con hooks.

## 5. No probado

- Aprobar un permiso (por instrucción) y sus transiciones posteriores.
- Pegado con imagen real.
- Qué activa Claude si el emulador responde a XTVERSION o `CSI ?u`.
- Canales `kitty` e `iterm2` por separado; `TERM_PROGRAM=iTerm.app`; ConEmu en espera.
- Trabajo largo con herramientas reales, subagentes o `OSC 133`/`633` (no aparecieron en ninguna grabación).
- `--model` inválido en modo interactivo.

## 6. Efectos colaterales en la máquina

- **Portapapeles enviado al modelo**: ver sección 0.
- Las sesiones s1, s1b, s2 y s3 usaron los ajustes de usuario. Por tanto los hooks globales corrieron en esos turnos, incluido un Stop que reproduce un sonido de unos 6 s (2 veces). Desde s4 usé `--setting-sources project,local`.
- `rec/s3-debug.log` (scratchpad) contiene las rutas y comandos de hooks globales. Los vi al buscar el recuento; aquí solo se citan por su efecto.
- `~/.claude.json`: Claude añadió la confianza de `r2\cwd`. Yo no lo edité. No se tocó `settings.json` ni credenciales; `~/.claude/sessions/` se listó por nombre y solo se leyó el `.json` de mis PID.
- Consumo: 10 prompts a Haiku en 9 sesiones (s2-s9, s11). Además, 6 arranques sin prompt (s1, s1b × 2, s10, s12a, s12b), 2 comprobaciones de id en uso dentro de s9 y 7 lanzamientos de error de flags (s8b). Las sesiones con API cumplen el máximo de 8-10; contando todos los lanzamientos se supera.
- De `~/.claude/settings.json` solo leí las claves de eventos de hooks y la presencia de `terminalProgressBarEnabled` y `preferredNotifChannel`.
- Todos los procesos lanzados terminaron: comprobado por PID (`pids.log`) sin coincidencias. No se usó nada por nombre.

## 7. Fixtures

Saneados: del session file solo quedan `sessionId, status, waitingFor, name, nameSource, version, kind, updatedAt, statusUpdatedAt`. Revisados contra email, tokens y rutas de credenciales: 0 coincidencias. Todos menores de 40 KB, sin recortes.

| Archivo | Sesión | Contenido |
|---|---|---|
| `arranque.jsonl` | s1b | Diálogo de confianza, idle, `/exit`, backend `system` |
| `trabajando-y-listo.jsonl` | s3 | Turno + idle 70 s + BEL, `system`, hooks globales |
| `trabajando-y-listo-dll.jsonl` | s2 | Turno y `/exit`, `dll`, bytes reales |
| `permiso.jsonl` | s11 | Permiso + OSC 9 + BEL + `pty.kill`, `dll` |
| `pregunta.jsonl` | s7 | Permiso **y** AskUserQuestion, `system`, `TERM_PROGRAM=ghostty` |
| `salida.jsonl` | s6 | Turno y `/exit`, `dll`, `ConEmuPID=1`, progreso off |
| `salida-ctrlc.jsonl` | s12a | Ctrl+C × 2, `system` |
| `salida-taskkill.jsonl` | s10 | `taskkill /F`, título desactivado |
| `resume.jsonl` | s8 | `--resume` + `--name`, `system` |
| `resume-por-nombre.jsonl` | s12b | `--resume <nombre>`, `dll` |
| `progreso-conemu-foco.jsonl` | s4 | OSC 9;4 y prueba de foco, `dll` |
| `calibracion-conpty-*.jsonl` | probe | Calibración sin Claude |

Formato: una línea `{meta}`, luego `{t,data}`, `{t,in}`, `{t,reply}`, `{t,mark}`, `{t,snap,screen}`, `{t,sessfile}`, `{t,procs}`, `{t,exit,signal}`. Con `node tools/analyze.js <archivo> [--titles] [--events] [--screens]`. `record.js` requiere `node-pty` y `@xterm/headless`.

## 8. Sesiones de prueba creadas (no borradas)

Carpeta: `C:\Users\dev\.claude\projects\C--Users-dev-AppData-Local-Temp-claude-C--Users-dev-hilo-ad1d7e7b-7f13-4aff-92a5-47ad7fe5df7f-scratchpad-r2-cwd\`, con un subdirectorio `memory` creado por Claude.

| UUID | Sesión | Nota |
|---|---|---|
| `420592fd-e0c5-404b-8860-9e1e51463771` | s1b | Solo `/exit` |
| `b173f887-345d-4a41-a2db-f40463660f11` | s2 | |
| `64699d41-2abd-4145-8a94-c89643f7967b` | s3, s8, s12b | `--session-id` A; nombre `mi-sesion-x` |
| `1e53fd5c-7eb6-4ad7-a781-732ea3a2efa4` | s4 | |
| `91a2600b-f959-4b8a-92ae-026e35fa9354` | s5 | |
| `2fd9bc2d-f8f7-47ac-b515-97b37b3b8cb6` | s6 | |
| `4683f7f3-f76b-4228-adb7-fdb2f06d9410` | s7, s12a | |
| `69a5fbf5-d057-4742-988a-61d46b23bcb2` | s8b | Lanzamiento de error, sin prompt |
| `59b42861-7925-4215-ab7f-08dfd9f1e6df` | s9 | **Contiene el texto del portapapeles (sección 0)** |
| `e5c250b9-d7a5-4f9e-9e7d-cabedeb5cea8` | s11 | |

Sin transcript: `6f720511-9104-43c7-92a5-89761b1f8222` (s10, matado sin prompt) y `def31e9a-8887-4d7d-a12e-73ec2dd2b2f6` (id temporal de s12b). También es probable que s1 y el primer intento de s1b no generaran sesión al salir por "No, exit".
