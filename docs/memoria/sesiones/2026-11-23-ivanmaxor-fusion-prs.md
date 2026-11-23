# 2026-11-23 · @ivanmaxor · Fusión de los PR abiertos y arreglos tras la lectura de @dedalexcr7

- **Qué se hizo:**
  - A pedido del dueño, se aprobaron y fusionaron #21, #20 y #23, en ese orden. A #20 y #23 se les trajo `main` antes: el único choque era `aprendizajes.md`, y quedaron las líneas de todos.
  - Se corrigió lo que @dedalexcr7 vio al leer #17, #18 y #19 (detalle en el #13):
    - #17: título de Claude anclado al inicio y sin reformatear `oscScanner.ts`.
    - #18: frase del manual.
    - #19: reemplazo seguro del sonido propio, mismo volumen que los sintetizados, umbrales menores ya avisados, `usage:listen` y sus unitarias.
  - #17, #18, #2 y #19 se fusionaron con el bypass del dueño, sin esperar el CI de cada uno: el dueño pidió probar en local. #24 trae `main` con D34 y D35 juntas.
  - Respuesta en el #13: aprobada la primera tanda de ideas (2, 24, 23 y 9) con sus detalles, y la segunda (5, 1 y 19) para después.
- **Commits / PR:** #21, #20, #23, #17, #18, #2, #19 y #24.
- **Probado:** las cinco ramas del dueño juntas sobre `main` (ya con #21, #20 y #23), en local: typecheck, 317 unitarias, privacidad y las e2e completas (97 pasan, 18 se omiten). El árbol de #24 es el mismo que se probó.
- **Sin verificar:** las ideas de @dedalexcr7 sobre el `main` nuevo; las trae él al abrir cada PR.
- **Queda pendiente:** el #7 (de @dedalexcr7), del que depende la 1.4.0, y el #9, que espera sus datos.
- **Después: `main` quedó en rojo y se arregló.** Se fusionaron #18 y #24 con bypass sin mirar su CI, que fallaba:
  - `rutas.spec.ts`: en el runner, la línea con la ruta se partía dentro de "mi informe.md" y la prueba no la encontraba. Ahora la prueba parte la línea ahí a propósito, y `pointAt` une las filas. La versión vieja falla así en local; la nueva pasa.
  - `organize.spec.ts`, "cerrar con deshacer": al deshacer, la sesión vuelve a quedar activa y despierta (`wakeOnSelect`), y mirar `asleep` justo ahí era una carrera. Ahora espera que quede activa y en `idle`. Pasó 4 de 4 sin Claude ni Git, como en el CI.
  - `organize.spec.ts`, "crear, renombrar…": al elegir PowerShell el nombre por defecto llega un momento después, y en el CI caía entre que Playwright selecciona el campo y escribe ("PowerShellCuatro"). Ahora la prueba espera ese nombre antes de escribir.
