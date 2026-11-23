# Bienvenida para colaboradores

Pasos para sumarse a Hilo con tu propio Claude Code. Cada uno se hace una vez.

## 1. GitHub con el correo privado

- `gh auth status`. Si no hay sesión: `gh auth login` (GitHub.com, HTTPS, con el navegador) y después `gh auth setup-git`, para que Git use esa sesión al subir.
- En GitHub, **Settings > Emails**, activa "Keep my email addresses private" y "Block command line pushes that expose my email". Ahí aparece tu correo noreply (`<número>+<usuario>@users.noreply.github.com`): es el que va en tus commits.

## 2. La invitación y el repo

- Acepta la invitación del correo, o desde `https://github.com/ivanmaxor/Hilo-App/invitations`.
- `gh repo clone ivanmaxor/Hilo-App` en una carpeta tuya, y dentro:

  ```
  git config user.name <tu usuario>
  git config user.email <tu correo noreply>
  ```

## 3. Que corra en tu PC

Necesitas Windows, Node.js 22 o más nuevo y Git.

```
npm ci
npm run typecheck
npm test
npm start            # abre la app
```

Las e2e abren la app con la ventana oculta y sus propios datos: no tocan tus sesiones. Para probar que andan, por ejemplo `npx playwright test tests/e2e/organize.spec.ts`.

## 4. Leer antes de cambiar algo

`CLAUDE.md` (las reglas; ya incluye `estado.md` y `aprendizajes.md`), [colaboracion.md](colaboracion.md), [roadmap.md](roadmap.md), las últimas [sesiones/](sesiones/) y las decisiones recientes de `docs/DECISIONES.md`. El manual de la app está en `docs/MANUAL.md`.

## 5. Opcional: tu lista personal

Si quieres que tus commits se revisen contra palabras tuyas (tu nombre, tus correos, nombres de tus otros proyectos), escríbelas en un archivo **fuera del repo**, una por línea, y crea `.git/hooks/pre-commit`:

```sh
#!/bin/sh
node scripts/check-privacy.mjs --staged --terms "/ruta/fuera/del/repo/terminos.txt"
```

## 6. Primera práctica

Revisa un PR abierto y chico: `gh pr list`, `gh pr checkout <N>`, pruébalo, y deja tu revisión con `gh pr review <N> --approve` o `--comment -b "…"`.

## 7. Primer aporte

Elige un Issue (`gh issue list`), asígnatelo y sigue el flujo de [colaboracion.md](colaboracion.md): rama, commits sin firmas de IA, PR con la plantilla y `Closes #N`. Al terminar la sesión, deja tu archivo en [sesiones/](sesiones/).
