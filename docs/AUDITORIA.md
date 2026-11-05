# Auditoría

Auditores independientes (agentes de Claude Code con su propio contexto), sin ver cómo se construyó: recibieron el código y los requisitos, no las conclusiones. Cada ronda se aplicó sobre lo que cambió la anterior. Aquí está el resumen: los informes completos y sus pruebas se quedaron fuera del repositorio público porque traen rutas y capturas del PC donde se hicieron.

## Resultado por ronda

| Ronda | Auditoría | Críticos | Altos | Medios | Bajos |
|---|---|---:|---:|---:|---:|
| 1 | A1 seguridad | 0 | 1 | 2 | 12 |
| 1 | A2 copiar y pegar | 1 | 5 | 5 | 7 |
| 1 | A3 RAM y rendimiento | 0 | 1 | 2 | 7 |
| 1 | A4 UX | 0 | 4 | 16 | 16 |
| 1 | A5 código | 0 | 4 | 12 | 8 |
| 2 | A1 | 0 | 0 | 2 | 10 |
| 2 | A2 | 0 | 1 | 4 | 10 |
| 2 | A4 | 0 | 2 | 11 | 15 |
| 2 | A5 | 0 | 4 | 6 | 12 |
| 3 | A1 | 0 | 1 | 1 | 8 |
| 3 | A2 | 0 | 2 | 5 | 9 |
| 3 | A4 | 0 | 1 | 8 | 13 |
| 3 | A5 | 0 | 1 | 7 | 9 |
| 4 | A2 | 0 | 6 | 6 | 11 |
| 4 | A4 + A1 | 0 | 1 | 7 | 12 |
| 4 | A5 | 0 | 0 | 5 | 18 |
| 5 | Final | 0 | 4 | 4 | 7 |
| 6 | Final | 0 | 1 | 3 | 6 |
| 7 | Comprobación de la ronda 6 | 0 | 2 | 3 | 2 |
| 8 | Comprobación de la ronda 7 | 0 | 3 | 0 | 4 |
| 9 | Comprobación de la ronda 8 | 0 | 2\* | 3 | 1 |

\* Los dos de la ronda 9 quedaron como decisión, no como fallo abierto: ver abajo.

## Lo crítico y lo alto, y cómo se resolvió

**Ronda 1**
- **Crítico. Tras un clic derecho el teclado quedaba muerto.** Copiar o pegar con el ratón dejaba la terminal sin foco. Se cancela el clic derecho antes de que llegue al navegador y se devuelve el foco.
- Una selección de celdas vacías bloqueaba Ctrl+C, un clic en la interfaz perdía el foco, los campos de texto borraban lo pegado. Corregidos, con regresiones.
- WPAD: Chromium buscaba proxy en la red local. `no-proxy-server`.
- Fuga al cerrar con foco: addon-webgl retenía terminal, historial y GPU. Se quita el foco antes de descargar WebGL.
- Guardado que fallaba sin reintentar, interfaz caída sin recuperación, proceso principal bloqueado, Worker de conout muerto sin aviso. Corregidos.
- Sin vista dividida por ratón, atajos que dejaban sorda a la terminal, diálogos sin botones en ventana baja. Corregidos.

**Encontrado al corregir la ronda 1: la app entera se caía con `0xC0000005`** si dos sesiones se cerraban a la vez. Era un fallo de concurrencia de node-pty 1.1.0. Se recompiló `conpty.node` con un cerrojo (D7).

**Ronda 2**
- Tras `/clear` el despertar devolvía la conversación anterior, y Esc en un permiso dejaba "Esperándote" para siempre. Ahora se sigue el id que Claude usa de verdad.
- Un apagado viejo dormía o borraba la terminal de la sesión recién despertada.
- Cerrar y dormir mataban procesos sin avisar en una shell o en una sesión ya terminada.
- Renombrar en modo riel dejaba la app sin foco. "Uniendo líneas" no unía si la selección empezaba en la primera fila.

