# 2026-11-27 · @ivanmaxor · Rama y tiempo opcionales, y 1.4.2

- **Qué se hizo:** pedido del dueño. La rama y el tiempo en el estado (idea 19, de @dedalexcr7) le resultaban incómodos en la fila: ahora van apagados por defecto, con dos interruptores en Ajustes > Sesiones (`showBranch`, `showStateTime`). El texto al dejar el cursor encima los sigue mostrando. Un tiempo largo tapaba el ícono de la nota: `.row-text` ahora corta lo que no cabe. Versión 1.4.2 con eso y el arreglo del #60.
- **Commits / PR:** el PR de esta rama.
- **Probado:** typecheck, unitarias, privacy, y las e2e `rama-y-tiempo`, `ajustes-modulos`, `perfil` y `zoom-ventana`. La suite e2e completa, solo en el CI del PR: el dueño pidió no gastar en más pruebas locales.
- **Sin verificar:** a ojo, el tiempo largo cortado en una fila angosta.
- **Queda pendiente:** las ideas 52 a 55 (de @dedalexcr7), la guía #54.
