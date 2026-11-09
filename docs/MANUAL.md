# Manual de Hilo

## Instalar

Baja `Hilo-Setup-x.y.z.exe` desde [Releases](../../../releases/latest) y ábrelo. No pide permisos de administrador. Crea un acceso directo en el menú Inicio, y al terminar dos casillas te dejan abrir Hilo y crear otro en el escritorio.

Para desinstalar, usa Configuración de Windows > Aplicaciones. Tus proyectos y ajustes quedan en `%APPDATA%\Hilo`; puedes borrar esa carpeta si no los quieres. Tus conversaciones de Claude son de Claude Code y no se tocan.

## Actualizar

Al abrir, Hilo busca una vez si hay una versión nueva en GitHub y, si la hay, te avisa. Nada se baja ni se instala sin que lo pidas: en **Ajustes > Actualizaciones** están la versión que tienes, el botón **Buscar actualizaciones** y, cuando corresponde, **Bajar la versión** y **Reiniciar e instalar**. Hilo se cierra, se actualiza sin mostrar pantallas y vuelve a abrirse, y tus sesiones vuelven con su conversación. Si alguna está trabajando te avisa antes. La búsqueda al abrir se puede apagar ahí mismo.

## Empezar

Si falta Claude Code o Git, al abrir Hilo por primera vez una guía explica cómo instalarlos. Se puede volver a ver en Ajustes, sección Claude Code, "Ver requisitos".

1. Abre la carpeta de un proyecto.
2. Crea una sesión con **Ctrl+Shift+T**. Solo hace falta el nombre; modelo y esfuerzo se heredan de tu configuración si no eliges otros.
3. Trabaja como siempre. Claude te pedirá permiso antes de ejecutar cosas. Si prefieres que no pregunte, enciende `--dangerously-skip-permissions` en Ajustes, sección Claude Code: vale desde el próximo despertar y Claude ejecuta todo sin preguntar.

## Qué significa cada ícono

| Ícono | Estado |
|---|---|
| Círculo medio lleno, gris, que alterna | Trabajando |
| Asterisco verde | Terminó y no lo has visto |
| Triángulo amarillo | Te está esperando: una pregunta o un permiso |
| Octágono rojo | El proceso murió con error |
| Luna | Dormida: no usa memoria |
| Círculo pequeño | Lista, ya la viste |

Si Claude lanzó subagentes, la sesión sigue en "Trabajando" hasta que acaben, con una marca morada que dice cuántos faltan, como "2 sub". El aviso de que terminó sale al final.

El verde se queda hasta que abres esa sesión.

## Uso de tu plan

Abajo en la barra lateral está cuánto llevas usado de la sesión de 5 horas y de la semana, y cuándo se renueva cada una: verde si te queda más de la mitad, amarillo desde el 50 % usado y rojo desde el 80 %. Claude da el dato al responder, así que aparece después de la primera respuesta y se actualiza con cada una. Solo funciona con planes Pro, Max o Ultra.

Lo mismo sale abajo en cada sesión de Claude, en lugar de tu línea de estado. Si prefieres la tuya, apágalo en Ajustes, sección Claude Code. El bloque **Te necesitan**, abajo en la barra lateral, junta todo lo que requiere atención, ordenado por urgencia.

## Copiar y pegar

| Acción | Cómo |
|---|---|
| Copiar | Ctrl+C con selección, clic derecho con selección, Ctrl+Shift+C o Ctrl+Insert |
| Interrumpir a Claude | Ctrl+C sin selección |
| Pegar | Ctrl+V, Ctrl+Shift+V, Shift+Insert o clic derecho sin selección. En PowerShell, varias líneas piden confirmación porque cada salto ejecuta |
| Pegar imagen | Alt+V, como en tu terminal. Si solo hay imagen en el portapapeles, Ctrl+V también funciona |
| Salto de línea sin enviar | Shift+Enter |
| Copiar uniendo líneas que cortó Claude | Ctrl+Shift+J |

## Dormir sesiones

Dormir cierra el proceso de Claude y conserva la conversación. Vuelve con un clic. Si hay algo corriendo en segundo plano, como `npm run dev`, Hilo te lo avisa antes, porque se cierra también. Al cerrar una sesión pasa lo mismo: la vista salta a la vecina, y si tenía procesos sigue abierta y un aviso te ofrece terminarla.

Una sesión que trabaja no se puede dormir. El dormido automático viene apagado.

## Cerrar y volver

Al cerrar Hilo o apagar el PC se guarda todo: proyectos, sesiones, nombres, colores, orden y conversaciones. Al abrirlo vuelven a encenderse solas las sesiones que dejaste encendidas, retomando su conversación con `claude --resume <id>`; las que dormiste o cerraste se quedan como estaban. En Ajustes se puede elegir otra cosa: todas dormidas, solo la última o todas.

Escribir o pegar sobre una sesión dormida la despierta, y lo escrito le llega.

## Atajos

No chocan con los de Claude Code ni con PowerShell. Todos se pueden cambiar en Ajustes (Ctrl+,).

