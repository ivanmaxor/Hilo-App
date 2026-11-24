# 2026-11-23 · @ivanmaxor · revisión de los Issues de @dedalexcr7 y reparto de la 1.4.0

- **Qué se hizo:**
  - Se revisaron los Issues #6 a #14, se dejó la decisión del dueño en cada uno y se repartió el trabajo de la 1.4.0 (ver el #13).
  - Se abrieron #15 (Ajustes por módulos) y #16 (texto del menú).
  - Se arreglaron #14 (PR #17) y #16 (PR #18).
- **Hallazgos con Claude Code 2.1.330 y haiku:**
  - `claude --resume <id>` retoma la conversación desde cualquier carpeta, también si la original se borró.
  - `--session-id` con ese id en otra carpeta crea una conversación vacía nueva. Explica el #6 (diagnóstico completo en el Issue).
  - El título al arrancar es `claude`; el ✳ llega con la primera respuesta. Explica el #14.
- **Commits / PR:** #17, #18.
- **Probado:**
  - Unitarias en verde.
  - e2e con Claude real de `carpetas.spec.ts`: fallaba antes del #17 y pasa después.
  - El menú de la sesión mide una línea (captura revisada).
- **Sin verificar:** el #9, que no se reproduce en este PC; faltan datos de @dedalexcr7.
- **Queda pendiente:**
  - #15, #8 y #12 (del dueño).
  - #6, #7 y #3 (de @dedalexcr7).
