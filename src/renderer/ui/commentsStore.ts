import { commentKey, MAX_COMMENT_CHARS, MAX_COMMENTS, type CommentSide, type DiffComment } from '../../shared/diffComments';
import { createStore } from '../controller';

/**
 * Los comentarios del diff, por proyecto, solo en memoria: no se guardan en disco ni en `state.json`.
 * Viven fuera del panel para que cerrar el panel o recargar el diff no los pierda; se van al cerrar Hilo.
 */
export const diffComments = createStore<{ byProject: Record<string, DiffComment[]> }>({ byProject: {} });

let nextId = 1;
const EMPTY: DiffComment[] = [];

export const commentsOf = (projectId: string): DiffComment[] => diffComments.get().byProject[projectId] ?? EMPTY;

function put(projectId: string, list: DiffComment[]): void {
  const byProject = { ...diffComments.get().byProject };
  if (list.length) byProject[projectId] = list;
  else delete byProject[projectId];
  diffComments.set({ byProject });
}

export type SaveResult = 'ok' | 'empty' | 'full';

/** Guarda el comentario de una línea; si ya había uno, lo reemplaza. Un texto vacío no se guarda. */
export function saveComment(projectId: string, at: { path: string; side: CommentSide; line: number; code: string }, text: string): SaveResult {
  const body = text.slice(0, MAX_COMMENT_CHARS);
  if (!body.trim()) return 'empty';
  const key = commentKey(at.path, at.side, at.line);
  const list = commentsOf(projectId);
  const same = list.find((c) => commentKey(c.path, c.side, c.line) === key);
  if (!same && list.length >= MAX_COMMENTS) return 'full';
  if (same) put(projectId, list.map((c) => (c === same ? { ...c, text: body } : c)));
  else put(projectId, [...list, { id: nextId++, path: at.path, side: at.side, line: at.line, code: at.code, text: body }]);
  return 'ok';
}

export function removeComments(projectId: string, ids: readonly number[]): void {
  const gone = new Set(ids);
  put(projectId, commentsOf(projectId).filter((c) => !gone.has(c.id)));
}

export function clearComments(projectId: string): void {
  put(projectId, []);
}