| Atajo | Acción |
|---|---|
| Ctrl+Shift+K | Selector rápido: saltar a cualquier sesión por nombre |
| Ctrl+1 a Ctrl+9 | Ir a la sesión 1 a 9 (mantén Ctrl para ver los números) |
| Ctrl+Tab / Ctrl+Shift+Tab | Siguiente o anterior sesión despierta |
| Ctrl+Shift+U | Siguiente sesión que requiere atención |
| Ctrl+Shift+T | Nueva sesión de Claude |
| Ctrl+Shift+H | Nueva PowerShell |
| Ctrl+Shift+N | Nuevo proyecto |
| Ctrl+Shift+W | Cerrar sesión |
| Ctrl+Shift+Z | Dormir o despertar |
| F2 | Renombrar |
| Ctrl+Shift+F | Buscar en la terminal |
| Ctrl+Shift+G | Ver los cambios del proyecto |
| Ctrl+= / Ctrl+- / Ctrl+0 | Tamaño de la fuente |
| Ctrl+Shift+B | Barra lateral completa o riel de íconos |
| Ctrl+Shift+1 / 2 / 3 / 4 | Ver 1, 2, 3 o 4 terminales |
| Ctrl+Alt+Flechas | Pasar de un panel a otro |
| Ctrl+, | Ajustes |
| F11 | Pantalla completa |

## Organizar

- Doble clic o F2 para renombrar, en la barra o en la pestaña.
- Clic derecho en una sesión o un proyecto: color, mover, dormir, cerrar.
- Arrastra para reordenar sesiones y proyectos, o suelta una sesión sobre otro proyecto para moverla.
- Al dividir, cada panel nuevo te deja elegir qué mostrar. Nada se abre solo.
- Arrastra una sesión desde la barra, una pestaña o la cabecera de un panel. Sobre el centro de un panel la reemplaza; cerca de un borde aparece un círculo con un más y la suma de ese lado, hasta 4 paneles.
- La X de una pestaña o de la cabecera de un panel solo deja de mostrarla, como en un editor: la sesión sigue en la barra lateral, con su proceso. Un clic en la barra la vuelve a abrir.
- Para cerrar una sesión de verdad: clic derecho, "Cerrar esta sesión", que pregunta antes, o el atajo, que avisa con Deshacer.
- Arrastra la línea entre dos paneles para cambiarles el tamaño. Con doble clic vuelven a partes iguales.
- Clic en un proyecto para colapsarlo. Si tiene algo pendiente, se ve en su cabecera.
- Mover una sesión de proyecto no cambia su carpeta: Claude guarda la conversación por carpeta.

## Ver qué cambió

El botón **Cambios** de la barra de pestañas (Ctrl+Shift+G, o clic derecho en el proyecto) abre un panel con los archivos que difieren del último commit de Git: modificados, nuevos, borrados y renombrados, con cuántas líneas se agregaron y quitaron. Es de solo lectura.

- Las líneas nuevas van con fondo verde y las quitadas con fondo rojo. Además una agregada solo tiene número en la columna derecha, y una quitada solo en la izquierda. Si prefieres ver también los signos, enciende "Mostrar + y − en los cambios" en Ajustes.
- "Lo cambiado" muestra solo las zonas con cambios, y "Todo el archivo" el archivo entero.
- Es un panel como los demás: se arrastra por su cabecera a un borde para ponerlo al lado o debajo, se cierra con su X y sigue ahí al reabrir Hilo.
- Se actualiza solo al mostrarse, al volver a la ventana y cuando termina una sesión de ese proyecto. Oculto no gasta nada.
- Un archivo renombrado a mano y sin `git add` aparece como uno borrado y uno nuevo.

**Abrir en tu IDE.** Un clic en un número de línea abre ese archivo en esa línea. Cada proyecto recuerda su IDE: Hilo busca los instalados (NetBeans, VS Code, Cursor, IntelliJ y familia, Visual Studio, Eclipse, Sublime Text, Notepad++), y si el tuyo no sale puedes elegir su `.exe`. Se abre en su propia ventana. Visual Studio y Eclipse no dejan pedir una línea desde fuera: abren el archivo y Hilo te dice cuál era.

## Qué toca en tu sistema

- Su única conexión a internet es con GitHub, para buscar y bajar versiones: una vez al abrir, si no la apagas, y cuando lo pides. No hay telemetría ni fuentes remotas, y no se envía nada aparte de pedir esos archivos. Claude Code se conecta por su cuenta, como en cualquier terminal.
- Sin firma todavía: una actualización se comprueba contra el sha512 que publica GitHub, por HTTPS. Protege de una descarga dañada, no de que alguien tome la cuenta de GitHub.
- Nunca lee tu token ni tus credenciales.
- No toca tu configuración global de Claude Code. Los hooks de estado van solo a las sesiones que abre Hilo, con `claude --settings`. El hook escribe únicamente el nombre del evento en un archivo de `%APPDATA%\Hilo\hooks`; no lee tu prompt ni tus comandos. Se puede apagar en Ajustes.
- Sí lee, sin modificarlo, `~/.claude/sessions/<pid>.json` de sus propias sesiones, para saber cuándo una sesión dejó de esperarte.
- El panel de cambios usa tu Git, solo para leer: no agrega, no revierte y no escribe en el repositorio, y no ejecuta nada de lo que pida la configuración del repositorio. Los filtros de Git quedan anulados, así que los archivos de Git LFS no se comparan bien.

- `conpty.node` de node-pty está recompilado con un arreglo: sin él, la app se caía si dos procesos salían a la vez. El código está en `vendor/node-pty/`.

## Desarrollo

Ver [CONTRIBUTING.md](../CONTRIBUTING.md) y [CLAUDE.md](../CLAUDE.md). Decisiones en [DECISIONES.md](DECISIONES.md), auditoría y números de RAM en [AUDITORIA.md](AUDITORIA.md).
