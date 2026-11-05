# R1 - Stack para gestor de 9 sesiones Claude Code (Windows 11)

Fecha: 2026-11-02. Leyenda: [V] verificado por mi (npm / paquete / prueba local), [F] segun fuente citada, [I] inferido (hay que medirlo).

## 1. Versiones actuales (npm view, 2026-11-02) [V]
| Paquete | Version | Nota |
|---|---|---|
| node-pty | 1.1.0 (latest); 1.2.0-beta.18 (beta); modificado 2026-10-23 | https://www.npmjs.com/package/node-pty |
| @xterm/xterm | 6.0.0 | v6 elimina el renderer canvas; solo DOM o WebGL: https://newreleases.io/project/npm/@xterm/xterm/release/6.0.0 [F] |
| addon-webgl 0.19.0, addon-fit 0.11.0, addon-search 0.16.0, addon-unicode11 0.9.0, addon-unicode-graphemes 0.4.0, addon-clipboard 0.2.0, addon-serialize 0.14.0 | | addon-canvas se quedo en 0.7.0 (para xterm 5.x, ya no sirve con v6) |
| electron | 45.2.1 | |
| @tauri-apps/cli | 2.12.4; tauri-pty (npm) 0.3.1 | plugin comunitario, experimental |

## 2. node-pty 1.1.0 en Windows: prebuilds y ConPTY moderno [V] (npm pack + inspeccion del tar)
- Trae `prebuilds/win32-x64/{pty.node, conpty.node, conpty_console_list.node, winpty.dll, winpty-agent.exe}` y `prebuilds/win32-x64/conpty/{conpty.dll, OpenConsole.exe}`. Tambien arm64. `npm i node-pty@1.1.0` en un dir limpio funciono sin compilar (script `install: node scripts/prebuild.js || node-gyp rebuild`). No hace falta MSVC.
- Copia de referencia en `third_party/conpty/1.23.251008001/win10-x64/` (conpty.dll + OpenConsole.exe 1.23.251008001, es decir, Windows Terminal 1.23 de oct 2025).
- `useConptyDll?: boolean` existe en `typings/node-pty.d.ts`; si es true carga el conpty.dll/OpenConsole empaquetado en vez del ConPTY del sistema.
- Usa node-addon-api (N-API), asi que el mismo binario sirve para Node 24 y Electron sin rebuild [I]. En Electron empaquetado hay que desempacar de asar `node_modules/node-pty/prebuilds/**` [I, practica conocida].
- Alternativas: @lydell/node-pty 1.2.0-beta.18 (fork) y @homebridge/node-pty-prebuilt-multiarch 0.15.0; no hacen falta.

