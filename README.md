# Hilo

Hilo es una aplicación para Windows que organiza tus sesiones de [Claude Code](https://claude.com/product/claude-code). Cada sesión es una terminal de verdad, y una lista te muestra de un vistazo cuál está trabajando, cuál terminó y cuál te está esperando. Al cerrar Hilo o apagar el PC, tus sesiones quedan guardadas y vuelven con su conversación.

Hilo no es un producto de Anthropic ni está afiliado a Anthropic. Es un proyecto independiente que usa el Claude Code que ya tienes instalado.

## Qué necesitas

- Windows de 64 bits. Se usa y se prueba en Windows 11.
- Claude Code instalado y con tu cuenta iniciada. Hilo no lo instala ni incluye una cuenta.

## Descargar e instalar

1. Entra en [Releases](../../releases/latest) y baja el archivo `Hilo-Setup-x.y.z.exe`. No hacen falta los demás: sirven para las actualizaciones.
2. Ábrelo y acepta la licencia. No pide permisos de administrador.
3. Al terminar, dos casillas te dejan abrir Hilo y crear un acceso directo en el escritorio.

### Si Windows muestra un aviso

Hilo es un proyecto personal y no tiene certificado de firma de código, porque esos certificados se pagan. Por eso Windows SmartScreen puede decir "Windows protegió su PC". Para seguir, pulsa **Más información** y luego **Ejecutar de todas formas**. Tu antivirus también podría preguntar.

No hay ninguna intención maliciosa detrás de Hilo. El aviso significa que Windows no conoce al autor del archivo, no que haya encontrado algo malo. Pero tampoco garantiza nada: instálalo solo si lo bajaste de esta página y confías en ella.

## Cómo se actualiza

Cada vez que abres Hilo, busca una sola vez si hay una versión nueva. Si la hay, te avisa y tú decides:

1. En **Ajustes > Actualizaciones**, pulsa **Bajar la versión**.
2. Cuando termine, pulsa **Reiniciar e instalar**. Hilo se cierra, se actualiza sin mostrar pantallas y vuelve a abrirse. Tus sesiones vuelven con su conversación. Si alguna está trabajando, te avisa antes.

Nada se baja ni se instala sin que lo pidas. Puedes apagar la búsqueda al abrir en esa misma sección, y buscar a mano cuando quieras con el botón **Buscar actualizaciones**. También puedes instalar a mano una versión nueva encima de la que tienes.

Antes de instalar, Hilo comprueba que el archivo bajado coincide con el publicado. Como Hilo aún no está firmado, eso protege de una descarga dañada, pero no de que alguien tomara control de esta cuenta de GitHub.

## Qué se conecta a internet

**Hilo solo se conecta a GitHub, para buscar y bajar versiones.** No tiene telemetría ni analítica, y no envía tus proyectos, tus conversaciones ni tus datos. GitHub ve lo que ve con cualquier descarga, como tu dirección IP. Si apagas la búsqueda al abrir, Hilo solo se conecta cuando pulsas el botón.

Si tu red exige un proxy, Hilo no podrá conectarse: baja las versiones nuevas a mano desde esta página.

Dos cosas que no son de Hilo:

- **Claude Code**, dentro de cada sesión, se conecta a Anthropic por su cuenta, como en cualquier otra terminal. Lo mismo vale para lo que ejecutes en una terminal.
- **Los enlaces** en los que hagas clic se abren en tu navegador.

## Qué toca en tu PC

- Hilo nunca lee tu token ni tus credenciales, y no cambia tu configuración global de Claude Code.
- Tus proyectos y ajustes se guardan en `%APPDATA%\Hilo`.
- Para desinstalar, usa Configuración de Windows > Aplicaciones. Esa carpeta se conserva: puedes borrarla si no la quieres. Tus conversaciones son de Claude Code y no se tocan.

## Licencia

Hilo se distribuye con licencia MIT, que verás al instalar. Esta página solo publica las versiones: aquí no está el código fuente.
