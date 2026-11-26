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

Abajo en la barra lateral está cuánto llevas usado de la sesión de 5 horas y de la semana, y cuándo se renueva cada una: verde si te queda más de la mitad, amarillo desde el 50 % usado y rojo desde el 80 %. Claude da el dato al responder, así que aparece después de la primera respuesta y se actualiza con cada una. Con varias sesiones abiertas se muestra el dato más reciente: una sesión que lleva rato quieta no lo pisa con lo que vio antes, por ejemplo, de una restauración del plan. Solo funciona con planes Pro, Max o Ultra.

Lo mismo sale abajo en cada sesión de Claude, en lugar de tu línea de estado. Si prefieres la tuya, apágalo en Ajustes, sección Claude Code. El bloque **Te necesitan**, abajo en la barra lateral, junta todo lo que requiere atención, ordenado por urgencia.

## Ajustes

Con Ctrl+, o el engranaje. Van por módulos: Apariencia, Terminal, Sesiones, Avisos, Claude Code, Cambios, Atajos, Actualizaciones y Novedades. El buscador de arriba encuentra cualquier opción en todos los módulos, y cada módulo tiene "Restablecer este módulo" para volver a los valores de fábrica.

## Sonidos

Hilo suena cuando una sesión termina, te espera (un permiso o una pregunta) o falla. En Ajustes > Avisos eliges un sonido para cada caso, o ninguno, y el volumen. Los marcados como largos duran unos 2 o 3 segundos. **Duración de cada aviso** repite el sonido seguido durante 3 a 30 segundos, y **Repetir** vuelve a avisar cada 1, 2, 5 o 10 minutos; los dos se cortan apenas abres la sesión o le respondes. Por defecto no suena si ya estás mirando esa sesión. Cuando Hilo toca su sonido, la notificación de Windows llega en silencio.

**Tu sonido:** en Ajustes > Avisos > Tu sonido puedes elegir un audio tuyo (mp3, wav u ogg de hasta 2 MB). Hilo guarda una copia en su carpeta, y aparece como "Tu sonido" en cada lista. Si no se puede reproducir, suena la gota y Hilo te avisa.

**Avisos de uso del plan:** Hilo te avisa cuando la sesión de 5 horas o la semana cruzan los umbrales que elijas (50, 75, 80, 90 o 95 %), una vez por umbral en cada ventana, con una notificación, un sonido o los dos. Usa el mismo dato del medidor de la barra lateral, así que necesita "Mostrar el uso del plan" encendido.

Si tenías un hook de sonido propio en la configuración de Claude Code, sigue sonando también en las sesiones de Hilo: Hilo no toca tu configuración. Para oír solo el de Hilo, quítalo de tu `settings.json`.

## Copiar y pegar

| Acción | Cómo |
|---|---|
| Copiar | Ctrl+C con selección, clic derecho con selección, Ctrl+Shift+C o Ctrl+Insert |
| Interrumpir a Claude | Ctrl+C sin selección |
| Pegar | Ctrl+V, Ctrl+Shift+V, Shift+Insert o clic derecho sin selección. En PowerShell, varias líneas piden confirmación porque cada salto ejecuta |
| Pegar imagen | Alt+V, como en tu terminal. Si solo hay imagen en el portapapeles, Ctrl+V también funciona |
| Salto de línea sin enviar | Shift+Enter |
| Copiar uniendo líneas que cortó Claude | Ctrl+Shift+J |
| Copiar el último mensaje de Claude, con el nombre de la sesión delante | Ctrl+Shift+L, o **Copiar respuesta** en la barra de pestañas o en el clic derecho de la sesión |
| Pegar el último mensaje de una sesión en otra, sin enviarlo | Clic derecho en la sesión > **Enviar su última respuesta a…** y elige una sesión de Claude (si está dormida, se despierta). Queda escrito en su cuadro, con «De …» delante, y tú pulsas Enter |

## Rutas y carpetas

Cuando Claude, o cualquier programa, escribe la ruta de un archivo o una carpeta que existe (`src/app.ts:12`, `C:\Proyectos\informe final.pdf`), al pasar el ratón se subraya y abajo aparece qué hace cada clic:

