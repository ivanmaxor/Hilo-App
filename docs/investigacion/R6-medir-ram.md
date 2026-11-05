# R6 - Medir RAM de forma justa: app multi-proceso (Electron/WebView2) vs Windows Terminal

Fecha: 2026-11-02. Script probado: `docs\investigacion\tools\medir-ram.ps1` (PS 5.1, solo lectura).

## 1. Que metrica usar
- **Working Set (WS)**: paginas residentes, incluye compartidas (DLLs, secciones mapeadas). Sumarlo entre procesos Chromium (browser/GPU/renderer/utility cargan las mismas DLL y comparten secciones) cuenta varias veces la misma pagina: sobrecuenta. En la prueba (3 procesos node) WS sumo 137 MB contra 53 MB privados.
- **Private Working Set (PrivWS)**: parte residente no compartible. Es lo que el Administrador de tareas llama "Memory (active private working set)" (columna Memoria). Es la metrica principal recomendada: comparable entre procesos y no duplica compartido.
- **Private Bytes / Commit**: memoria comprometida privada (incluye lo paginado/no tocado). Sirve como segundo indicador; no cae al recortar el working set.
- No existe PSS nativo en Windows; PrivWS es el equivalente practico (no reparte lo compartido entre procesos, solo lo omite: infraestima un poco, WS sobreestima; reportar ambos como cota).
- Fuentes de datos: `Get-Counter '\Process(*)\Working Set - Private'` (nombres por instancia `node#2`, hay que mapear a PID con `\Process(*)\ID Process`); `Win32_PerfFormattedData_PerfProc_Process` (`WorkingSetPrivate`, `PrivateBytes`, `IDProcess`, usado por el script, 1 consulta para todos); `Win32_PerfRawData_PerfProc_Process` da lo mismo en crudo. `Win32_Process.WorkingSetSize` = WS; `PageFileUsage` = commit.
- Herramientas Sysinternals (VMMap por proceso, RAMMap global) no estan instaladas; no se usaron. VMMap desglosa Private/Shareable/Shared si hace falta auditar un caso.
- Electron: `app.getAppMetrics()` devuelve por proceso (browser, GPU, Tab, Utility) `memory.workingSetSize`, `peakWorkingSetSize`, `privateBytes` (en KB). Util para etiquetar tipos de proceso, pero la medicion comparativa debe venir de la misma fuente externa (el script) para ambos lados.

## 2. Arbol de procesos
- `Win32_Process.ParentProcessId` recursivo desde la raiz (el script lo hace con cola y guarda anti reutilizacion de PID: el hijo debe haberse creado despues del padre). Admite varias raices (`-RootPids`).
- Electron: raiz = el exe principal; el arbol incluye GPU, renderers, utility, conhost/OpenConsole, node-pty agent, shells. WebView2: raiz = la app host; los `msedgewebview2.exe` cuelgan de ella (a veces con otro arbol si el runtime es compartido: verificar con el listado por Parent).
- Un conhost/OpenConsole puede aparecer con padre distinto al esperado (se crea via ConPTY); si falta alguno, anadir su PID como raiz extra.

