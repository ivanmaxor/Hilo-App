# 2026-11-23 · @dedalexcr7 · comentarios en el diff para Claude

- **Qué se hizo:** en el panel Cambios, un «+» junto al número de cada línea abre un cuadro para dejar un comentario (Guardar/Cancelar; Ctrl+Intro guarda y Esc cancela, solo dentro del cuadro). Una barra abajo muestra «N comentarios», un selector de sesión (las del proyecto con terminal viva; por defecto la activa), «Enviar a la sesión» y «Descartar». Se pega `archivo:línea: comentario` por cada uno, ordenados por archivo y línea, con el código comentado debajo entre comillas invertidas, con `sanitizePaste` + `term.paste()` y sin Enter. Ctrl+Intro con el foco dentro del panel también envía (nunca global).
  - `src/shared/diffComments.ts`: función pura que arma el texto (orden, contexto, comillas, caracteres de control, multilínea con sangría, topes).
  - `src/renderer/ui/commentsStore.ts`: comentarios por proyecto y por ruta, solo en memoria (ni disco ni `state.json`).
  - `TerminalManager.paste(entry, given?)` y `pasteTextInto(id, text)`: el mismo camino de pegado que Ctrl+V, pero con un texto de Hilo; ahora devuelve si llegó a pegarse.
- **Commits / PR:** rama local `feature/idea-comentarios-en-diff`, sin PR (el dueño aún no aprobó la idea).
- **Probado:** `npm run typecheck`, `npm test` (311 pasan), `npm run privacy`; `tests/e2e/cambios-comentarios.spec.ts` (5), y por haber tocado el panel y el pegado, `cambios.spec.ts` y `clipboard.spec.ts` completos (39 pruebas, todas verdes).
- **Sin verificar:** con una sesión de Claude real (las e2e usan la shell falsa, que es de tipo terminal); teclado y lector de pantalla con personas; tema claro del cuadro y la barra (solo se miró el oscuro).
- **Queda pendiente / decide el dueño:**
  - El selector lista también las terminales (marcadas «(terminal)»), no solo Claude: así se puede probar con la shell falsa. Alternativa: solo Claude.
  - Los comentarios se pierden al cerrar Hilo (a propósito, en esta primera versión).
  - Una línea quitada se comenta por su número antiguo y se pega como `archivo:N (antes)`.
  - Los comentarios de un archivo que ya no aparece en Cambios se conservan, se avisa en la barra y se envían igual.
