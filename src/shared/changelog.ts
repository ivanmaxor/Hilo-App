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