**Ronda 3**
- Lo tecleado justo tras Ctrl+Shift+W iba a la sesión que se cerraba, y en PowerShell se ejecutaba. Cerrar ahora salta a la vecina al instante (D10).
- Mantener el atajo cerraba una sesión tras otra. Un lanzamiento fallido cerraba la conexión de otra sesión. Espacios dentro de URLs y rutas al unir líneas. Pestañas que cortaban el nombre con espacio libre.

**Ronda 4**
- Teclas retenidas al despertar para pegar, que iban al sitio equivocado y adelantaban al pegado. Una sola cola por terminal.
- Un diálogo de procesos que saltaba a media frase. Ahora es un aviso que no quita el foco, y la sesión sigue abierta.
- Escribir sobre una dormida se perdía o se comía el Espacio. Ahora la despierta y le llega.

**Ronda 5**
- Escribir en una sesión sin proceso: el Espacio pulsaba "Abrir de nuevo" y el resto de la frase se ejecutaba.
- El Enter se perdía si llegaba antes de que Claude atendiera.
- Repetir el cierre tras el aviso cerraba la vecina.
- Palabras pegadas al unir líneas cuando un token entero acababa en el borde.

**Ronda 6**
- Con Claude tardando más de 4 s en arrancar, el Enter retenido llegaba demasiado pronto. Ahora se espera a que atienda, hasta el plazo de arranque de 45 s.

**Rondas 7 y 8**
- Claude activa el bracketed paste unos 18 ms antes de dibujar un diálogo: lo tecleado lo contestaba. Ahora se da un margen antes de entregar, y una frase a medias se descarta con aviso.
- Dos Ctrl+Mayús+W podían cerrar la vecina. Se probó una cola y resultó peor: dejaba valores viejos y cierres tardíos. Se quitó, y una pulsación durante la comprobación se ignora.

**Ronda 9: dos altos que no se trataron como tales, por decisión del líder técnico**
- *Dos Ctrl+Mayús+W a más de 800 ms cierran dos sesiones.* Es lo que se está pidiendo, cada una con su Deshacer. La doble pulsación accidental sí se filtra.
- *Con el diálogo de confianza a la vista, una frase con pausa y Enter lo contesta, y Claude sale.* Es lo que hace cualquier terminal, Windows Terminal incluida (R2): el diálogo está a la vista, solo aparece la primera vez en una carpeta, y solo se pierde esa frase.

Los auditores encontraban ya casos de borde del código añadido en la ronda anterior, y cada arreglo daba para otra ronda. Por eso se paró aquí.

## RAM y rendimiento finales

Private Working Set, mediana de 3 corridas, con el ejecutable empaquetado final (`scripts/measure.mjs`). 9 sesiones de Claude reales con haiku y sin servidores MCP. La comparación con Windows Terminal y el detalle son de A3, con la misma máquina y las mismas sesiones.

| 9 sesiones de Claude en reposo | App | Consolas | Claude | Total |
|---|---:|---:|---:|---:|
| **Hilo** | 117,9 MB | 15,3 MB | 1449 MB | **1583 MB** |
| **Windows Terminal** | 47 a 142 MB | 15,3 MB | 1396 MB | **1458 a 1553 MB** |

- **Windows Terminal da un rango** porque comparte proceso con las pestañas del dueño. El mínimo es lo que crece al abrirlas, y subestima porque el proceso ya tenía todo cargado. El máximo es el proceso entero, con pestañas ajenas.
- **Con 2 trabajando:** Hilo 129,3 MB más 15,4 MB de consolas.
- **Claude es el 91 % del total.** Con la configuración real del dueño, cada sesión lanza además sus 4 servidores MCP: eso pesa más que la app.
- **Historial lleno (3000 líneas en 9 terminales):** Hilo suma unos 67 MB y Windows Terminal unos 16 MB.
- **Una sesión dormida** casi no cuesta: con 9 dormidas la app ocupa 83 MB.
- **Escribir:** 7 a 9 ms de mediana de la tecla al dibujo. Con 250 MB saliendo en otra sesión, 14 ms.
- **Huérfanos:** ninguno al cerrar, al dormir ni al matar la app a la fuerza. Solo sobrevive lo lanzado con `nohup`, igual que en Windows Terminal.
- **Instalar y desinstalar:** comprobado. Desinstalar quita el ejecutable, los accesos directos, las claves del instalador y `%LOCALAPPDATA%\hilo-updater`; conserva `%APPDATA%\Hilo` a propósito.

