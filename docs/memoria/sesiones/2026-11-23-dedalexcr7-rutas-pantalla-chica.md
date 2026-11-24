# 2026-11-23 · @dedalexcr7 · rutas.spec falla en el CI con una pantalla chica

- **Qué pasó:** `tests/e2e/rutas.spec.ts` (de #24) falla en el CI de `main` con `no está en la terminal: mi informe.md`, y deja en rojo todos los PR. Pasa en un PC normal.
- **Causa (reproducida):** la ventana de prueba mide 1200 px y en el runner (pantalla de 1024 px) se recorta. La línea `Informe en <carpeta temporal>\docs\mi informe.md listo` mide casi 100 caracteres con la carpeta temporal del runner y se parte en dos filas; la prueba busca el texto fila por fila y `mi informe.md` queda cortado. En local, con una ventana de 1000 o 1024 px y letra de 14 px, falla igual; con 900 px no, porque el salto cae en otro sitio.
- **Arreglo:** la prueba pone la letra en 9 px (el mínimo permitido), con lo que la línea entra entera en 1000 y 1024 px. No cambia la app. Comprobado: con ventana de 1000 y 1024 px, falla con letra 14 y pasa con letra 9.
- **Sin verificar:** que el CI pase de verdad (se ve al abrir el PR). `organize.spec.ts:136` también cae en el CI de `main` (`Expected: "asleep", Received: "idle"` tras deshacer el cierre de una sesión), pasa siempre en local y no se pudo reproducir: no se tocó.
