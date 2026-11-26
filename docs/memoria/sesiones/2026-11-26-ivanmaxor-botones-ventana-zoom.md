# 2026-11-26 · @ivanmaxor · Botones de la ventana con el zoom, y respuestas a @dedalexcr7

- **Qué se hizo:** se aprobaron las ideas 52, 53, 54 y 55 de @dedalexcr7 (respuesta en el #13), que quedan para él. La pieza 4 de la 54 era un fallo y se arregló aquí (#60): los botones de la ventana medían siempre 36 px de alto, y la barra de pestañas les reservaba 138 px de la página, que el zoom achica. Al 80 % tapaban unos 22 px del final de la barra y bajaban sobre la cabecera del panel. Ahora su alto sigue al zoom y la barra reserva lo que mide el hueco (`env(titlebar-area-width)`). Se cerró el #9 como no reproducible y se borraron tres ramas de @dedalexcr7 con su PR ya fusionado o cerrado.
- **Commits / PR:** el PR del #60.
- **Probado:** `zoom-ventana.spec.ts` nueva (80 %, cambio de tema, 150 % y 90 % con la app abierta), que falla sin el arreglo y pasó 3 de 3 con él; typecheck, unitarias, privacy y la suite e2e completa como el CI.
- **Sin verificar:** a ojo, con otra escala de Windows que no sea 100 %. La prueba mide el hueco con la API de la página, no los botones dibujados.
- **Queda pendiente:** las ideas 52 a 55 (de @dedalexcr7), la guía #54.
