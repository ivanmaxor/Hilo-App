# Roadmap

Ideas, no compromisos. Cuando alguien toma una, la pasa a un Issue y se lo asigna. Lo que decide el dueño lleva la etiqueta "decide el dueño".

## Propuestas

- **Explorador de archivos dentro de Hilo** (pedido del dueño): ver las carpetas del proyecto, abrir o previsualizar imágenes, copiar y pegar archivos, sin salir de la app. Hoy hay un botón que abre la carpeta en el Explorador de Windows (D28).
- **Firmar las actualizaciones gratis:** firmar `latest.yml` con una clave que solo tenga quien publica, y que Hilo verifique la firma antes de instalar. Cerraría el riesgo de que alguien con permiso de escritura edite una Release. Ojo: la clave pública va dentro de la app, y una versión sin la firma tiene que seguir actualizando bien a la primera que la verifique.
- **Importar sesiones** de Claude Code que se abrieron fuera de Hilo.
- **Papelera de sesiones:** recuperar una sesión cerrada por error.
- **Línea de tiempo de cambios** en el panel Cambios.

## Descartado, y por qué

- **Chrome con claude.ai dentro de cada proyecto:** sería una segunda conexión a internet (rompe D19), guardaría la sesión de claude.ai dentro de Hilo y gastaría mucha memoria por proyecto. El botón "Copiar respuesta" ya cubre pasar respuestas entre chats.
- **El límite semanal por modelo** (por ejemplo, el de Fable) en el medidor de uso: Claude Code no se lo pasa a la línea de estado, y leerlo de otra forma exigiría el token, que Hilo nunca lee (D25, D29).
