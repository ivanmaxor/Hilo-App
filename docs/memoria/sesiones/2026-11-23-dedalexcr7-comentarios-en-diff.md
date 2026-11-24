# 2026-11-23 · @dedalexcr7 · comentarios en el diff para Claude

- **Qué se hizo:** en el panel Cambios, un «+» junto al número de cada línea abre un cuadro para dejar un comentario (Guardar/Cancelar; Ctrl+Intro guarda y Esc cancela, solo dentro del cuadro). Una barra abajo muestra «N comentarios», un selector de sesión, «Enviar a la sesión» y «Descartar». Se pega `archivo:línea: comentario` por cada uno, ordenados por archivo y línea, con el código comentado debajo entre comillas invertidas, y sin Enter: la persona revisa y envía. Ctrl+Intro con el foco dentro del panel también envía (nunca global: es un atajo de Claude Code).
  - `src/shared/diffComments.ts`: función pura que arma el texto (orden, contexto, comillas, caracteres de control, multilínea con sangría, topes).
  - `src/renderer/ui/commentsStore.ts`: comentarios por proyecto y por ruta, solo en memoria.
  - `TerminalManager.pasteTextInto(id, text)`: pasa por el único `paste(entry, given?)` de `main` (el del detector de claves #30 y el arrastre de archivos #32), con `sanitizePaste` y `term.paste()`. Ese `paste` ahora devuelve si llegó a pegarse; solo entonces se quitan los comentarios enviados. No hay un segundo camino de pegado.
- **Decisiones del dueño (@ivanmaxor):**
  - **Solo sesiones de Claude en el selector** de destino: una terminal (PowerShell) no se ofrece aunque esté despierta. Si no hay ninguna de Claude despierta, la barra lo dice y «Enviar» queda desactivado. Nunca se despierta una sesión por enviar.
  - **Los comentarios viven solo en memoria**: no sobreviven a cerrar Hilo y no se guardan en disco ni en `state.json` (lo comprueba una e2e que busca el texto en todos los archivos de datos, antes y después de cerrar).
  - **Pegar con `term.paste()` tras `sanitizePaste()`, sin Enter**, respetando el detector de claves y la confirmación de varias líneas: un comentario con algo que parece una clave pide confirmar, y si se cancela los comentarios siguen pendientes.
- **Commits / PR:** rama `feature/idea-comentarios-en-diff`, PR de `Closes #44`.
- **Probado:** `npm run typecheck`, `npm test`, `npm run privacy`; e2e `cambios-comentarios` (9: pegado sin Enter con una sesión de Claude falsa que ejecuta `sink.cjs`, cancelar/Quitar/Descartar, recarga y cambio de archivo, Ctrl+Intro, sin sesión de Claude despierta, selector solo con Claude, clave que pide confirmar, solo en memoria), y por tocar el panel y el pegado, `cambios`, `clipboard`, `pegar-clave`, `arrastrar-archivos` y `close`.
- **Sin verificar:** con una sesión de Claude real (las e2e usan un `claude.cmd` falso que ejecuta el programa de prueba); teclado y lector de pantalla con personas; tema claro del cuadro y la barra (solo se miró el oscuro).
- **Queda pendiente / decide el dueño:**
  - Una línea quitada se comenta por su número antiguo y se pega como `archivo:N (antes)`.
  - Los comentarios de un archivo que ya no aparece en Cambios se conservan, se avisa en la barra y se envían igual.
