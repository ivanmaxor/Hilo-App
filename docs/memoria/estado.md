# Estado

Actualizado: 2026-11-26.

## Versión publicada

**1.4.1** (25-nov-2026), en las Releases de este repo: perfil de la sesión con bitácora (D39), rutas relativas desde el repositorio y las carpetas de la persona, y el resumen del día (D38). La 1.4.0, del mismo día, fue la primera firmada (D36); la guía de prueba del Issue #54 sigue pendiente y sirve para las dos. Con esta, cada instalación en la 1.4.0 hace la primera actualización firmada real.

Lo que trae cada versión está en `src/shared/changelog.ts` y se ve en Ajustes > Novedades.

Hilo se actualiza sola desde las Releases y la usan personas reales todos los días: lo que se publica les llega. Por eso las versiones las saca solo el dueño (ver [colaboracion.md](colaboracion.md)).

## Desde el 2026-11-23: un solo repo

Hasta la 1.3.9 el código se escribía en un repo privado y se copiaba aquí limpio con un script. Desde ahora **este repo es la única fuente de verdad**: los dos colaboradores trabajan aquí con PR. El historial anterior no está en este repo.

## Pruebas e2e

El CI corre las e2e en `windows-latest` (143 pasan y 19 se omiten: las de Claude real y las de red). Las tres que fallaban a veces eran carreras de tiempo de las pruebas, no fallas de la app (#3):

- `pestanas`, "cerrar desde el menú": Escape llegaba antes de que el diálogo lo escuchara. Ahora espera a que "Cancelar" tenga el foco.
- `leak`, "libera la terminal": el atajo de cerrar ignora una pulsación a menos de 800 ms de la anterior, y la prueba pulsaba antes. Ahora espera esa ventana.
- `organize`: en un PC sin Claude (como el runner) sale el diálogo de requisitos y tapa los clics. Ahora marca `setupSeen`.
- `ajustes-scroll`: falló 2 veces en tanda, pero no se pudo reproducir en más de 50 corridas. Sin cambios; si vuelve a fallar, abrir un Issue con el log.
- `leak`, otra vez (CI del #30): la pulsación llegó a la app dentro de los 800 ms de la anterior, porque el reloj de la prueba no es el de la app. Ahora, si la sesión sigue activa y nadie la cierra, la prueba pulsa otra vez.
- `cambios`, "vive en el árbol": se colgó una vez bajo la carga de 4 suites completas a la vez, y pasó 24 de 24 al repetirla. No reproducido.
- `rutas`, el diálogo del IDE (#46): un Escape demasiado pronto se perdía y el fondo del diálogo tapaba el clic siguiente. Ahora insiste hasta que el diálogo se cierra.
- `split`, arrastrar (#48): con carga, Chromium a veces no arranca el arrastre. Ahora lo comprueba y repite el gesto, soltando fuera de la fila.

Para probar como el CI en un PC que sí tiene Claude: `HILO_TEST_TOOLS='{"claude":null,"git":null}' npx playwright test`. Al leer resultados de Playwright, no filtrar líneas: un filtro escondió fallas una vez.

## Nunca probado con personas

- Apagado real de Windows con sesiones abiertas.
- Teclado español físico (AltGr).
- Varias pantallas.
- Clic en una notificación real de Windows.
- Pegar una imagen real, y `/copy` dentro de Claude.
- Abrir en un IDE real (NetBeans y los demás solo con pruebas).
- El 35 % de velocidad del touchpad no se calibró con hardware real.
- Clic en una ruta de la terminal con el Explorador y un IDE reales (#10): las pruebas anotan lo que se abriría.
- Enviar la última respuesta a otra sesión (#42) y los comentarios del diff (#44) con Claude real: las pruebas usan una sesión falsa.
- La pantalla clásica de Claude (1.3.7) y cómo suenan los sonidos (1.3.8 y 1.3.9) en parlantes reales.

## Lo que se sabe que falta

- **Las actualizaciones van firmadas desde la 1.4.0** (D36), con Ed25519 y sin certificado de Windows: SmartScreen sigue avisando al instalar Hilo por primera vez. Las claves privadas están en la carpeta privada del dueño; si se pierden las dos, nadie se actualiza solo.
