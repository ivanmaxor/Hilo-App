# Memoria del proyecto

Lo que una sesión de Claude Code (o una persona) necesita saber para trabajar en Hilo sin depender de la memoria de nadie. Vive en el repo para que los dos colaboradores, y sus Claude, partan sabiendo lo mismo.

| Archivo | Qué tiene | Cuándo se actualiza |
|---|---|---|
| [estado.md](estado.md) | Versión publicada, qué falta, pruebas inestables, lo que nunca se probó con personas | Al terminar algo que cambie el estado |
| [aprendizajes.md](aprendizajes.md) | Trampas ya resueltas: lo que costó descubrir y no hay que volver a pisar | Cada vez que algo costó más de lo esperado |
| [colaboracion.md](colaboracion.md) | Cómo se trabaja: Issues, ramas, PR, revisiones, versiones y privacidad | Cuando cambia el flujo |
| [roadmap.md](roadmap.md) | Ideas pendientes, propuestas y lo que se descartó, con su porqué | Al proponer o descartar algo |
| [sesiones/](sesiones/) | Un archivo por sesión: fecha, quién, qué se hizo, commits y lo que quedó pendiente | **Al terminar cada sesión** |
| [../DECISIONES.md](../DECISIONES.md) | Cada decisión de diseño (D1, D2…) con su porqué | Con cada decisión nueva |

## Al empezar una sesión

1. `git switch main && git pull`.
2. Lee [estado.md](estado.md) y las últimas entradas de [sesiones/](sesiones/). `CLAUDE.md` ya incluye [aprendizajes.md](aprendizajes.md).
3. Mira los Issues abiertos y asignados: `gh issue list --assignee @me`.

## Al terminar una sesión

Escribe `sesiones/AAAA-MM-DD-usuario-tema.md` (un archivo por sesión, así dos personas no chocan editando el mismo), con esta forma:

```markdown
# AAAA-MM-DD · @usuario · tema

- **Qué se hizo:** …
- **Commits / PR:** #12, abc1234
- **Probado:** qué con pruebas automáticas, qué a mano.
- **Sin verificar:** …
- **Queda pendiente:** …
```

Si cambió el estado o se aprendió algo, actualiza también `estado.md` o `aprendizajes.md` en el mismo PR.
