# 2026-11-24 · @ivanmaxor · Revisar y fusionar los PR de @dedalexcr7

- **Qué se hizo:** revisé, comenté y fusioné el #47 (Escape del diálogo en `rutas.spec`), el #49 (arrastre en `split.spec`), el #43 (enviar la última respuesta a otra sesión) y el #45 (comentarios en el diff). `main` estaba rojo desde el #41 por la carrera de `rutas` que arregla el #47. Respondí las dos preguntas de diseño del #45: la línea quitada se pega como `archivo:N (antes)`, y los comentarios de un archivo que ya no sale en Cambios se conservan.
- **Commits / PR:** este PR suma las dos funciones nuevas a las novedades de la 1.4.0 y pone al día `estado.md`.
- **Probado:** los cuatro PR juntos sobre `main` en local, como el CI (`HILO_TEST_TOOLS='{"claude":null,"git":null}'`): e2e 138 pasan, 19 se omiten y 0 fallan; unitarias 423; typecheck y privacidad. `main`, después de fusionar, es idéntico a lo probado.
- **Sin verificar:** las dos funciones nuevas con Claude real.
- **Queda pendiente:** publicar la 1.4.0 (primero una `1.4.0-rc.1`), que decide el dueño, y el PR del resumen del día de @dedalexcr7.
