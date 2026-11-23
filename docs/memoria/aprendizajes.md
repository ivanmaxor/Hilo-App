# Aprendizajes

Trampas ya resueltas: lo que costó descubrir y no hay que volver a pisar. Se suma una línea cada vez que algo cuesta más de lo esperado.

- **electron-updater:** manda un UUID persistente a GitHub si no se le quita (`x-user-staging-id`), y al instalar hay que apagar las sesiones antes de lanzar el instalador, que mata lo que siga abierto (D19). Sus versiones y las de electron-builder van fijas: antes de subirlas, releer el código instalado.
- El dueño y el repo de las actualizaciones están solo en `publish` de `electron-builder.yml`. Sin firma, la única comprobación de una actualización es el sha512 de `latest.yml` por HTTPS; no poner `verifyUpdateCodeSignature: false`, para que al firmar se active sola (D19).

- **`--resume <id>` encuentra la conversación desde cualquier carpeta; `--session-id <id>` en otra carpeta crea una vacía con el mismo id.** Claude guarda la conversación donde nació y la continuación sigue ahí. Por eso el historial se busca por id en todo `~/.claude/projects` (solo comprobando que exista) y nunca se lanza `--session-id` si ya existe en alguna carpeta (#6). La prueba con Claude real es `claude-retomar-otra-carpeta.spec.ts`.
- **`ui.panes` no son solo sesiones.** Un panel puede tener `changes:<proyecto>` (`paneContent.ts`). `activeSessionId` sigue nombrando solo sesiones, así que con un panel Cambios activo es `null` y `emptyProjectId` dice qué proyecto se ve. Para leer un panel como sesión, `sessionInPane()`. El árbol no cambia: sus hojas siguen siendo índices.
- **`spawn('git', { cwd })` ejecutaría un `git.exe` del repositorio.** En Windows, Node mira primero en `cwd`. Claude Code define `NoDefaultCurrentDirectoryInExePath` y eso lo oculta en las pruebas lanzadas desde él: en un PC normal pasa. Por eso `findGit()` da una ruta absoluta.
- **`git diff` escribe `.git/index` y su `.lock` aunque `GIT_OPTIONAL_LOCKS=0`.** Lo respeta `git status`, no `diff`. Por eso `prepare()` le da una copia del índice en la carpeta temporal.
- **Un filtro con `process` no ejecuta su `clean`.** Una prueba de `clean` necesita que no haya `process`.
- **Claude reimprime lo reciente en cada cambio de tamaño, no toda la conversación** (D23). Por eso el proceso recibe solo el tamaño final, y borrar el historial antes de esa reimpresión perdería conversación.
- **Vista agentes de Claude:** `←` con el prompt vacío saca la sesión a segundo plano y abre su vista de agentes. Hilo no puede interceptarlo (es una tecla de la terminal), y apagarlo es `leftArrowOpensAgents` en `~/.claude.json`, que Hilo no toca.
- En pruebas, `app.evaluate` puede interrumpir el proceso principal a mitad de una función (se vio dentro de `reduce`). No cambiar el store con él: el `dispatch` en curso pisa el cambio. Pasar el estado por `launch({ state })`.
- `vendor/node-pty/conpty.node` sustituye al de npm porque el original se cae con dos salidas a la vez (D7). `node-pty` también prefiere `build/Release`: un `node-gyp rebuild` ahí volvería al fallo. Al cambiarlo hay que actualizar `CONPTY_SHA256` en `scripts/build.mjs`.
- Cerrar una sesión retiene su entrada y salta a la vecina antes de comprobar procesos: lo tecleado nunca espera a una foto de PowerShell (D10).
- Las pruebas apagan `skipPermissions` y ponen `startup: 'asleep'` en `makeState`.
- `useConptyDll: true` hace que el emulador deba responder a `CSI c`: la terminal tiene que existir antes de lanzar el proceso.
- `--resume` falla si la sesión nunca tuvo conversación y `--session-id` falla si el id ya se usó; `retryAfterFailedLaunch` lo resuelve.
- `CLAUDE_CODE_CHILD_SESSION` heredado apaga el guardado de la conversación. `buildEnv` lo quita.
- El título queda en `◐` hasta que acaban los hooks Stop del usuario; por eso el Stop de Hilo adelanta el verde y deja un bloqueo de 20 s.
- En pruebas, nunca mandar Enter después de Alt+V: Claude toma el portapapeles del usuario. Las pruebas con el portapapeles real guardan y restauran **verificando primero** que pueden hacerlo.
- Electron 45: el módulo `clipboard` es asíncrono y `write` no acepta lo que devuelve `read`: hay que construir `ClipboardItem` nuevos.
- Fusibles de Electron activos en el empaquetado: `_electron` no funciona ahí; `packaged.spec.ts` entra por CDP, permitido solo con `HILO_E2E=1`.
- **Saltos de línea:** `.gitattributes` fija LF en todos los PC y en el CI (salvo `.cmd` y `.bat`). Sin eso, Git en Windows deja CRLF y falla una prueba que lee `assets/installer.nsh` esperando saltos LF.
- **Las PowerShell de las e2e son falsas:** `launch()` define `HILO_TEST_SHELL` con un programa de prueba. Para una PowerShell real: `launch({ env: { HILO_TEST_SHELL: '' } })`.
- **Las pruebas no deben sonar:** en modo prueba Hilo anota los sonidos en `__hiloTest.playedSounds` en vez de tocarlos. El botón Probar de Ajustes sí suena: las pruebas que lo usan bajan el volumen.
- **`.playwright-mcp/`** aparece si un Claude usa el navegador de Playwright: está en `.gitignore`, no se sube.
- **Al leer resultados de Playwright, no filtrar líneas:** un filtro escondió fallas una vez.
