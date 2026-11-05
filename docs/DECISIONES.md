# Decisiones

## D1. Stack: Electron + xterm.js + node-pty (con Worker de conout compartido)

**Opciones medidas** (prototipos reales, una ventana, 9 terminales, WebGL solo en la visible, Windows 11 26200, 2026-11-02):

| Private Working Set, sin contar shells ni Claude | Electron 45 sin ajustar | Electron 45 + Worker compartido | Host C++ + WebView2 (equivalente a Tauri) | Windows Terminal 1.24 |
|---|---|---|---|---|
| 9 `claude --model haiku` en reposo | 164,6 MB | **111,8 MB** | 110,3 MB | 58,7 MB marginal / 129,4 MB con todo el proceso |
| 9 PowerShell con 3000 líneas de scrollback | 231,6 MB | **191,0 MB** | 139–173 MB (*) | ~89 MB marginal / ~137 MB con todo el proceso |
| Pegado de 126.712 bytes (100 KB de caracteres), SHA-256 | Coincide | **Coincide** | Coincide | No se midió |

(*) El prototipo C++ iba más lento y sus buffers no siempre estaban llenos al medir (1.650 de 3.000 líneas a los 12 s). Esa cifra favorece a la opción C++.

Notas de método:
- Windows Terminal es un proceso compartido con las ventanas del usuario, por eso se reportan dos números: el delta (marginal) y el proceso completo (cota superior).
- Los 9 procesos `claude` suman **~1.390 MB** en cualquiera de los casos. La interfaz es menos del 10 % del total.
- Script: `docs/investigacion/tools/medir-ram.ps1`. Se midió de a uno, nunca dos a la vez.
- Una sola corrida por configuración (dos en C++). Los números finales de la app, con 3 corridas, van en `docs/AUDITORIA.md`.

**Hallazgo clave.** Con 0 PTYs el proceso principal de Electron pesa 27 MB; con 9 pesa 84 MB. La causa es que node-pty crea **un Worker con su propio V8 por cada terminal**, a unos 6 MB cada uno, para drenar conout. Reemplazarlo por un solo Worker compartido deja el principal en 32 MB. No hace falta tocar `node_modules`: `windowsPtyAgent` busca `ConoutConnection` en el exports del módulo cada vez, así que se puede sustituir al arrancar (`src/main/pty/sharedConout.ts`).

**Elegido: Electron.** Por los criterios del brief, en orden:
1. **RAM.** Empate con 9 Claude (112 vs. 110 MB). Con scrollback lleno, C++ puede ganar hasta ~50 MB, un 3 % del total con Claude incluido.
2. **Copiar y pegar, ConPTY.** Es el stack de VS Code; node-pty y xterm ya están probados. Empate en la prueba de 100 KB.
3. **Señales.** R2 las verificó con este mismo backend (`useConptyDll: true`).
4. **Pruebas automáticas.** Playwright `_electron` funciona de forma nativa. En Tauri, `tauri-driver` sigue en pre-alpha.
5. **Mantenimiento.** Un solo lenguaje. La alternativa exige instalar Rust y mantener un puente PTY propio.

**Descartados:**
- Tauri: mismo Chromium (WebView2), requiere instalar Rust y no da ventaja medible frente a este Electron. Por eso no se pidió autorización para instalar Rust. Se midió la arquitectura equivalente con un host C++ usando el MSVC ya presente.
- Control WPF de Windows Terminal, libghostty, wezterm: no embebibles hoy (R1).
- `--in-process-gpu`: no ahorra nada medible (231,5 vs. 231,6 MB), no se usa.

Costo aceptado: Hilo usa más RAM que Windows Terminal. Medido al final con 9 Claude: 133 MB de app y consolas, frente a entre 62 y 157 MB de Windows Terminal, según se cuente su proceso compartido (`docs/AUDITORIA.md`). A cambio trae barra lateral, estados y retomar sesiones, cosas que WT no tiene.

## D2. Detección de estado

La fuente es lo que emite Claude Code. Ver R2.