## Lo que queda abierto

Ningún crítico ni alto, salvo los dos de la ronda 9 explicados arriba. Medios y bajos aceptados:

**Copiar uniendo líneas (Ctrl+Shift+J)** es heurístico y puede equivocarse: una URL cortada justo en su última palabra queda con un espacio, y una lista muy larga puede unirse. Ctrl+C normal no se ve afectado. Por eso se ofrece aparte.

**Mientras Claude arranca**
- En una máquina saturada (24 procesos en 12 núcleos), lo tecleado al despertar se perdió 3 veces de 18, sin aviso y sin causa determinada. Con 12 procesos o menos no falló nunca.
- Si tarda mucho, lo tecleado no se ve hasta que atienda. A los 5 s avisa, y a los 45 s se entrega.

**Teclado**
- La barra lateral no se recorre con Tab: lo frecuente tiene atajo y Mayús+F10 abre el menú de la sesión, pero mover o colorear exige el menú.
- Quitar un atajo de "Ir a la sesión 2-9" no se puede deshacer desde el editor, salvo restaurar todos.

**Procesos**
- Un comando interno largo de PowerShell, como `Start-Sleep`, no tiene proceso hijo: cerrar no avisa.
- Lo lanzado con `nohup` sobrevive a dormir y cerrar, igual que en Windows Terminal.
- `conpty.node`: pierde 2 handles cuando un proceso sale solo y 1 por lanzamiento fallido. Son pocos y se liberan al cerrar la app.

**Seguridad**, sin dar poder a quien no lo tenía ya, porque todo exige escribir como ese usuario:
- La tubería del Worker acepta un solo cliente, pero gana el primero que conecte. Otro proceso del equipo podría dejar una terminal en blanco y leerla.
- `HILO_E2E=1` abre puertas de prueba también en el empaquetado.
- El JS desempaquetado queda fuera de la integridad del asar, y `Hilo.exe` no está firmado.

**Memoria**
- xterm gasta unos 7 MB por cada 3000 líneas de historial llenas, frente a unos 2 MB de Windows Terminal. Es un límite de xterm.
- Con 100 000 líneas por terminal, el máximo de Ajustes, serían unos 190 MB por terminal. El ajuste lo avisa.

## Sin comprobar

No se pudieron probar sin tocar lo prohibido o sin el hardware:
- Un apagado real de Windows. Se simuló. Si Windows matara las consolas más de 3 s antes de cerrar la app, esa sesión no volvería a encenderse sola; la conversación no se pierde.
- Teclado español físico (AltGr, teclas muertas). Playwright simula el de EE. UU.
- Varias pantallas y escalas distintas de 100 %.
- El clic en una notificación real de Windows.
- `/copy` de Claude y una imagen real pegada a Claude, porque usan el portapapeles real.
- El diálogo de confianza real y la advertencia real de permisos: aceptarlos escribe en `~/.claude.json`. Se probaron con un Claude falso que usa el texto exacto.

## Incidentes durante el desarrollo

- **Portapapeles.** Una prueba pisó el portapapeles real con `prueba-portapapeles-real` sin poder restaurarlo. En una auditoría, unas repeticiones de Ctrl+C pudieron dejar `LISTO`. En la investigación, Alt+V seguido de Enter le mandó a Haiku el texto del portapapeles (transcript `59b42861-7925-4215-ab7f-08dfd9f1e6df.jsonl`, sin borrar). Las pruebas ahora usan un portapapeles en memoria y cancelan los eventos nativos.
- **Rastros.** Quedan transcripts de prueba en `~/.claude/projects/` para la carpeta de pruebas del scratchpad, y Claude añadió la confianza de esas carpetas a `~/.claude.json`. No se borraron: son de Claude.
- **Una carga del plugin de Telegram** durante una auditoría, al usar la configuración real unos segundos.
