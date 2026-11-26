import type { PersistedState, RuntimeMap, SessionRecord, SessionStatus } from './types';
import { notesSince } from './sessionNotes';

/**
 * Resumen del día en Markdown (idea 42). Pura: la hora entra por parámetro y solo usa lo que Hilo ya
 * guarda (sesiones, estado, marca y nota). No lee conversaciones ni nada de `~/.claude`, y no guarda nada.
 *
 * "Hoy" es desde las 00:00 de la zona horaria local de quien lo pide. Hilo no guarda cuánto tiempo estuvo
 * cada sesión trabajando, así que eso no se incluye.
 */

/** Cómo se llama cada estado en el resumen, con las palabras de quien lo va a leer en una reunión. */
export const SUMMARY_STATUS: Record<SessionStatus, string> = {
  done: 'Terminó',
  waiting: 'Te espera',
  error: 'Falló',
  idle: 'En reposo',
  asleep: 'Dormida',
  working: 'Trabajando',
  starting: 'Arrancando',
  exited: 'Cerrada',
};

/** El orden en que se cuentan arriba: primero lo que pide algo de la persona. */
const COUNT_ORDER: SessionStatus[] = ['waiting', 'error', 'done', 'working', 'starting', 'idle', 'asleep', 'exited'];

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n: number) => String(n).padStart(2, '0');

/** AAAA-MM-DD en la zona horaria local. También sirve para el nombre del archivo. */
export function localDateStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Las 00:00 locales del día de `now`, en milisegundos. */
export function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function longDate(date: Date): string {
  return `${DAYS[date.getDay()]} ${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Controles, y los que cambian el sentido de lectura del texto (bidi): no aportan nada en un resumen.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Los caracteres que Markdown interpreta en cualquier parte de una línea. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*[\]<>~|]/g, '\\$&')
    // Un guion bajo dentro de una palabra (snake_case) no abre énfasis: así queda legible.
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_');
}

/** Una sola línea, para nombres y marcas: nunca puede abrir un bloque nuevo. */
function inline(text: string): string {
  return escapeMarkdown(text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim());
}

/** El principio de línea es lo que decide si algo es título, lista, cita, código o tabla. */
function escapeLineStart(line: string): string {
  return line.replace(/^([#+\-=:]|\d+[.)])/, (m) => (/^\d/.test(m) ? m.replace(/([.)])$/, '\\$1') : `\\${m}`));
}

/** La nota como cita, línea por línea: sus saltos no rompen la lista ni pueden abrir un título o un bloque de código. */
function noteLines(note: string): string[] {
  const lines = note
    .replace(INVISIBLE, (c) => (c === '\u000b' || c === '\u000c' ? '\n' : ''))
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const out: string[] = [];
  lines.forEach((line, i) => {
    // Varias líneas en blanco seguidas valen una.
    if (!line && !lines[i - 1]) return;
    const body = line ? escapeLineStart(escapeMarkdown(line)) : '';
    out.push(i === 0 ? `  > **Nota:** ${body}` : body ? `  > ${body}` : '  >');
  });
  return out;
}

function sessionLine(s: SessionRecord, status: SessionStatus, since: number): string[] {
  const mark = s.mark ? `${inline(s.mark)} ` : '';
  const parts = [SUMMARY_STATUS[status]];
  if (s.kind === 'shell') parts.unshift('PowerShell');
  if (s.lastActiveAt) parts.push(clock(s.lastActiveAt));
  const name = inline(s.name) || '(sin nombre)';
  return [`- ${mark}**${name}** — ${parts.join(' · ')}`, ...notesSince(s, since).flatMap((n) => noteLines(n.text))];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildDailySummary(state: Pick<PersistedState, 'projects'>, runtime: RuntimeMap, now: Date): string {
  const since = startOfLocalDay(now);
  const title = `# Resumen del día — ${longDate(now)}`;
  const groups = state.projects
    .map((project) => ({
      project,
      sessions: project.sessions
        .filter((s) => typeof s.lastActiveAt === 'number' && s.lastActiveAt >= since)
        .sort((a, b) => a.lastActiveAt! - b.lastActiveAt!),
    }))
    .filter((g) => g.sessions.length > 0);

  if (!groups.length) return `${title}\n\nHoy no hubo actividad en ninguna sesión de Hilo.\n`;

  const statusOf = (s: SessionRecord): SessionStatus => runtime[s.id]?.status ?? 'asleep';
  const counts = new Map<SessionStatus, number>();
  let total = 0;
  for (const g of groups) {
    for (const s of g.sessions) {
      total++;
      counts.set(statusOf(s), (counts.get(statusOf(s)) ?? 0) + 1);
    }
  }
  const countLine = COUNT_ORDER.filter((st) => counts.has(st))
    .map((st) => `${SUMMARY_STATUS[st]}: ${counts.get(st)}`)
    .join(' · ');

  const out = [
    title,
    '',
    `${plural(total, 'sesión', 'sesiones')} con actividad hoy, en ${plural(groups.length, 'proyecto', 'proyectos')}. Hecho a las ${clock(now.getTime())}.`,
    '',
    countLine,
  ];
  for (const g of groups) {
    out.push('', `## ${inline(g.project.name) || '(sin nombre)'}`, '');
    for (const s of g.sessions) out.push(...sessionLine(s, statusOf(s), since));
  }
  return `${out.join('\n')}\n`;
}