| Señal | Para qué | Por qué |
|---|---|---|
| Título OSC (`◐ ◑` / `✳`) | Trabajando / sin trabajar | Es lo que el propio Claude emite; es lo que pinta el "favicon" en WT |
| Hooks por `--settings` (UserPromptSubmit, Stop, StopFailure, PermissionRequest, PreToolUse solo con `AskUserQuestion`, Notification solo `permission_prompt`) | Esperando, y "listo" sin el retraso de los hooks Stop globales del usuario | El título no distingue listo de esperando |
| `~/.claude/sessions/<pid>.json`, solo lectura, opcional, tolerante a fallos | Salir de "esperando" tras Esc | No hay ninguna otra señal en ese caso. Es interno y sin contrato: si falta o cambia, se ignora |
| `pty.onExit` | Muerte del proceso | Es lo único fiable |

- **PreToolUse se justifica** solo con matcher `AskUserQuestion`: Claude no lanza proceso para el resto de las herramientas. `PostToolUse` no se usa.
- **El comando del hook no lee stdin.** Es `echo Evento >> "<archivo>"`. Así, por construcción, ni el prompt ni el contenido de herramientas llegan a la app. El session_id se deduce de que cada sesión tiene su propio archivo, y la hora la pone la app al leer.
- **Sin `ConEmuPID` para forzar OSC 9;4:** se heredaría a todo lo que lance Claude y puede cambiar el comportamiento de otros programas.

## D3. `WT_SESSION`: se define en sesiones de Claude

Con `WT_SESSION`, Claude activa `?2026` (salida sincronizada, sin parpadeo), que xterm 6 soporta. El brief pide que se comporte igual que en WT, y esa es la rama que recorre allí. La cuesta (OSC 9;4 apagado) no importa porque D2 no lo usa. Pendiente de confirmar con pruebas reales en M1.

## D4. Versión de xterm.js: 6.0.0 estable

La beta 6.1 trae `win32InputMode` y el saneado de ESC. Lo primero no hace falta (ConPTY acepta VT normal), y lo segundo se resuelve con nuestro filtro antes de `term.paste()`. Se evita depender de una beta en lo más crítico.

## D5. Interfaz: Preact sin framework de estilos

Un bundle mínimo (esbuild) ahorra RAM del renderer. El estado persistente vive en main con un reductor puro y compartido, el renderer solo lo refleja. Las instancias de xterm viven fuera del árbol de Preact.

## D6. Portapapeles en tests

Los tests usan un portapapeles en memoria (`HILO_TEST_CLIPBOARD=memory`) para no pisar el del usuario. Las pocas pruebas con el real lo guardan y lo restauran. Viene del incidente de R2.

## D7. `conpty.node` recompilado

node-pty 1.1.0 trae una lista global de terminales sin protección, y cada proceso tiene un hilo que se borra de ella al salir. Con dos salidas a la vez, la app entera moría con `0xC0000005`: se vio en un minidump, dentro de `conpty.node`, y se reprodujo en cerca de la mitad de los cierres seguidos.

No se puede arreglar desde JS, y espaciar los cierres no cubre dos Claude que salen solos. Se recompiló con un cerrojo y `shared_ptr` (`scripts/build-conpty.mjs`, que deja la fuente en `vendor/node-pty/conpty.cc`). Usa las Build Tools que ya estaban en la máquina. `scripts/build.mjs` copia el binario sobre `node_modules` y comprueba su SHA-256. Se recompila solo al actualizar node-pty. Tras el arreglo no se volvió a ver la caída en ninguna prueba de estrés.

## D8. `--dangerously-skip-permissions`, por decisión del dueño

Al principio la regla era no pasar flags de permisos. El dueño pidió explícitamente que las sesiones arranquen y retomen con este flag. Queda activo por defecto, con interruptor en Ajustes (`skipPermissions`). Si Claude muestra su advertencia la primera vez, Hilo la marca como "te necesita" y **no la responde**: aceptarla es del dueño, y se guardaría en su configuración global. Con su configuración actual no aparece (comprobado).

Consecuencia: los permisos casi no piden nada, así que el amarillo sale sobre todo por preguntas. Las pruebas apagan el flag en `makeState` porque las de estados necesitan permisos reales.

## D9. Encender al abrir lo que quedó encendido

Pedido del dueño. `ui.awake` lista las sesiones con proceso y se guarda en cada cambio, así que sobrevive a un corte de luz. Al salir de la app no se toca (`shuttingDown`): lo que se apaga por cerrar sigue contando como encendido. Dormir, cerrar o que salga sola sí la saca. Al abrir se encienden escalonadas cada 500 ms, primero la que se está mirando, porque 9 Claude a la vez saturan la CPU.

