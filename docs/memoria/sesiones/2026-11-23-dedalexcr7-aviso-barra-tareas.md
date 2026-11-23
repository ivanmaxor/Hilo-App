# 2026-11-23 · @dedalexcr7 · aviso en la barra de tareas

- **Qué se hizo:** opción C de la idea «aviso en la barra de tareas»: un círculo ámbar con el número de sesiones que te esperan sobre el ícono (`setOverlayIcon`, «1» a «9» y «9+») y parpadeo (`flashFrame`) cuando una sesión pasa a «te espera» o falla con Hilo sin foco. El parpadeo sale en `notify()`, así que respeta el ajuste de notificaciones; se apaga al darle foco a la ventana. El contador no depende de ese ajuste.
- **Decisión:** el círculo se dibuja en el proceso principal con píxeles (`renderBadge`, tipografía de 3x5 en `src/shared/taskbar.ts`) y no con imágenes en `assets/`. `electron-builder.yml` solo empaqueta `dist/**`: las imágenes habrían pedido `extraResources` y una ruta, y esto no lee ningún archivo ni recibe nada del renderer. Se dibuja a 32x32 con `scaleFactor` 2 (16 px lógicos).
- **Solo cuentan las que esperan.** Las «terminó» y «con error» siguen solo en el título de la ventana. El error sí hace parpadear.
- **Probado:** unitarias (`tests/unit/taskbar.test.ts`) y e2e (`tests/e2e/barra-tareas.spec.ts`, gancho `__hilo.taskbarCalls`, y `__hilo.focus` ahora también fija el foco que ve el main en pruebas).
- **Sin verificar:** cómo se ve en la barra de Windows real (tema claro/oscuro, DPI, varios monitores) y el efecto del Asistente de concentración sobre el parpadeo. Solo se puede con personas.
- **Queda pendiente (decide el dueño):** si el círculo debe apagarse con las notificaciones apagadas; si «terminó» debería contar.
