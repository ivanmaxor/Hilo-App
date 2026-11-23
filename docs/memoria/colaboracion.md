# Cómo se trabaja

## Quiénes

- **@ivanmaxor**, dueño. Es el único que aprueba cambios para `main`, saca versiones y cambia la configuración del repo.
- **@dedalexcr7**, colaborador.

Cada uno trabaja con su propio Claude Code. Lo que un Claude sabe del proyecto tiene que estar en el repo (`CLAUDE.md`, `docs/memoria/`, `docs/DECISIONES.md`), no solo en su sesión.

## De una idea a `main`

1. **Issue.** Toda idea, error o mejora es un Issue. Quien la va a hacer se lo asigna **antes** de empezar (`gh issue edit N --add-assignee @me`), así nadie hace lo mismo dos veces. Etiquetas: tipo (`bug`, `enhancement`, `documentation`), prioridad (`prioridad: alta/media/baja`) y `decide el dueño` cuando hay algo que elegir. Cada Issue va al hito de la versión en que debería salir.
2. **Rama.** Una por Issue, desde `main` actualizado: `fix/12-scroll-touchpad`, `feature/15-explorador`, `docs/…`, `chore/…`.
3. **Commits.** Chicos, en español, con un mensaje que diga qué y por qué. **Sin firmas de IA:** nada de `Co-Authored-By` ni "Generated with". Con el correo **noreply** de GitHub (ver Privacidad).
4. **PR.** Uno por Issue, chico. La plantilla pide qué pruebas se corrieron, capturas y **qué quedó sin verificar**. En el cuerpo va `Closes #N`: GitHub solo cierra el Issue con palabras en inglés (con "Cierra #N" queda abierto).
5. **Revisión.** El CI tiene que estar en verde, y cada PR necesita la aprobación de @ivanmaxor (`.github/CODEOWNERS`). Nadie aprueba su propio PR: los PR del dueño los revisa @dedalexcr7 cuando puede, aunque esa aprobación no es obligatoria. Si llegan commits nuevos a un PR aprobado, la aprobación se anula y hay que volver a aprobar.
6. **Fusión.** Se fusiona con *squash*: un commit por PR en `main`, y la rama se borra sola.

`main` está protegida: sin push directo, sin force push y sin borrarla. Los tags `v*` solo los puede crear el dueño.

## Lo que decide el dueño

Cuando hay que elegir diseño, números o comportamiento, el PR (o el Issue) trae 2 o 3 opciones con capturas o una tabla, lleva la etiqueta `decide el dueño` y no se fusiona hasta que él elija. Los arreglos claros no necesitan esa vuelta.

## Pruebas

- Antes del PR: `npm run typecheck`, `npm test` y las e2e de lo que se tocó (`npx playwright test tests/e2e/<archivo>`). El CI corre privacidad, typecheck, unitarias y build en Windows.
- **Varios PR juntos:** antes de fusionarlos, se juntan en una rama local, se corren todas las pruebas, se fusionan en orden y se vuelve a probar `main`. PR que pasan por separado pueden chocar juntos.
- **Las pruebas no tocan lo real.** Cada una usa su propia carpeta de datos (`launch()` en `tests/e2e/helpers.ts`), la ventana va oculta (`HILO_TEST_HIDDEN`), y nunca tocan la configuración de Claude ni las sesiones de quien usa el PC. Las PowerShell de las e2e son falsas; para una real, `env: { HILO_TEST_SHELL: '' }`.
- **Reportes honestos:** cada PR y cada Release dicen qué se probó con personas, qué solo con pruebas automáticas y qué no se probó.

## Versiones

Solo el dueño saca versiones, porque le llegan solas a los usuarios.

1. **PR de versión** (`chore/version-1.4.0`): sube `version` en `package.json` y `package-lock.json`, y escribe su entrada en `src/shared/changelog.ts` (una prueba lo exige). El borrador sale de `node scripts/novedades.mjs`, que lista los PR fusionados desde la última versión.
2. Con ese PR fusionado y `main` limpio: `npm run dist`, luego `node scripts/scan-installer.mjs --terms <lista personal> --except "<nombres comunes>"`, y al final `node scripts/publish-release.mjs --notes-file <notas>`.
3. **Versión de prueba antes de la final:** `1.4.0-rc.1` en `package.json` y `publish-release.mjs --prerelease`. A los usuarios no les llega: el actualizador tiene `allowPrerelease = false` y además rechaza todo lo que no sea `x.y.z` (`isStableVersion`). Los dos la instalan a mano desde la Release.
4. **Guía de prueba** en un Issue fijado por cada versión de prueba: cada cambio con en qué fijarse al usarla, y respuestas con ✅ / ⚠️ / ❌. Cada ⚠️ o ❌ se vuelve un Issue nuevo.

## Mensajes entre sesiones

Se dejan como comentarios en el Issue o el PR: le llegan por correo a la otra persona, y su Claude los lee con `gh issue view N --comments` o `gh pr view N --comments`. Si el mensaje es largo, conviene dejar también una copia en un archivo, para pegarlo sin que se corten las líneas.

## Privacidad

Nada personal de nadie entra al repo: correos personales, nombres de usuario de Windows en rutas, claves, ni datos de otros proyectos.

- **Correo noreply.** En GitHub, Settings > Emails: "Keep my email addresses private" y "Block command line pushes that expose my email". En el repo: `git config user.email <id>+<usuario>@users.noreply.github.com`.
- **`npm run privacy`** (`scripts/check-privacy.mjs`) busca correos que no sean noreply, rutas tipo `C:\Users\<nombre>` y claves. Lo corre el CI en cada PR.
- **Lista personal:** cada uno puede tener una lista de términos propios **fuera del repo** y revisarla antes de cada commit con un hook local, que no se sube:

  ```sh
  # .git/hooks/pre-commit
  #!/bin/sh
  node scripts/check-privacy.mjs --staged --terms "/ruta/fuera/del/repo/terminos.txt"
  ```
