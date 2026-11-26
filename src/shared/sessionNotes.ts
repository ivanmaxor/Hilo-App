import type { SessionNote, SessionRecord } from './types';

/** La bitácora de una sesión (su perfil): lo que sirve para mostrarla en la barra, el panel y el resumen. */

/** La nota más nueva, o undefined si no hay ninguna. */
export function latestNote(session: Pick<SessionRecord, 'notes'>): SessionNote | undefined {
  const notes = session.notes;
  return notes && notes.length > 0 ? notes[notes.length - 1] : undefined;
}

/** Las notas escritas desde `since`, de la más vieja a la más nueva. */
export function notesSince(session: Pick<SessionRecord, 'notes'>, since: number): SessionNote[] {
  return (session.notes ?? []).filter((n) => n.at >= since);
}

/** "hoy, 14:05" o "24 nov, 14:05", con el año si no es este. */
export function noteTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `hoy, ${time}`;
  const date = d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  return `${date}, ${time}`;
}
