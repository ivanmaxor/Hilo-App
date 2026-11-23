# 2026-11-23 · @ivanmaxor · Rutas clicables en la terminal

- **Qué se hizo:** #10, según la decisión del Issue (ver D35):
  - Las rutas que existen se subrayan al pasar el ratón. Un clic las muestra en el Explorador; Ctrl+clic las abre en el IDE del proyecto, en su línea.
  - Cada sesión tiene "Abrir su carpeta", en su menú y en el botón de la carpeta de arriba.
  - Detección en `src/shared/pathLinks.ts`; resolución y apertura en `src/main/pathOpen.ts`, solo con `stat`.
- **Commits / PR:** el PR que cierra #10.
- **Probado:**
  - Unitarias en `tests/unit/rutas.test.ts`: qué se detecta, qué se rechaza (red, dispositivos, flujos) y rutas con espacios.
  - e2e `rutas.spec.ts`: subrayado, aviso, clic, Ctrl+clic al diálogo del IDE, ruta con espacios, una que no existe, y la carpeta de la sesión desde los dos lugares.
  - Con Claude real (haiku, `claude-rutas.spec.ts`): la ruta que escribe Claude se subraya y el clic la muestra.
  - Las e2e completas, en verde.
- **Sin verificar:** el Explorador y un IDE reales. En modo prueba Hilo anota lo que abriría (`revealedPaths`).
- **Queda pendiente:**
  - Si Claude parte una ruta larga en dos líneas por su cuenta, no se une: solo se une lo que parte la terminal por ancho.
  - Otro PR de hoy (#19) agrega D34 al final de `DECISIONES.md`: al fusionar el segundo de los dos hay que juntar las dos entradas.