## D10. Cerrar sin diálogos que salten

Saber qué procesos tiene una sesión cuesta una foto de procesos (unos 600 ms de PowerShell). Hacerlo antes de cerrar daba un retardo en el que lo tecleado caía en la sesión que se iba. Un diálogo después saltaba a media frase en la vecina, y el espacio pulsaba Cancelar.

Por eso la vista pasa a la vecina al instante, lo que llegó en ese hueco se le entrega, y si hay procesos **no se cierra**: un aviso sin foco lo dice, y volver a cerrarla la termina. Fallar hacia dejarla abierta es lo seguro. El diálogo sigue solo para una sesión trabajando, donde se pregunta antes de mover nada.

## D11. Pegar varias líneas

Sin bracketed paste cada salto es un Enter, así que PowerShell ejecutaría: se pide confirmar, y se puede apagar. Claude activa el modo poco después de arrancar, por lo que un pegado de varias líneas espera hasta 4 s; si aun así no lo activó, también pregunta. Eso evita que un salto responda al diálogo de confianza o a la advertencia de permisos.

Se quitó el aviso de pegados de más de 50 000 caracteres: en la batería 102 KB llegaron completos.

## D12. Colores de Windows Terminal por defecto

Requisito explícito: verse igual, colores incluidos. Campbell es el predeterminado y la paleta de Hilo queda como opción. El margen alrededor de la terminal usa el mismo fondo.

## D13. OSC 52: solo escritura, con la terminal a la vista y la ventana con foco

Vim, tmux y ssh copian así. Leer dejaría a cualquier programa ver lo copiado, así que nunca se contesta. Una sesión de fondo no puede cambiar el portapapeles, las ráfagas se limitan a una cada 200 ms y se queda la última.

## D14. Red cortada también para DNS

`no-proxy-server` evita WPAD y `host-resolver-rules=MAP * ~NOTFOUND` que Chromium resuelva nombres. Abrir un enlace va por el navegador del sistema, que no pasa por aquí.

Desde la 1.3 la regla de nombres tiene una excepción exacta para el actualizador, solo en la app empaquetada: ver D19.

## D15. `--in-process-gpu` no se usa

No ahorra nada medible (231,5 vs. 231,6 MB) y mezcla los fallos de la GPU con los del proceso principal.

## D16. La división la decide el dueño

Pedido del dueño. Antes, dividir rellenaba los paneles con las primeras sesiones libres, y al despertar al seleccionar eso abría cosas que nadie pidió. Ahora un panel nuevo nace vacío y ofrece una lista para elegir; la selección llena primero el panel que espera.

**Arrastrar.** Hacia el centro de un panel reemplaza, o intercambia si la sesión ya se ve en otro. Cerca de un borde (hasta 72 px, o el 25 % del panel si es menor) marca ese borde con un círculo con un más, y al soltar suma un panel de ese lado. Con 4 paneles el borde no ofrece sumar y solo queda reemplazar.

**Un árbol y no una cuadrícula** (`ui.tree`, `src/shared/paneLayout.ts`). Soltar abajo de un panel divide solo ese panel: una cuadrícula fija no puede hacer eso. Cada nodo reparte en partes iguales, sin tiradores para cambiar tamaños. Un `ui.tree` roto en disco se descarta y se usa el reparto normal.

**Quitar un panel no cierra la sesión**: sigue con su proceso y en la barra lateral. Los paneles se pintan en una sola lista con posición absoluta, para que cambiar el reparto no desmonte las terminales que no cambian.

Al cerrar la sesión activa, la vecina ocupa ese mismo panel (`inPlace`) para no dejar lo tecleado esperando en otro sitio (D10).

## D17. Para compartir la app (1.2)

Pedido del dueño, para compartirla por un enlace de descarga.

**`--dangerously-skip-permissions` apagado por defecto.** Sustituye el "activo por defecto" de D8. Quien ya lo tenía encendido lo conserva porque va en su `state.json`.

**Licencia MIT e instalador con pantallas** (`oneClick: false`), para mostrarla antes de instalar. Se aclara que Hilo no es de Anthropic.

**Barra de desplazamiento siempre a la vista.** xterm la esconde a los pocos segundos. Sin historial no hay barra.