## 3. Senales de Claude Code a traves de ConPTY (PRUEBA LOCAL, Win11 10.0.26200.9711, Node 24.13) [V]
Script: un proceso Node escribe `OSC 9;4;1;42 BEL`, `OSC 0;MITITULO BEL`, `OSC 2;T2 ST`, `BEL`, `OSC 9;4;3`, `OSC 9;4;0`, y se leyo lo que sale de node-pty.
| Modo | Resultado |
|---|---|
| `useConptyDll:false` (ConPTY inbox de Windows 11 26200) | OSC 9;4 pasa (1;42, 3, 0) pero el titulo se transforma: OSC 0 "MITITULO" se perdio, solo llego el ultimo titulo (`OSC 0;T2`) al final del stream; el BEL suelto llega reordenado antes; ademas inyecta `\e[2J`, `\e[?25l`, etc. |
| `useConptyDll:true` (conpty 1.23 empaquetado) | Todo pasa literal y en orden: `OSC 9;4;...`, `OSC 0;MITITULO`, `OSC 2;T2 ST`, BEL. Sin clear de pantalla. |
- Conclusion: usar siempre `useConptyDll:true`. Con eso xterm.js (parser OSC propio: `term.parser.registerOscHandler(9, ...)`, `onTitleChange`, `onBell`) ve las senales sin perdida. Lo de Claude Code real (que emite 9;4/titulos segun version) queda por confirmar en prototipo [I].
- Fuente de fondo: ConPTY reescrito en WT 1.22 (PR #17510, ago 2024): el VT que genera la app llega "sin modificar" al terminal; los titulos aun los maneja conhost: https://github.com/microsoft/terminal/pull/17510 [F]. Formato 9;4: https://learn.microsoft.com/windows/terminal/tutorials/progress-bar-sequences [F].
- Ojo: windows inbox sin useConptyDll depende de la build de Windows del usuario; el dll empaquetado hace el comportamiento reproducible.

## 4. RAM con 9 terminales
No existe una medicion honesta publicada Electron vs Tauri con 9 vistas; lo que hay:
- Tauri en Windows usa WebView2 = Chromium; la propia issue de Tauri muestra Windows 370 MB (Tauri) vs 312 MB (Electron) en vscode.dev, y 399 vs 318 MB en postman.com al descontar memoria compartida: https://github.com/tauri-apps/tauri/issues/5889 [F]. El ahorro "10x" de los blogs es de macOS/Linux o sin metodologia (https://www.raftlabs.com/blog/tauri-vs-electron-pros-cons) [F, baja confianza].
- Un solo proceso renderer con 9 xterm en una sola pagina (Electron o WebView2) cuesta mucho menos que 9 ventanas/webviews (cada una ~50-100 MB de renderer) [I].
- Scrollback xterm.js: ~17 MB por terminal a 5000 lineas, ~61 MB a 20000 (200 cols, medido en WKWebView por otro proyecto: https://github.com/attson/atterm/pull/343) [F]. Default de xterm 1000 lineas. 9 x 5000 lineas ~ 150 MB; 9 x 1000 ~ 30 MB [I]. Recomendado: scrollback 2000-3000 + persistir historial en disco (addon-serialize).
- WebGL: limite ~16 contextos por pagina en Chromium (menor, ~8, en WebKit/Tauri-Linux/mac) y los ocultos no liberan: https://github.com/xtermjs/xterm.js/issues/4379 y https://github.com/clawterm/ClawTerm/issues/135 [F]. Con 9 terminales cabe, pero cada contexto cuesta GPU/RAM; patron recomendado: WebGL solo en la terminal visible/enfocada (cargar/disponer addon), el resto con renderer DOM [F: https://github.com/aterrylu/autonomOS/pull/24]. Manejar `onContextLoss`.
- Trucos Electron [F/I]: `backgroundThrottling` por defecto ya limita ocultas; mostrar una terminal a la vez (display:none en las demas) y no destruirlas; `--js-flags=--max-old-space-size` del renderer (a veces ignorado en empaquetado: https://github.com/electron/electron/issues/2056); mover trabajo pesado fuera del renderer; un solo BrowserWindow, no BrowserView por sesion; evitar devtools abierto; `app.disableHardwareAcceleration()` solo si no usas WebGL (no recomendado aqui). Electron: main + GPU + network + renderer + utility ~ 250-350 MB base [I, medir].
- Con 16 GB saturados, lo realista: Electron ~ 400-600 MB totales para 9 terminales con scrollback moderado; Tauri/WebView2 similar o 100-150 MB menos (sin Node/V8 de main, sin copia de Chromium), pero con Rust en proceso principal ~10-20 MB [I, no medido]. Los 9 procesos `claude` (Node) pesan mas que la UI (~150-300 MB c/u) [I]: la UI no es el cuello de botella.

## 5. Comparativa
| Criterio (en orden) | (a) Electron + xterm + node-pty | (b) Tauri v2 + xterm + portable-pty | (c) nativo / otros |
|---|---|---|---|
| 1 RAM | Media. Chromium propio. Base ~250-350 MB [I] | Algo menor (WebView2 compartido con el sistema, sin Node) [I]; sigue siendo Chromium | WPF Terminal: la mas baja en teoria; ver abajo |
| 2 Copy/paste y ConPTY | Mejor probado: es el stack de VS Code. node-pty+xterm maduros, ConPTY dll moderno | xterm igual; portable-pty (de WezTerm) intenta cargar un `conpty.dll` junto a la app y cae al de kernel32 (https://docs.rs/crate/portable-pty/latest/source/src/win/psuedocon.rs) [F]; plugin tauri-plugin-pty "en desarrollo" (https://github.com/Tnze/tauri-plugin-pty) [F]. Clipboard: API del navegador/plugin, ok | WT-WPF: seleccion/pegado nativos, pero ver estado |
| 3 Senales OSC | Probado arriba [V] con useConptyDll | Viable si se empaqueta conpty.dll + OpenConsole.exe junto al exe y se verifica [I] | Terminal.Wpf recibe el VT crudo del ConPTY; titulo/campana via eventos propios [I] |
| 4 Test automatico | Playwright `_electron.launch` nativo, estable | Playwright via `connectOverCDP` con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=N` (https://playwright.dev/docs/webview2) [F]; tauri-driver (WebDriver) aun "pre-alpha" y exige msedgedriver igual a la version de Edge [F: https://webdriver.io/docs/desktop-testing/tauri/edge-webdriver-windows] | Poco: UIA/FlaUI, mucho mas trabajo |
| 5 Mantenimiento | Un lenguaje (TS), node-pty prebuilt, updates de Electron frecuentes (mayor cada ~8 semanas) | Requiere instalar Rust (no presente), builds en CI, dos lenguajes | Alto costo, ecosistema fragil |

## 6. Opciones nativas / ligeras: viabilidad hoy
| Opcion | Viable? | Evidencia |
|---|---|---|
| Control WPF de Windows Terminal (Microsoft.Terminal.Wpf) | Dudosa. Sin NuGet oficial; el equipo dice (mar 2026) que lo compila y soporta pero "no esta listo" y apunta a wrapper de terceros (EasyWindowsTerminalControl, depende de betas). Requiere .NET SDK (no instalado; solo Desktop Runtime 8) | https://github.com/microsoft/terminal/discussions/19948 [F] |
| libghostty | No para Windows hoy: libghostty-vt (parser/estado) funciona en Windows, pero no hay renderer ni input de Windows; API alpha. Forks de la app ghostty para Windows son apps, no libreria embebible | https://gist.github.com/stephengodderidge/efb468adcb5b75e8033c1dbede78dc17 (no oficial) [F, baja confianza] |
| wezterm-gui embebido | No: no es embebible en una ventana host; solo se podria reutilizar `portable-pty`/`termwiz` como crates | [I] |
| Neutralino + sidecar Node | Tecnicamente posible (webview2 + proceso Node con node-pty por WebSocket); mismo Chromium, menos pulido y sin test oficial; poco ahorro real | [I] |
| WebView2 pelado + host pequeno (.NET/C++) | Posible, pero reinventas Tauri; requiere .NET SDK o C++; sin ventaja sobre (b) | [I] |
| Windows Terminal real con ventanas incrustadas (SetParent) | Fragil; descartada | [I] |

## 7. Recomendacion
1. **Prototipo A: Electron 45 + @xterm/xterm 6 + node-pty 1.1.0 con `useConptyDll:true`**, UNA ventana/renderer, 9 `Terminal` (display:none las no visibles), WebGL solo en la visible, scrollback ~2000-3000, addons fit + unicode11 (o unicode-graphemes) + search + serialize. Es la opcion de menor riesgo: ConPTY y OSC verificados, tests con Playwright `_electron`, sin toolchain nuevo.
2. **Prototipo B (solo si A supera el presupuesto de RAM tras medir): Tauri v2 + xterm.js + portable-pty** con conpty.dll/OpenConsole.exe empaquetados; Playwright por CDP. Costo: instalar Rust (no esta en la maquina) y escribir/validar el puente PTY.
- Medir antes de decidir: Task Manager no sirve (suma compartida); usar suma de Private Working Set de todos los procesos (`Get-Process electron/msedgewebview2`) con 9 terminales y 3000 lineas de scrollback.
- Descartar por ahora: WPF Terminal, libghostty, wezterm embebido.

## 8. Pendientes / no verificado
- Medicion real de RAM de A vs B (no hay datos publicos fiables con 9 vistas).
- Que senales exactas emite la version instalada de Claude Code (OSC 0/2 con spinner, OSC 9;4, BEL): capturarlas con el harness de test.js (scratchpad r1) en el prototipo.
- Comportamiento de `useConptyDll` dentro de Electron empaquetado (asar unpack, ruta de OpenConsole.exe).