- **Clic:** la muestra en el Explorador de Windows. Una carpeta se abre; un archivo queda marcado en la suya, sin abrirlo ni ejecutarlo.
- **Ctrl+clic:** abre el archivo en el IDE del proyecto, en su línea si venía. Si queda fuera del proyecto, se muestra en el Explorador.

Las rutas relativas se buscan primero desde la carpeta de la sesión, después desde las de arriba hasta la raíz de su repositorio y desde la del proyecto, porque Claude a veces escribe la ruta desde ahí. Las que empiezan por una carpeta tuya (`Documentos/...`, `Escritorio/...`, `Descargas/...`, `~/...`) se buscan en tu carpeta de usuario y en OneDrive. Las de red (`\\servidor\...`) no se tocan.

**Soltar archivos** del Explorador sobre una sesión pega su ruta, sin Enter. En Claude, `@ruta` si está dentro de la carpeta de la sesión, y la ruta completa entre comillas si no. En PowerShell, la ruta completa, entre comillas simples si tiene espacios. Sobre una sesión dormida solo avisa.

El botón de la carpeta, arriba a la derecha, y **Abrir su carpeta** en el menú de una sesión abren la carpeta donde trabaja esa sesión, que puede no ser la del proyecto.

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
- Clic derecho en una sesión, **Marcar como no leída**: queda con su punto y en **Te necesitan** hasta que la abras. **Marcar como leída** quita el verde de "terminó" sin abrirla.
- **Marca**: un emoji delante del nombre, para distinguir las sesiones a tu manera. En **…** hay más, o escribe el que quieras (Win + . abre los emojis de Windows).
- **Dejar una nota**: se lee al pasar el ratón por la sesión y en su panel mientras está dormida. Ctrl+Enter guarda.
- **Color**: además de la paleta, el círculo de colores abre un selector con cualquier color, un campo para pegar un código como `#ff8800` y un botón para copiarlo. Los últimos 6 que elegiste a mano quedan a la vista para otras sesiones.
- Al crear una sesión, **Carpeta** > **Elegir otra…** la deja trabajando en otra carpeta sin salir del proyecto. Después no se cambia: Claude guarda la conversación por carpeta y la retoma ahí.
- Si abres `claude` dentro de una PowerShell de Hilo, esa misma fila pasa a ser una sesión de Claude, en la carpeta donde lo abriste (también después de un `cd`) y en el mismo proyecto. Al despertarla otro día, retoma esa conversación.
- Una sesión de Claude abierta y quieta cambia de color según su último mensaje, tuyo o de Claude: amarillo a la hora, naranja a las 5 horas y rojo al día. Al pasar el ratón dice cuánto hace. Las dormidas no cambian: ya no se están trabajando. Se apaga en Ajustes > Sesiones.
- El ícono de carpeta en la cabecera de un proyecto, o clic derecho, **Abrir la carpeta**, la abre en el Explorador.
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
- Cada actualización viene firmada por quien publica Hilo, y Hilo comprueba la firma antes de ofrecer instalarla. Si alguien cambiara una versión publicada en GitHub, no se instalaría.
- Nunca lee tu token ni tus credenciales.
- No toca tu configuración global de Claude Code. Los hooks de estado van solo a las sesiones que abre Hilo, con `claude --settings`. El hook escribe únicamente el nombre del evento en un archivo de `%APPDATA%\Hilo\hooks`; no lee tu prompt ni tus comandos. Se puede apagar en Ajustes.
- Sí lee, sin modificarlo, `~/.claude/sessions/<pid>.json` de sus propias sesiones, para saber cuándo una sesión dejó de esperarte.
- El panel de cambios usa tu Git, solo para leer: no agrega, no revierte y no escribe en el repositorio, y no ejecuta nada de lo que pida la configuración del repositorio. Los filtros de Git quedan anulados, así que los archivos de Git LFS no se comparan bien.

- `conpty.node` de node-pty está recompilado con un arreglo: sin él, la app se caía si dos procesos salían a la vez. El código está en `vendor/node-pty/`.

## Desarrollo

Ver [CONTRIBUTING.md](../CONTRIBUTING.md) y [CLAUDE.md](../CLAUDE.md). Decisiones en [DECISIONES.md](DECISIONES.md), auditoría y números de RAM en [AUDITORIA.md](AUDITORIA.md).