**Touchpad.** Un touchpad manda decenas de eventos por gesto y xterm atiende cada uno como una muesca de rueda. `WheelThinner` (`src/shared/wheel.ts`) los reconoce porque no vienen en múltiplos de 120 y deja pasar una parte, 35 % por defecto, ajustable. Actúa antes que xterm, así que vale también para los programas que reciben el ratón. El 35 % no se calibró con un touchpad real: esta máquina no lo tiene.

**Logo de Claude con costuras.** Los bloques (`▐▛█`) salen perfectos con WebGL, que los dibuja a mano, y con líneas entre ellos en el dibujo de respaldo, que usa los de la fuente. Se reproduce perdiendo el contexto de WebGL. Antes, una terminal que lo perdía (un juego o una suspensión pueden reiniciar la GPU) se quedaba así hasta cambiarla de panel; ahora reintenta a los 1, 5 y 30 s. En un PC donde WebGL no funcione en absoluto seguirán viéndose las costuras.

**Tamaños.** "Tamaño de toda la ventana" es el zoom de Chromium: la terminal lo soporta porque ya escucha los cambios de escala. Los divisores entre paneles guardan `sizes` en `ui.tree`, y cambiar la cantidad de paneles de un nodo vuelve a partes iguales.

**Casillas al final del instalador (1.2.1).** "Abrir Hilo al terminar" es la de NSIS (`runAfterFinish`). El acceso directo reutiliza la casilla de "ver el léeme", porque electron-builder no trae una; por eso `createDesktopShortcut` queda en `false` y `assets/installer.nsh` lo crea y lo borra. Sin pantallas (`/S`) se crea, salvo en una actualización, que deja las cosas como estaban (D19). Sin `customInstallMode`, un instalador con pantallas pregunta para quién instalar.

## D18. La X de la pestaña no cierra la sesión

Pedido del dueño, que perdió dos sesiones así: esperaba lo que hace un editor. La X y el clic central dejan de mostrar la pestaña (`ui.hiddenTabs`); el proceso sigue y la sesión sigue en la barra, donde un clic la abre de nuevo. No se duerme sola: si quiere liberar memoria, la duerme.

Cerrar de verdad queda en el menú y en el aviso de error, ahora con confirmación. El atajo sigue sin diálogo, con Deshacer: un diálogo que salta le quitaría el foco a media frase (D10).

## D19. Actualizaciones desde GitHub Releases (1.3)

El dueño cambió su regla de "cero internet" solo para esto. Hilo busca versión una vez al abrir (`checkUpdatesOnStart`, encendido por defecto, a los 8 s para no competir con las sesiones) y cuando se pulsa el botón en Ajustes. Nada se baja ni se instala sin que la persona lo pida. No hay telemetría.

**La excepción de red, lo más estrecha posible.** `electron-updater` hace sus peticiones con `net.request` en su propia partición (`electron-updater`, sin caché; leído en `electronHttpExecutor.js`). Eso permite separar:

- `host-resolver-rules` es global al proceso y no se puede cambiar después de arrancar, así que queda `MAP * ~NOTFOUND, EXCLUDE github.com, EXCLUDE release-assets.githubusercontent.com`, y solo en la app empaquetada (`resolverRules`).
- Esa excepción no le da red al renderer: la sesión por defecto sigue cancelándolo todo (`hardenSession`), además de la CSP.
- La sesión del actualizador cancela con `webRequest` lo que no sea https a esos dos hosts exactos (`hardenUpdaterSession`). Como `electron-updater` sigue las redirecciones con una petición nueva, cada salto vuelve a pasar por el filtro.

**Hosts.** Comprobado el 2026-11-04 con descargas reales de dos repos públicos: el feed y las rutas de descarga son de `github.com`, y cada archivo redirige a `release-assets.githubusercontent.com`. `objects.githubusercontent.com`, el anterior, sigue respondiendo pero no apareció, y `api.github.com` no se usa con un repo público: quedan fuera. También `latest.yml` pasa por esa redirección, así que si GitHub cambia de host fallan la búsqueda y la descarga, con un mensaje y un botón a la página de versiones; `tests/e2e/updates-red.spec.ts` lo detecta. Agregar un host exige publicar una versión, y quien tenga la anterior la baja a mano.

