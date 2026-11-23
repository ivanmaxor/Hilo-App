# 2026-11-23 · @dedalexcr7 · e2e estables y en el CI (#3)

- **Qué se hizo:**
  - Se reprodujeron las fallas repitiendo las pruebas: 8 de 10 corridas de `leak` + `pestanas` + `ajustes-scroll` fallaban en este PC.
  - `pestanas`: Escape llegaba antes de que el diálogo lo escuchara (el escucha se registra en un efecto). Ahora espera el foco de "Cancelar".
  - `leak`: la app ignora el atajo de cerrar si se repite antes de 800 ms, y la prueba pulsaba antes. Se vio gracias a un diagnóstico que la prueba deja al fallar (estado de la app, diálogos, avisos y foco). Mi primera hipótesis, el aviso "otra vez la termina", estaba equivocada y se quitó.
  - `organize`: en un PC sin Claude sale el diálogo de requisitos y tapa los clics. Solo pasaba en el runner del CI; se reprodujo en este PC con `HILO_TEST_TOOLS` sin Claude ni Git.
  - `ajustes-scroll`: no se pudo reproducir; sin cambios.
  - El CI corre `npm run e2e` en `windows-latest` y sube `test-results/` si algo falla.
- **Commits / PR:** PR de `Closes #3`, rama `chore/3-e2e-estables`.
- **Probado:**
  - `leak`: 24 de 24 corridas con 4 procesos en paralelo (antes, 3 de 4 suites completas fallaban en `leak` con esa carga).
  - Suite completa: 10 de 10 en verde en este PC (5 ejecutores en paralelo, 12 minutos), y 3 de 3 con el entorno del CI simulado.
  - CI de GitHub en `windows-latest`: 89 pasaron, 16 omitidas, 0 fallos, en 5,1 minutos.
- **Sin verificar:**
  - Que el CI se mantenga estable en muchas corridas seguidas: se vio verde una vez con los arreglos. Si una e2e falla al azar, bajar el artefacto `test-results` y abrir un Issue.
  - `ajustes-scroll` y `cambios` ("vive en el árbol") fallaron cada una una vez y no se pudieron reproducir.
  - Un cambio de la app no hizo falta: todo fue en las pruebas. Si una persona pulsa Escape o el atajo de cerrar dentro de esas ventanas, no pasa nada grave.
- **Queda pendiente:** abrir un Issue si alguna de las dos fallas sin reproducir vuelve a aparecer.
