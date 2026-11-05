# Hilo

Gestor de sesiones de Claude Code para Windows. Electron + xterm.js + node-pty. Interfaz y documentación en español.

Antes de cambiar algo, lee `docs/DECISIONES.md`. Señales de Claude Code: `docs/investigacion/R2-senales-claude.md`.

## Comandos

```
npm run build        # dist/ de desarrollo
npm start            # compila y abre
npm test             # unitarias (vitest), incluye grabaciones reales de Claude
npm run typecheck
npm run e2e          # Playwright sobre la app real, sin Claude
npm run dist         # release/Hilo-Setup-x.y.z.exe, .blockmap y latest.yml. No publica nada
node scripts/publish-release.mjs --dry-run   # comprueba y muestra qué subiría; sin --dry-run publica en GitHub Releases
```

Pruebas con Claude real (consumen poco, usan haiku):

```
HILO_E2E_CLAUDE=1 npx playwright test tests/e2e/claude.spec.ts tests/e2e/claude-real.spec.ts
HILO_E2E_CLAUDE_REAL=1 npx playwright test tests/e2e/claude-real.spec.ts   # con la config del usuario: suena su hook Stop
HILO_PACKAGED_EXE=<ruta a Hilo.exe> npx playwright test tests/e2e/packaged.spec.ts
HILO_E2E_RED=1 npx playwright test tests/e2e/updates-red.spec.ts   # contra el GitHub real, solo lecturas públicas; con HILO_PACKAGED_EXE, también packaged.spec.ts
node scripts/measure.mjs <Hilo.exe> <carpeta confiable> 3    # RAM
```

Definir `HILO_E2E_CWD` con una carpeta ya confiable evita agregar entradas nuevas a `~/.claude.json`.

## Estructura

- `src/shared/`: lógica pura, sin Electron. `statusMachine.ts` (estados), `oscScanner.ts` (títulos), `reducer.ts` (estado persistente), `paneLayout.ts` (reparto de paneles), `paneContent.ts` (qué hay en un panel), `diff.ts` (leer diffs), `safePath.ts` (rutas relativas), `ide.ts` (sintaxis de cada IDE), `paste.ts`, `shortcuts.ts`.
- `src/main/`: `tools.ts` comprueba si están Claude y Git. `updater.ts` busca, baja e instala (reglas en `src/shared/updates.ts`). `sessions.ts` une PTY, hooks, señales y notificaciones. `pty/sharedConout.ts` sustituye el Worker por PTY de node-pty. `security.ts` endurece la ventana y corta la red. `store.ts` guarda de forma atómica. 
- `src/preload/`: API mínima con `contextBridge`.
- `src/renderer/`: Preact. `controller.ts` tiene las acciones. `term/terminals.ts` tiene el teclado, copiar y pegar y WebGL. `ui/changes.tsx` es el panel Cambios. Las instancias de xterm viven fuera de Preact.

## Reglas que no se negocian

- La única conexión de la app es el actualizador, con GitHub (D19): una vez al abrir si no se apagó, y con el botón. Nada se baja ni se instala sin que la persona acepte. Sin telemetría. Todo empaquetado. El renderer sigue sin red. Sin empaquetar no sale nada.
- Nunca leer credenciales ni tocar `~/.claude/settings.json`, `~/.claude.json` ni nada global. Los hooks solo van por `claude --settings <archivo de la app>`, y el comando no lee stdin.
- De `~/.claude/sessions/` solo se lee `<pid>.json` y se tolera que falte. El `.key` de al lado no se abre.
- El único flag de permisos es `--dangerously-skip-permissions`, apagado por defecto desde la 1.2 (para compartir la app) y con interruptor en Ajustes (`skipPermissions`). Quien ya lo tenía encendido lo conserva, porque va guardado en su `state.json`. Las pruebas lo apagan en `makeState`: las de estados necesitan que Claude pida permisos.
- Cada IPC valida el remitente (`trusted()` en `src/main/index.ts`), y las acciones del store van por lista blanca.
- Pegar siempre con `term.paste()` después de `sanitizePaste()`. Nunca `pty.write` con el texto del portapapeles.
- No interceptar los atajos de Claude Code. La lista está en `docs/investigacion/R4-atajos.md`.
- Git, solo desde `src/main/git.ts` y solo para leer. Lo que el repositorio configure no se ejecuta (D21). La ruta de un IDE nunca viene del renderer: `project/ide` no está en la lista blanca, y `project/add` rechaza un proyecto con `ide`.

## Trampas conocidas

- **electron-updater:** manda un UUID persistente a GitHub si no se le quita (`x-user-staging-id`), y al instalar hay que apagar las sesiones antes de lanzar el instalador, que mata lo que siga abierto (D19). Sus versiones y las de electron-builder van fijas: antes de subirlas, releer el código instalado.
- El dueño y el repo de las actualizaciones están solo en `publish` de `electron-builder.yml`. Sin firma, la única comprobación de una actualización es el sha512 de `latest.yml` por HTTPS; no poner `verifyUpdateCodeSignature: false`, para que al firmar se active sola (D19).

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