**`no-proxy-server` se queda.** Quitarlo devolvería la búsqueda de WPAD que encontró la auditoría A1, para todo el proceso. La consecuencia, aceptada: tras un proxy obligatorio no se puede actualizar por la app. El error lo dice y ofrece la página de versiones.

**Nada aparte de la petición.** De serie, `electron-updater` crea `.updaterId` con un UUID persistente y lo manda a GitHub en la cabecera `x-user-staging-id`, para los lanzamientos graduales. Eso identificaría a cada instalación, así que no se usa: se sustituye la promesa que lo genera (no hay archivo), se ignoran esos lanzamientos, y `hardenUpdaterSession` quita la cabecera y las cookies por si una versión futura cambia. Las pruebas lo comprueban en lo que recibe el servidor.

**Origen fijo.** El dueño y el repo están solo en `publish` de `electron-builder.yml`. La compilación los deja fijos en el código (`scripts/update-target.cjs`) y el proveedor se crea con ellos, sin leerlos de `app-update.yml`. De ese archivo solo se usa la carpeta de caché. Para renombrar el repo basta cambiarlo ahí. Las instalaciones ya hechas siguen con el nombre viejo y dependerían de la redirección de GitHub, que queda dentro de `github.com`; eso no se probó.

**Sin firma todavía.** Con la versión instalada (`electron-updater` 6.8.11), `NsisUpdater.verifySignature` acepta el archivo si `app-update.yml` no trae `publisherName`, y `electron-builder` 26.18 solo lo escribe si hay certificado. Por eso no hace falta `verifyUpdateCodeSignature: false`, y no se debe poner: con certificado, la comprobación se activa sola. Mientras tanto, **la única comprobación es el sha512 de `latest.yml`, bajado por HTTPS de GitHub.** Protege de una descarga dañada, no de que alguien tome la cuenta de GitHub. Según ese mismo código, después de la primera versión firmada una sin firmar sería rechazada.

**Versiones fijas.** `electron-updater` y `electron-builder` sin `^`: subirlas puede cambiar los formatos publicados o lo que se manda. Antes de subirlas hay que releer el código instalado y correr las pruebas.

**Instalar.** Primero se guarda y se apagan las sesiones con el mismo código del cierre (`stopEverything`), y después se lanza el instalador: este mata a la fuerza lo que siga abierto en su carpeta a los pocos segundos, y apagar sesiones puede tardar 9. Va con `--updated /S --force-run`: la licencia ya se aceptó, y Hilo se reabre solo. Si hay sesiones trabajando se pregunta antes. Si el instalador no arranca, Hilo se vuelve a abrir para recuperar las sesiones.

**El instalador.** Todo instalador corre primero el desinstalador viejo, siempre con `--updated` (`installUtil.nsh`), también al instalar a mano encima. Sin protegerlo, `customUnInstall` habría borrado el acceso directo del escritorio y `hilo-updater`, la carpeta desde donde corre el instalador. Ahora solo lo hace al desinstalar de verdad. `customInstall` tampoco crea el acceso directo en una actualización: quien no lo quiso no lo recupera. La primera actualización a 1.3 es siempre a mano, porque antes no había actualizador; el desinstalador de la 1.2 sí borra el acceso directo, y la casilla final lo vuelve a crear.

**Queda sin limpiar** la copia en `%LOCALAPPDATA%\hilo-updater\pending` tras instalar, de un solo archivo: la reemplaza la siguiente descarga y la borra el desinstalador.

**Publicar.** `npm run dist` genera `Hilo-Setup-x.y.z.exe` (sin espacios: GitHub los cambia y `latest.yml` dejaría de coincidir), su `.blockmap` y `latest.yml`, sin subir nada. `scripts/publish-release.mjs` sube exactamente esos tres tras comprobar versión, sha512, árbol limpio y que el tag no exista. GitHub no crea versiones en un repo vacío: el público necesita antes un commit.

**En desarrollo y pruebas no sale nada.** Sin empaquetar el modo es `off`. Las pruebas usan un servidor en 127.0.0.1 con feed `generic`, activable solo con `HILO_E2E=1` y una dirección de esta máquina (`resolveUpdateMode`): no hay forma de cambiar el origen en producción.

## D20. SmartScreen: la Store, no un certificado

