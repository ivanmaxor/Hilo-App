# 2026-11-23 · @dedalexcr7 · rutas.spec: el Escape del diálogo del IDE se perdía

- **Qué pasó:** `rutas.spec.ts` volvió a caer en el CI (en los PR #34 y #40 y una vez en mi PC con la suite completa) con `locator.click: Timeout 30000ms exceeded` y `<div class="backdrop"> intercepts pointer events`.
- **Causa:** tras el Ctrl+clic que abre el diálogo para elegir IDE, la prueba pulsaba Escape en cuanto el estado decía `type: ide`. El diálogo pone su escucha de Escape en un `useEffect`, que corre después de dibujarlo, y reparte el foco al terminar de buscar IDEs. Con la máquina cargada el Escape llegaba antes, se perdía y el fondo del diálogo tapaba el clic siguiente (el botón de abrir la carpeta). Es la misma trampa que ya está en `aprendizajes.md` para los diálogos.
- **Arreglo:** se pulsa Escape dentro de un `toPass` hasta que el fondo del diálogo desaparece. Solo cambia la prueba; la app no cambia.
- **Probado:** la prueba sola, repetida varias veces, y con la suite completa.
- **Sin verificar:** que el CI quede en verde (se ve al abrir el PR).
