import type { PaneNode, PaneRect } from './paneLayout';

/**
 * Agrandar un panel un momento. Es solo de la vista: nunca se guarda, y el árbol de paneles no cambia.
 * Se recuerda qué panel era y cómo estaba todo, para soltarlo en cuanto algo de eso cambie.
 */
export interface PaneZoom {
  /** Lo que mostraba el panel (una sesión o `changes:<proyecto>`). */
  content: string;
  /** El proyecto que se veía al agrandar. */
  project: string | null;
  /** El reparto de entonces: paneles y árbol. Cualquier cambio lo devuelve a su lugar. */
  layout: string;
}

interface ZoomUi {
  panes: (string | null)[];
  tree?: PaneNode | null;
  activePane: number;
}

function layoutKey(ui: ZoomUi): string {
  return JSON.stringify([ui.panes, ui.tree ?? null]);
}

/** Agranda el panel activo. Con un solo panel o vacío no hay nada que agrandar. */
export function startZoom(ui: ZoomUi, project: string | null): PaneZoom | null {
  const content = ui.panes[ui.activePane];
  if (!content || ui.panes.length < 2) return null;
  return { content, project, layout: layoutKey(ui) };
}

/**
 * El panel agrandado, o null si ya no corresponde: cerraron esa sesión, cambió el reparto,
 * se pasó a otro panel o a otro proyecto.
 */
export function zoomedPane(zoom: PaneZoom | null, ui: ZoomUi, project: string | null): number | null {
  if (!zoom || zoom.project !== project || zoom.layout !== layoutKey(ui)) return null;
  const at = ui.panes.indexOf(zoom.content);
  return at >= 0 && at === ui.activePane ? at : null;
}

/** Con un panel agrandado ocupa toda la ventana y los demás no se ven (null). Sin agrandar, todo igual. */
export function zoomRects(rects: PaneRect[], zoomed: number | null): (PaneRect | null)[] {
  if (zoomed === null) return rects;
  return rects.map((r, i) => (i === zoomed ? { x: 0, y: 0, w: 1, h: 1 } : null));
}