El dueño quiere quitar el aviso de Windows. Ningún certificado lo quita de inmediato, ni el EV; solo la Microsoft Store con MSIX, que además es gratis. Artifact Signing no admite personas fuera de EE. UU. y Canadá. Recomendación: Store, sujeta a una prueba real del paquete, porque la redirección de `%APPDATA%` puede afectar a los hooks. Plan B: Certum Open Source. Falta que el dueño lo apruebe.

`win.signExts` queda listo para firmar también DLL y `.node`, porque Smart App Control revisa todo lo que se carga. Sin certificado no cambia nada: se comprobó empaquetando. `THIRD_PARTY_NOTICES.txt` se rehízo contra lo que va en el instalador, incluida la LGPL de FFmpeg y de dos plug-ins de NSIS.

## D21. Panel de cambios y abrir en el IDE

Pedido para quien usa NetBeans: ver dónde cambiaron las líneas, sin los `+` y `-` si no se quiere, y abrir el IDE del proyecto. **La ventana del IDE no se incrusta**: meter la de otro programa dentro de Hilo es frágil y se descartó.

**El panel es una hoja más de `ui.tree`.** Las hojas siguen siendo índices de `ui.panes`; lo nuevo es que un panel puede contener `changes:<proyecto>`. Por eso dividir, arrastrar, reemplazar y persistir funcionan sin tocar el árbol. Los ids de sesión no admiten `:` (`isSafeId`), así que no pueden chocar. `activeSessionId` sigue nombrando solo sesiones: con el panel activo es `null`, porque terminales, búsqueda y atajos dan por hecho que es una sesión. Un panel cuyo proyecto ya no existe se descarta al cargar, y un estado viejo carga igual porque no tiene ninguno.

Elegir una sesión con el panel activo la lleva a la terminal de al lado en vez de taparlo: se abrió para mirar los cambios mientras se trabaja. Si está solo en la ventana, lo reemplaza. El botón y el atajo son un interruptor, y con 4 paneles llenos avisan en vez de quitar uno.

**Solo lectura, y nada de lo que diga el repositorio se ejecuta.** Una carpeta compartida puede traer un `.git/config` hostil, y mirarla no puede ser ejecutar código. Lo probado con un control positivo en `cambios.spec.ts`, donde git sin blindar sí ejecuta cada una:

| Riesgo | Defensa |
|---|---|
| `git.exe` dentro del repositorio: en Windows `spawn('git', { cwd })` mira primero en `cwd` | `findGit()` da una ruta absoluta; sin entradas relativas del PATH; nunca `git.cmd` |
| `core.fsmonitor` | `-c core.fsmonitor=false` |
| `diff.external`, `diff.<driver>.command` | `--no-ext-diff` |
| `diff.<driver>.textconv` | `--no-textconv` |
| `filter.<x>.clean`, `.process` | se piden los nombres con `git config --get-regexp` y se vacía cada uno con `-c` |
| Hook `post-index-change` | `-c core.hooksPath=/dev/null`, y el índice no se escribe |
| `git diff` escribe el índice aunque `GIT_OPTIONAL_LOCKS=0` | `GIT_INDEX_FILE` apunta a una copia en la carpeta temporal |
| `core.worktree` apuntando a otra carpeta | si el proyecto no queda dentro de `--show-toplevel`, no es un repositorio |

También, sin control porque en este flujo no se llega a ejecutar: `core.pager`, `core.sshCommand`, `credential.helper`, `filter.<x>.smudge`; `-O/dev/null` contra `diff.orderFile`, que podría apuntar a una ruta de red (este sí se comprueba, porque de respetarse git fallaría); `--ignore-submodules=dirty`, porque si no git entra a cada submódulo y ejecuta lo que pida el suyo. Para la red, `GIT_NO_LAZY_FETCH`, `GIT_ALLOW_PROTOCOL=none` y `protocol.allow=never`: un clon parcial bajaría lo que le falta. `GIT_LITERAL_PATHSPECS` hace que un archivo llamado `*` sea ese archivo. Se quitan del entorno todas las `GIT_*` heredadas.

Si el nombre de un filtro no se puede escribir en un `-c` porque lleva `=`, no se lee el repositorio y se avisa. **Lo que no se cubre:** un `include.path` con una ruta de red en `.git/config` se lee antes de cualquier `-c`, y puede filtrar el usuario de Windows a un servidor. Pasa también con cualquier `git` que se ejecute en esa carpeta; apagarlo exigiría no leer el repositorio. **Coste aceptado:** con los filtros anulados, los archivos de Git LFS se comparan sin pasar por LFS.

