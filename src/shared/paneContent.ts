/**
 * Lo que puede mostrar una hoja del árbol de paneles: una sesión o un panel "Cambios" de un proyecto.
 * Los ids de sesión no admiten ":" (`isSafeId`), así que este prefijo nunca choca con una sesión.
 */
const CHANGES_PREFIX = 'changes:';

export function changesPaneId(projectId: string): string {
  return `${CHANGES_PREFIX}${projectId}`;
}

/** El proyecto de un panel Cambios; null si es una sesión o un panel vacío. */
export function changesProjectOf(content: string | null | undefined): string | null {
  return typeof content === 'string' && content.startsWith(CHANGES_PREFIX) ? content.slice(CHANGES_PREFIX.length) : null;
}

export function isChangesPane(content: string | null | undefined): boolean {
  return changesProjectOf(content) !== null;
}

/** La sesión que hay en ese panel, si hay alguna. `activeSessionId` solo nombra sesiones. */
export function sessionInPane(content: string | null | undefined): string | null {
  return content && !isChangesPane(content) ? content : null;
}
