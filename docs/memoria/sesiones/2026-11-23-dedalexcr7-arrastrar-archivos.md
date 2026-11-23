# 2026-11-23 · @dedalexcr7 · arrastrar archivos del Explorador a una sesión

- **Qué se hizo:** soltar archivos o carpetas sobre una sesión despierta pega su ruta, sin Enter. Dentro de la carpeta de la sesión va `@ruta/relativa` (con `@"..."` si tiene espacios); fuera, la ruta completa entre comillas. Varios van separados por un espacio, con tope de 20 y aviso. Sobre una sesión dormida solo sale un aviso. La ruta se calcula en el preload con `webUtils.getPathForFile` (`pathsOfFiles`, única función nueva). El texto se arma en `src/shared/dropPaths.ts` y pasa por `paste()` (con `sanitizePaste`) mediante un parámetro opcional `given`. Un nombre con caracteres de control se descarta, no se "arregla".
- **Commits / PR:** rama local `feature/idea-arrastrar-archivos`, sin PR.
- **Probado:** unitarias de `dropPaths` y e2e `arrastrar-archivos.spec.ts` con archivos reales de disco (de un `<input type="file">`) y el `drop` despachado a mano.
- **Sin verificar:** el gesto real de arrastrar desde el Explorador de Windows; soltar una carpeta (Playwright no puede darle una a un input); que Claude Code entienda `@"ruta con espacios"`.
- **Queda pendiente:** decisión del dueño sobre `@"..."` con espacios. Aprendizaje: un `FileList` no cruza el `contextBridge` (llega vacío); un arreglo de `File` sí.
