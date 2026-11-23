# 2026-11-23 · @ivanmaxor · Ajustes por módulos, sonido propio y avisos de uso

- **Qué se hizo:**
  - **#15:** Ajustes en `src/renderer/ui/settings.tsx`, por módulos, con buscador y "Restablecer este módulo".
  - **#12:** sonido propio en `src/main/customSound.ts`.
  - **#8:** avisos de uso en `src/shared/usageAlerts.ts` y `src/main/usageAlerter.ts`.
  - El módulo nuevo Avisos junta todo lo que avisa. Ver D34.
- **Commits / PR:** el PR que cierra #15, #12 y #8.
- **Probado:**
  - Unitarias de los umbrales.
  - e2e nueva `ajustes-modulos.spec.ts`: módulos, buscador, restablecer, sonido propio con un WAV de prueba, y aviso de uso escribiendo un `usage-*.json`, sin repetirse al reabrir.
  - Las e2e que abren Ajustes se ajustaron a los módulos y pasan.
  - Capturas revisadas en ventana ancha y angosta.
- **Sin verificar:**
  - Cómo suena un audio propio real en parlantes. En modo prueba Hilo no decodifica ni toca audio.
  - Un aviso de uso con el medidor real de Claude.
- **Queda pendiente:** nada de estos tres Issues.