**Rutas.** El renderer manda un id de proyecto y una ruta relativa; la carpeta sale del estado de main. `checkRelativePath` rechaza `..`, absolutas, unidades, flujos alternativos (`a.txt:x`), `.git`, nombres de dispositivo, y tramos que acaban en punto o espacio, porque Windows los quita y `.. ` valdría `..`. Después `resolveInside` comprueba la ruta real, y una unión o un enlace que salen se rechazan. Un archivo nuevo se lee a mano, sin seguir enlaces: git no tiene con qué compararlo.

**Sin coste oculto.** Sin sondeo ni vigilar archivos: son hasta 9 sesiones en 16 GB. Se actualiza al montarse, al volver a la ventana y cuando una sesión del proyecto deja de trabajar. El componente solo existe mientras el panel está a la vista, así que oculto no suscribe nada ni lanza git. Sale una lista de hasta 2000 archivos; un diff de más de 5 MB se corta con un aviso; las filas se dibujan por tramos, y una línea de más de 2000 caracteres se corta. Sin dependencias nuevas.

**Accesible sin color.** Sin signos, una agregada solo tiene número en la columna nueva y una quitada solo en la vieja, el borde izquierdo es continuo o punteado, y un lector de pantalla oye "Línea nueva" o "Línea quitada". La opción de los signos va apagada por defecto, como se pidió.

**La ruta del IDE nunca sale del renderer.** Sale de la detección, que el renderer elige por un id opaco, o del diálogo nativo. `project/ide` no está en la lista blanca, `project/add` rechaza un proyecto con `ide`, y al cargar solo vale un `.exe` local con ruta absoluta. Se lanza sin shell, desacoplado, sin `ELECTRON_RUN_AS_NODE`, que haría arrancar VS Code como Node. Un `.cmd` exigiría shell, y por eso VS Code se lanza con `Code.exe`, no con `code.cmd`.

