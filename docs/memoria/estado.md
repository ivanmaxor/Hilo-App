# Estado

Actualizado: 2026-11-23.

## Versión publicada

**1.3.9** (22-nov-2026), en las Releases de este repo. Lo que trae cada versión está en `src/shared/changelog.ts` y se ve en Ajustes > Novedades.

Hilo se actualiza sola desde las Releases y la usan personas reales todos los días: lo que se publica les llega. Por eso las versiones las saca solo el dueño (ver [colaboracion.md](colaboracion.md)).

## Desde el 2026-11-23: un solo repo

Hasta la 1.3.9 el código se escribía en un repo privado y se copiaba aquí limpio con un script. Desde ahora **este repo es la única fuente de verdad**: los dos colaboradores trabajan aquí con PR. El historial anterior no está en este repo.

## Pruebas que fallan a veces

- `tests/e2e/leak.spec.ts`, "libera la terminal": intermitente desde la 1.2.2, sin diagnóstico.
- `tests/e2e/pestanas.spec.ts`, "cerrar desde el menú": falló alguna vez en la tanda completa y pasa sola.
- `tests/e2e/ajustes-scroll.spec.ts`: falló 2 veces en tanda y pasó 4 de 4 sola.

Por eso el CI todavía no corre las e2e: solo privacidad, typecheck, unitarias y build. Al leer resultados de Playwright, no filtrar líneas: un filtro escondió fallas una vez.

## Nunca probado con personas

- Apagado real de Windows con sesiones abiertas.
- Teclado español físico (AltGr).
- Varias pantallas.
- Clic en una notificación real de Windows.
- Pegar una imagen real, y `/copy` dentro de Claude.
- Abrir en un IDE real (NetBeans y los demás solo con pruebas).
- El 35 % de velocidad del touchpad no se calibró con hardware real.
- La pantalla clásica de Claude (1.3.7) y cómo suenan los sonidos (1.3.8 y 1.3.9) en parlantes reales.

## Lo que se sabe que falta

- **Las actualizaciones no van firmadas.** Sin certificado (cuesta dinero), la única comprobación es el sha512 de `latest.yml` por HTTPS. Quien pueda editar una Release podría cambiar lo que reciben los usuarios. Ver la idea de firmar `latest.yml` en [roadmap.md](roadmap.md).
- Las e2e no están en el CI (ver arriba).
