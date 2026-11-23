# 2026-11-23 · @dedalexcr7 · agrandar un panel un momento

- **Qué se hizo:** idea 24 del CSV. Con 2 o más paneles, un botón en la cabecera de cada panel (esquinas hacia fuera) lo agranda a toda la ventana; otro clic lo devuelve. Mientras tanto, la cabecera muestra «N paneles ocultos». Sin atajo.
  - El estado vive solo en `Workspace` (`useState`): no pasa por el store, ni por la lista blanca, ni por `state.json`. El árbol y `ui.panes` no cambian.
  - La lógica pura está en `src/shared/paneZoom.ts` (`startZoom`, `zoomedPane`, `zoomRects`). Recuerda el contenido del panel, el proyecto y el reparto (`panes` + `tree`) de ese momento: si cualquiera cambia, o el panel activo ya no es ese, se devuelve sola. Eso cubre cerrar la sesión, cambiar el reparto, cambiar de panel y cambiar de proyecto.
  - Los demás paneles quedan con `display: none` y su terminal se **estaciona** (`detach`, sin WebGL) en vez de desmontarse: la entrada de xterm no se recrea, conserva su tamaño y el proceso no recibe ningún aviso. Al devolver, `attach` la ajusta al mismo tamaño de antes y tampoco avisa. Solo la agrandada avisa, una vez al agrandar y otra al volver (con el retardo de 120 ms que ya existía).
  - Los divisores no se dibujan mientras hay un panel agrandado.
- **Commits / PR:** sin PR (rama local `feature/idea-agrandar-panel`).
- **Probado:** `tests/unit/paneZoom.test.ts` (9) y `tests/e2e/agrandar.spec.ts` (3): mismo `ui`, foco, texto y tamaños tras agrandar y devolver; `generation` de cada terminal igual; WebGL 3 → 1 → 3; el proceso recibe exactamente un aviso por transición y solo de la agrandada; agrandar uno no activo lo activa; cerrar la agrandada y cambiar el reparto la devuelven; con un panel no hay botón. `split.spec.ts` y `organize.spec.ts` siguen en verde.
- **Sin verificar:** a mano con Claude real (reimpresión de lo reciente al cambiar de tamaño); cambiar de proyecto con una agrandada (solo cubierto por la prueba unitaria de `zoomedPane`); lectores de pantalla.
- **Queda pendiente (decide el dueño):**
  - Atajo: no se puso. Si se quiere, hay que elegir uno que no esté en `docs/investigacion/R4-atajos.md`, y entraría como acción nueva en `shortcuts.ts` (visible en Ajustes).
  - Doble clic en la cabecera como alternativa al botón (hoy no hace nada, pero la cabecera se arrastra).
  - Recordar la ampliación al reiniciar: no, por diseño (es «un momento»).
  - Si cambiar el reparto o cerrar un panel oculto debe devolverla: hoy sí, cualquier cambio de `panes` o `tree`.
  - Alternativa descartada: ocultar con `visibility` y dejar WebGL cargado; incumple la regla de WebGL solo en lo visible.
