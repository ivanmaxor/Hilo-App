# 2026-11-25 · @ivanmaxor · Versión de prueba 1.4.0-rc.1

- **Qué se hizo:** se publicó la 1.4.0-rc.1 como versión de prueba (`--prerelease`), firmada con la clave principal. La guía de prueba está en el Issue #54, fijado.
- **Commits / PR:** #53 (versión `1.4.0-rc.1`, y la prueba de `publish-release.mjs` ahora pasa `--prerelease` cuando la versión es de prueba: si no, se cortaba antes de lo que comprueba).
- **Probado:** unitarias, typecheck y el CI del #53. Instalador armado desde `main` y revisado con la lista personal (0 coincidencias). La firma se verificó contra las claves de Hilo antes de subirla.
- **Sin verificar:** instalarla encima de la 1.3.9, y todo lo de la guía #54. La primera actualización firmada real será pasar de esta versión a la 1.4.0 final.
- **Después, el mismo día:** el dueño pidió publicar la 1.4.0 final sin esperar la prueba con personas. Se publicó firmada desde el mismo código que la rc.1 (solo cambia el número de versión).
- **Queda pendiente:** probar la 1.4.0 con la guía #54, y comprobar la primera actualización firmada real con la versión siguiente.
