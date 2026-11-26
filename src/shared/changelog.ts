/**
 * Novedades de cada versión, de la más nueva a la más vieja. Van dentro de la app porque Hilo no se
 * conecta a nada más que al actualizador (D27). Una prueba exige que esté la versión de package.json:
 * al subir la versión, agregar aquí lo que cambió.
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.4.1",
    date: "2026-11-25",
    items: [
      "Perfil de cada sesión, con un clic en el ícono de la hoja de su fila: nombre, descripción, el id de la conversación para copiarlo y una bitácora de notas con fecha, que se editan o borran una por una. La nota que ya tenías queda como la primera.",
      "Las rutas que Claude escribe desde la raíz del repositorio, desde el proyecto o desde tus carpetas (Documentos/…, Escritorio/…, también en OneDrive) ya se pueden tocar, no solo las completas.",
      "Resumen del día: en el buscador (Ctrl+Shift+K) escribe «resumen». Arma un Markdown con las sesiones de hoy, su estado y las notas del día, para copiar o guardar.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-11-25",
    items: [
      "Las rutas que escribe Claude se pueden tocar: un clic las muestra en el Explorador y Ctrl+clic las abre en el IDE del proyecto, en su línea. Cada sesión tiene un botón para abrir su carpeta.",
      "Arrastrar archivos del Explorador a una sesión pega su ruta, sin Enter.",
      "Antes de pegar algo que parece una clave (de Anthropic, GitHub, AWS, Slack, Stripe o un .env), Hilo pregunta.",
      "El ícono de la barra de tareas muestra cuántas sesiones te necesitan, y parpadea cuando una te espera o falla.",
      "Un panel se puede agrandar a toda la ventana un momento, con su botón o con doble clic en la cabecera.",
      "Cada sesión muestra su rama de Git y cuánto lleva en su estado.",
      "Enviar la última respuesta de una sesión de Claude a otra, desde su clic derecho: se pega sin Enter, para que la revises.",
      "Comentarios en el panel Cambios: deja uno en cualquier línea del diff y envíalos todos juntos a una sesión de Claude, sin Enter.",
      "Cambiar la carpeta de un proyecto o de una sesión, desde su clic derecho. Las conversaciones se retoman aunque la carpeta se haya movido, y nunca se empieza una nueva sin preguntarte.",
      "Ajustes por módulos, con buscador. Tu propio sonido de aviso (mp3, wav u ogg) y avisos cuando llevas un porcentaje de tu sesión de 5 horas o de la semana.",
      "Las actualizaciones vienen firmadas: Hilo comprueba la firma antes de instalarlas.",
      "Arreglos: una PowerShell donde abres claude vuelve a pasar sola a Claude, y cambiar de sesión ya no recorta las líneas de la terminal.",
    ],
  },
  {
    version: "1.3.9",
    date: "2026-11-22",
    items: [
      "Cuatro sonidos más largos: Timbre, Melodía, Alarma suave y Ola.",
      "Duración de cada aviso: una vez, o repetir el sonido seguido durante 3, 5, 10, 20 o 30 segundos. Se corta apenas abres la sesión o le respondes.",
      "El botón Probar usa la duración elegida, y con un segundo clic se detiene.",
    ],
  },
  {
    version: "1.3.8",
    date: "2026-11-21",
    items: [
      "Sonidos de aviso cuando una sesión termina, te espera o falla, con 7 sonidos para elegir, volumen y botón para probarlos. Se configuran en Ajustes > Sesiones.",
      "Se pueden repetir cada 1, 2, 5 o 10 minutos hasta que abras la sesión o le respondas, y elegir si suenan también mientras la estás mirando.",
      "Si Hilo toca su sonido, la notificación de Windows llega en silencio, para no sonar dos veces.",
    ],
  },
  {
    version: "1.3.7",
    date: "2026-11-21",
    items: [
      "Claude abre con su pantalla clásica (como /tui default), así el historial se desplaza bien con la rueda. Se puede cambiar en Ajustes > Claude Code.",
      "Si la ruta de claude en Ajustes apunta a otra cosa, como un instalador o Claude Desktop, Hilo lo avisa y busca Claude Code por su cuenta.",
      "Si Claude se cierra apenas arranca, el aviso dice qué archivo se lanzó y dónde corregirlo.",
    ],
  },
  {
    version: "1.3.6",
    date: "2026-11-17",
    items: [
      "El color por tiempo sin mensajes ahora es solo para las sesiones abiertas. Las dormidas, con la luna, se quedan grises.",
    ],
  },
  {
    version: "1.3.5",
    date: "2026-11-17",
    items: [
      "Al crear una sesión puedes elegir otra carpeta y dejarla en el mismo proyecto.",
      "Si abres Claude dentro de una PowerShell de Hilo, esa misma sesión pasa a ser de Claude, en la carpeta donde lo abriste aunque hayas hecho cd. Sigue en su proyecto, con su nombre, color y marca.",
      "Las sesiones de Claude quietas cambian de color según su último mensaje, tuyo o de Claude: amarillo a la hora, naranja a las 5 horas y rojo al día. Se apaga en Ajustes > Sesiones.",
    ],
  },
  {
    version: "1.3.4",
    date: "2026-11-16",
    items: [
      "Marcar una sesión como leída o como no leída, con clic derecho. La no leída se queda con su punto hasta que la abras.",
      "Una marca para cada sesión: un emoji delante del nombre, de una lista o el que quieras.",
      "Notas en las sesiones: se leen al pasar el ratón y en el panel de una sesión dormida.",
      "Cualquier color para sesiones y proyectos, con los últimos que elegiste a mano y un botón para copiar el código.",
      "Un botón en cada proyecto para abrir su carpeta en el Explorador.",
      "El uso del plan ya no vuelve a un dato viejo: con varias sesiones abiertas gana el más reciente, también después de una restauración del plan.",
    ],
  },
  {
    version: "1.3.3",
    date: "2026-11-09",
    items: [
      "Uso de tu plan de Claude en la barra lateral: cuánto llevas de la sesión de 5 horas y de la semana, cuánto te queda y cuándo se renueva cada una, en verde, amarillo o rojo.",
      'Botón "Copiar respuesta" (Ctrl+Shift+L, o clic derecho en una sesión): copia el último mensaje de Claude con el nombre de la sesión delante, listo para pegarlo en otra.',
      'Si Claude lanza subagentes, la sesión sigue en "Trabajando" hasta que acaben, con una marca de cuántos faltan. El aviso de que terminó sale al final.',
      "Esta sección de novedades, y un aviso después de cada actualización.",
    ],
  },
  {
    version: "1.3.2",
    date: "2026-11-05",
    items: [
      "Al cambiar el tamaño de la ventana o de un panel, Claude ya no acumula tantas copias cortadas de su texto.",
      "El pie de la barra lateral ya no corta el atajo para buscar una sesión.",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-11-04",
    items: [
      "Sin cambios: sirvió para comprobar que la actualización desde Ajustes funciona.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-11-04",
    items: [
      "Actualizaciones desde Ajustes. Nada se baja ni se instala sin que lo aceptes.",
      "Panel Cambios: los archivos que cambiaron en el proyecto, con las líneas nuevas en verde.",
      "Abrir un archivo en tu IDE desde el panel Cambios, en la línea que elijas.",
      "Una guía para instalar Claude Code y Git si faltan.",
    ],
  },
  {
    version: "1.2.2",
    date: "2026-11-04",
    items: [
      "La X de una pestaña solo deja de mostrarla. Para cerrar una sesión de verdad, clic derecho; antes pregunta.",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-11-04",
    items: [
      "El instalador ofrece abrir Hilo y crear un acceso directo en el escritorio.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-04",
    items: [
      "Lista para compartir: licencia MIT, y Claude vuelve a pedir permisos por defecto.",
      "Vistas divididas nuevas: cada panel te deja elegir qué mostrar, y arrastrar una sesión al borde la suma ahí.",
      "Más ajustes de apariencia, tamaño de letra y desplazamiento con el touchpad.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-03",
    items: [
      "Primera versión: tus sesiones de Claude Code en una ventana, con su estado a la vista, y de vuelta con su conversación al reabrir.",
    ],
  },
];
