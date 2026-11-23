# Hilo

Gestor de sesiones de Claude Code para Windows. Electron + xterm.js + node-pty. Interfaz y documentación en español.

Antes de cambiar algo, lee `docs/DECISIONES.md`. Señales de Claude Code: `docs/investigacion/R2-senales-claude.md`.

## Trabajamos de a dos

Este repo es la única fuente de verdad: @ivanmaxor (dueño) y @dedalexcr7 trabajan aquí, cada uno con su Claude Code. El flujo completo está en `docs/memoria/colaboracion.md`. Lo mínimo:

- **Al empezar:** `git switch main && git pull`, y lee `docs/memoria/estado.md` y las últimas entradas de `docs/memoria/sesiones/`. Trabaja sobre un Issue asignado, en su propia rama.
- **Nunca** push a `main`, force push, tags, Releases ni cambios en la configuración del repo: todo va por PR, que aprueba @ivanmaxor. Solo él saca versiones.
- **Commits** chicos, en español, con el correo noreply y **sin firmas de IA** (nada de `Co-Authored-By` ni "Generated with"). En el PR, `Closes #N` (en inglés) y qué quedó sin verificar.
- **Nada personal en el repo:** ni correos, ni rutas `C:\Users\<nombre>`, ni claves, ni datos de otros proyectos. `npm run privacy` lo revisa, y el CI también.
- **Al terminar:** deja `docs/memoria/sesiones/AAAA-MM-DD-usuario-tema.md` y actualiza `estado.md` o `aprendizajes.md` si cambió algo.

## Comandos

```
npm run build        # dist/ de desarrollo
npm start            # compila y abre
npm test             # unitarias (vitest), incluye grabaciones reales de Claude
npm run typecheck
npm run e2e          # Playwright sobre la app real, sin Claude
npm run privacy      # correos, rutas con usuario y claves: lo mismo que revisa el CI
npm run dist         # release/Hilo-Setup-x.y.z.exe, .blockmap y latest.yml. No publica nada. Antes, las novedades en src/shared/changelog.ts
node scripts/publish-release.mjs --dry-run   # solo el dueño: comprueba y muestra qué subiría; sin --dry-run publica
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
- Nunca leer credenciales ni tocar `~/.claude/settings.json`, `~/.claude.json` ni nada global. Los hooks solo van por `claude --settings <archivo de la app>`, y el comando no lee stdin. La única excepción es la línea de estado (D25), que guarda solo `rate_limits`.
- De `~/.claude/sessions/` solo se lee `<pid>.json` y se tolera que falte. El `.key` de al lado no se abre.
- El único flag de permisos es `--dangerously-skip-permissions`, apagado por defecto desde la 1.2 (para compartir la app) y con interruptor en Ajustes (`skipPermissions`). Quien ya lo tenía encendido lo conserva, porque va guardado en su `state.json`. Las pruebas lo apagan en `makeState`: las de estados necesitan que Claude pida permisos.
- Cada IPC valida el remitente (`trusted()` en `src/main/index.ts`), y las acciones del store van por lista blanca.
- Pegar siempre con `term.paste()` después de `sanitizePaste()`. Nunca `pty.write` con el texto del portapapeles.
- No interceptar los atajos de Claude Code. La lista está en `docs/investigacion/R4-atajos.md`.
- Git, solo desde `src/main/git.ts` y solo para leer. Lo que el repositorio configure no se ejecuta (D21). La ruta de un IDE nunca viene del renderer: `project/ide` no está en la lista blanca, y `project/add` rechaza un proyecto con `ide`.

## Estado y aprendizajes

@docs/memoria/estado.md

@docs/memoria/aprendizajes.md