| IDE | Abrir archivo y línea | Abrir el proyecto | Fuente |
|---|---|---|---|
| NetBeans | `netbeans64.exe --open archivo:línea` | `--open carpeta`: según la fuente la muestra en el explorador, no la abre como proyecto; no hay opción documentada para eso | [man](https://manpages.ubuntu.com/manpages/focal/man1/netbeans.1.html), [Handler.java](https://github.com/apache/netbeans/blob/master/ide/utilities/src/org/netbeans/modules/openfile/Handler.java): corta en el último `:`, así que la unidad `C:` no molesta. [DefaultOpenFileImpl.java](https://github.com/apache/netbeans/blob/master/ide/utilities/src/org/netbeans/modules/openfile/DefaultOpenFileImpl.java) |
| VS Code, Insiders, VSCodium | `Code.exe carpeta --goto archivo:línea` | `Code.exe carpeta` | [Docs](https://code.visualstudio.com/docs/configure/command-line); `Code.exe` directo: [argvHelper.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/environment/node/argvHelper.ts) |
| Cursor, Windsurf | igual que VS Code | igual | [Cursor](https://docs.cursor.com/tools/cli). Windsurf sale de VS Code; no se verificó en su documentación |
| IntelliJ y familia | `idea64.exe --line N archivo` | `idea64.exe carpeta` | [IDEA](https://www.jetbrains.com/help/idea/opening-files-from-command-line.html), [PyCharm](https://www.jetbrains.com/help/pycharm/opening-files-from-command-line.html) |
| Visual Studio | `devenv.exe /Edit archivo`, sin línea | `devenv.exe carpeta`: no está documentado para carpetas | [/Edit](https://learn.microsoft.com/en-us/visualstudio/ide/reference/edit-devenv-exe), [switches](https://learn.microsoft.com/en-us/visualstudio/ide/reference/devenv-command-line-switches). `/Command "Edit.GoTo N"` existe, pero ninguna fuente lo documenta junto a `/Edit`, así que no se usa |
| Eclipse | `eclipse.exe --launcher.openFile archivo`, sin línea | sin argumentos: trabaja por espacios de trabajo | [runtime options](https://eclipse.googlesource.com/platform/eclipse.platform.common/+/c373794a2493dc2959cd762208e2b01be2267dea/bundles/org.eclipse.platform.doc.isv/reference/misc/runtime-options.html) |
| Sublime Text | `subl.exe archivo:línea` | `subl.exe carpeta` | [Docs](https://www.sublimetext.com/docs/command_line.html) |
| Notepad++ | `notepad++.exe -nN archivo` | `-openFoldersAsWorkspace carpeta` | [Manual](https://npp-user-manual.org/docs/command-prompt/) |
| Otro `.exe` elegido a mano | `programa.exe archivo`, sin línea | `programa.exe carpeta` | |

Ninguno de estos se probó con el programa real: las pruebas usan un ejecutable falso con su nombre, y comprueban exactamente qué argumentos recibe.

## D22. Guía de requisitos

Pedido del dueño, para quien recibe la app sin Claude Code o sin Git. Sale sola una vez (`settings.setupSeen`) y solo si falta algo; quien ya tiene todo nunca la ve. Después se abre en Ajustes, sección Claude Code.

Solo comprueba que los archivos existan (`src/main/tools.ts`) y explica cómo instalarlos: Hilo no instala nada, para no tocar el sistema. Tampoco puede saber si hay sesión iniciada en Claude, porque eso exigiría leer credenciales. Los comandos salen de la página oficial de Claude Code, consultada el 2026-11-04.

El PATH de Hilo es el de cuando abrió, así que lo recién instalado puede no verse: Claude se busca también en `~/.local/bin`, Git en sus carpetas de instalación, y si aun así falta, la guía pide reabrir Hilo.

## D23. Cambios de tamaño: se avisa solo el final

Con el renderer clásico, Claude Code responde a cada cambio de tamaño borrando la pantalla visible y reimprimiendo lo reciente con el ancho nuevo. Lo que ya subió al historial de la terminal se queda como estaba, así que cada aviso deja otra copia, cortada y con otro ancho. Hilo avisaba en cada cuadro: con una respuesta de 12 líneas, arrastrar la ventana llevó el historial de 92 a 439 líneas.

Ahora xterm se ajusta al instante y el proceso recibe el tamaño 120 ms después del último cambio (`schedulePtyResize`). Con Claude real y 70 líneas de respuesta, arrastrar en 18 pasos no repite la última línea ni pierde ninguna.

Queda una copia de lo reciente por cada cambio real de tamaño: 70 líneas terminaron con 92 marcas. No se limpia: se probó insertar `CSI 3 J` antes de la reimpresión y se perdieron las líneas 1 a 36, porque Claude no reimprime toda la conversación. xterm no permite borrar solo el final del historial. La salida de una sesión oculta sigue con el ancho de su último panel.

## D24. Una sesión termina cuando acaban sus subagentes

Pedido del dueño: Hilo avisaba que una sesión terminó cuando acababa el agente principal, con subagentes todavía corriendo. Grabación con Claude real, dos subagentes en segundo plano: el hook `Stop` llegó a los 11 s y a los 20 s, y el último `SubagentStop` a los 34 s. Cada subagente que termina despierta al principal con un `UserPromptSubmit`, seguido de otro `Stop`.

La sesión sigue en "Trabajando", con una marca de cuántos faltan, y el aviso sale con el `Stop` que llega sin subagentes pendientes. No se avisa por cada uno que termina.

El conteo sale de los hooks `SubagentStart` y `SubagentStop`, solo por su nombre: el comando sigue sin leer stdin, así que no se usa el `background_tasks` que trae `Stop`. Por eso cuenta con dos riesgos:

- **Quedar corto.** La documentación dice que `SubagentStop` también sale con las sugerencias de prompt. Puede avisar antes de tiempo, y la sesión vuelve a "Trabajando" cuando Claude siga ocupado. Es el error menos grave.
- **Quedar pegado.** Si se pierde un `SubagentStop`, la sesión no terminaría nunca. `~/.claude/sessions/<pid>.json` sigue en `busy` mientras hay subagentes (visto en la grabación), así que `idle` ahí pone la cuenta en cero. Ese archivo no tiene contrato: si Claude lo cambia, este rescate deja de funcionar, y una sesión pegada se resuelve al dormirla o reabrirla.

Un comando en segundo plano sin subagente no cuenta: en ese caso Claude marca `shell` en ese archivo, y Hilo avisa igual que antes.
