# 2026-11-23 · @ivanmaxor · Actualizaciones firmadas

- **Qué se hizo:** #4, ver D36. Hilo verifica con Ed25519 la firma del instalador antes de ofrecer instalarlo, y vuelve a comprobar el archivo justo antes de lanzarlo. `publish-release.mjs` firma con `--key` y sube la firma. Dos claves (principal y reserva), creadas con `scripts/update-signature.mjs nueva` en la carpeta privada del dueño.
- **Commits / PR:** el PR que cierra #4.
- **Probado:**
  - Unitarias en `tests/unit/update-signature.test.ts`: verificación, firmas y claves rotas, nombres con rutas, y el script (no pisa claves, no firma con una de dentro del repo ni con una que Hilo no acepte).
  - e2e `updates.spec.ts`: el servidor de prueba firma; la prueba nueva comprueba que no se instala sin firma, con otra clave ni con un `latest.yml` cambiado que apunta a otro instalador, y que lo firmado sí. Las 12 en verde.
  - `publish-release.mjs --dry-run` con una Release falsa: sin `--key` no sigue; con la clave principal firma, y Hilo acepta esa firma.
- **Sin verificar:** una actualización real desde GitHub con firma: será la primera versión después de la 1.4.0. La 1.3.x → 1.4.0 no verifica.
- **Queda pendiente:** que el dueño respalde la clave de reserva fuera de este PC.