## 3. Windows Terminal: aislar la medicion
- `wt.exe` es solo un alias que delega en `WindowsTerminal.exe`; con `windowingBehavior` por defecto (`useNew`) cada `wt` abre ventana nueva, pero con `useExisting`/`useAnyExisting` se unen a una existente. Forzar siempre: `wt -w new ...`. Tambien `-w -1` equivale a ventana nueva.
- Un solo `WindowsTerminal.exe` puede alojar varias ventanas (modelo por defecto), y el usuario ya tiene uno abierto (PID 18924 en esta maquina, mas 3 OpenConsole). Por eso NO medir por nombre: lanzar y localizar la ventana nueva.
- Metodo recomendado (delta): foto de PIDs `OpenConsole`/`WindowsTerminal` antes; lanzar `wt -w new -d C:\ powershell -NoLogo`; las pestanas nuevas generan `OpenConsole.exe` y shells nuevos (aparecen como PIDs nuevos con padre WindowsTerminal.exe). Medir: PIDs nuevos (OpenConsole + shells) + el WindowsTerminal.exe compartido como delta (PrivWS antes vs despues, mismo reloj).
- Alternativa limpia: version portable (zip de GitHub releases) ejecutada con `.\wt.exe -w new`; si el exe portable es otra ruta, su `WindowsTerminal.exe` es un proceso propio y se mide entero con `-RootPid`. Es la forma mas justa si el usuario acepta descargar.
- Ejemplo (lanzar y medir las mismas N pestanas):
  `$before=(Get-Process WindowsTerminal).Id; wt -w new new-tab powershell -NoLogo ; new-tab powershell -NoLogo`
  `$wt=(Get-Process WindowsTerminal | ? {$_.Id -notin $before} | select -First 1).Id` (si no hay nuevo, usar el existente y calcular delta contra una medicion previa).
  `.\medir-ram.ps1 -RootPids $wt -Exclude claude -Samples 6 -IntervalSec 5 -Json wt.json`
  Nota: con instancia compartida, el arbol de `WindowsTerminal.exe` incluye las pestanas del usuario: restar la linea base medida antes.

## 4. Exclusiones y shells
- `-Exclude claude,node` descarta por nombre (sin .exe); `-ExcludeSubtree` descarta tambien toda la descendencia (claude.exe y sus hijos). Los totales salen "todos" y "sin excluidos".
- Shells (powershell/pwsh/cmd): decision simple y simetrica: contarlos en ambos lados (misma sesion, mismo coste) o excluirlos en ambos con `-Exclude powershell`. Dejar el mismo prompt/perfil en ambos. Reportar las dos variantes.

## 5. Protocolo
1. Cerrar o fijar fuentes de ruido; mismo numero de pestanas, mismos comandos, mismo contenido/scrollback en ambos.
2. Estabilizacion: esperar 30-60 s tras abrir (Electron/Chromium carga lazy, GPU y utility tardan en asentarse); `-WarmupSec 30`.
3. Muestras: >=6 muestras cada 5 s (mediana/min/max; el script da media, min y max del total por muestra). Repetir 3 corridas con proceso nuevo y reportar mediana.
4. Trimming: al minimizar, Chromium/Windows recortan el working set (WS y PrivWS caen artificialmente; Private Bytes/Commit no). Medir con la ventana visible y sin foco movido, o declarar el estado; no comparar minimizado contra visible. Para el pico real usar PrivBytes.
5. GPU: la memoria de video (dedicada/compartida) NO esta en WS. Contadores: `\GPU Process Memory(pid_*)\Dedicated Usage` y `Shared Usage` (Get-Counter); anadirlos como columna aparte si se compara VRAM. WT (DirectX/Atlas) tambien usa GPU.
6. Reportar PrivWS como cifra principal, WS y Private Bytes como contexto, numero de procesos y version de cada app.

## 6. Resultado de la prueba del script
Arbol node padre + hijo (+ conhost): 3 procesos, WS 137 MB, PrivWS 53 MB, PrivBytes 71 MB; con `-Exclude conhost` el total baja a 2 procesos (PrivWS 23.2 MB). Procesos lanzados y terminados por PID.

## Fuentes
- https://learn.microsoft.com/en-us/windows/win32/memory/working-set
- https://learn.microsoft.com/en-us/windows/win32/psapi/process-memory-usage-information
- https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process
- https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments (`-w`, `new-tab`)
- https://learn.microsoft.com/en-us/windows/terminal/customize-settings/startup (`windowingBehavior`)
- https://learn.microsoft.com/en-us/sysinternals/downloads/vmmap y /rammap
- https://www.electronjs.org/docs/latest/api/app#appgetappmetrics
- https://learn.microsoft.com/en-us/windows/win32/perfctrs/ (contadores Process / GPU Process Memory)
- https://github.com/microsoft/terminal/releases (zip portable)
(No se pudo verificar cada URL en linea en esta sesion; salvo la prueba local, el texto de la seccion 1 y 3 sale de documentacion conocida.)
