# 2026-11-23 · @dedalexcr7 · cambiar de sesión recortaba las líneas completas (#11)

- **Qué se hizo:**
  - Se encontró por qué, tras cambiar de sesión, quedaban líneas cortas sueltas (por ejemplo el borde inferior de la caja de Claude con 88 columnas en vez de 94). `controller.ts` llama a `terminals.applySettings` en cada actualización del estado, porque el objeto `settings` llega nuevo cada vez por IPC. `applySettings` reajustaba todas las terminales, también las estacionadas. Una terminal estacionada usa el renderer de DOM, cuyas celdas miden distinto que con WebGL, y salía con 88 columnas en vez de 94. Con `windowsPty: conpty`, xterm.js recorta las columnas que sobran en vez de reajustar el texto, así que cada línea completa perdía su final y no reaparecía al volver a 94. El proceso no se enteraba (el tamaño final coincidía) y Claude no la redibujaba.
  - `applySettings` solo reajusta si cambió algo que altera cuántas columnas caben (tipo de letra, tamaño, interlineado, barra de desplazamiento) y solo una terminal que está en un panel. Una terminal oculta conserva su tamaño y se ajusta al engancharla.
  - Cambio de comportamiento: antes una terminal oculta seguía el zoom mientras estaba oculta; ahora se ajusta al volver a verla. La prueba de `organize.spec.ts` se actualizó para describirlo.
- **Commits / PR:** rama `fix/11-terminal-oculta-sin-reajuste`.
- **Probado:**
  - `tests/e2e/cambio-de-sesion-no-recorta.spec.ts` (nueva): falla antes del cambio (14 redimensionados de xterm en 3 ciclos de cambiar de sesión) y pasa después (0, y la línea completa no se recorta).
  - Con Claude real dentro de una PowerShell de Hilo (experimento, no queda en el repo): antes, tras cambiar de sesión el borde inferior de la caja quedaba en 88 columnas; después, los dos bordes miden 94 en los 6 pasos y no se manda ningún aviso de tamaño al proceso.
  - `npm run typecheck`, `npm test` (295), `npm run privacy` y las e2e `organize`, `split`, `restore`, `ajustes-scroll`, `clipboard`, `marcas` y `close`: 52 de 52.
  - Dos suites completas: solo fallan `leak` y `pestanas`, que arregla el PR #21.
- **Sin verificar:**
  - Si esto explica también el texto que se ve una fila más abajo del `❯` en alguna captura: no se pudo reproducir.
  - La caja de Claude que queda a media pantalla con el hueco debajo tras abrir y cerrar la lista de `/` **no es de Hilo**: pasa igual en Windows Terminal (es del dibujado en línea de Claude Code).
- **Queda pendiente:** decidir con el dueño si una terminal oculta debe seguir el zoom mientras está oculta (no se puede medir bien: el renderer de DOM mide distinto que WebGL).
