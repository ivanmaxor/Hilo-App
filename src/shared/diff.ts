/** Lo que el proceso principal le dice al panel Cambios, y cómo se lee un diff. Sin Electron ni Node. */

export type FileChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict' | 'untracked';

export interface FileChange {
  /** Relativa a la carpeta del proyecto, con `/`. */
  path: string;
  /** El nombre anterior, si se renombró. */
  oldPath?: string;
  kind: FileChangeKind;
  /** null si no se contó: binario, demasiado grande o de más. */
  added: number | null;
  removed: number | null;
  binary: boolean;
}

export type ChangesList =
  | { status: 'ok'; files: FileChange[]; total: number; noCommits: boolean; subfolder: boolean }
  /** `no-folder`: la carpeta ya no está. `untrusted`: git desconfía de quien es dueño de la carpeta. */
  | { status: 'no-project' | 'no-folder' | 'no-git' | 'not-repo' | 'untrusted' | 'unsafe-config' }
  | { status: 'error'; message: string };

export interface FileDiffRequest {
  path: string;
  oldPath?: string;
  /** Sin rastrear: git no tiene con qué compararlo y se lee el archivo. */
  untracked: boolean;
  /** Todo el archivo en vez de solo las zonas cambiadas. */
  full: boolean;
}

export type FileDiffResult =
  | { status: 'patch' | 'new'; text: string }
  | { status: 'binary' | 'symlink' | 'folder' | 'missing' | 'rejected' | 'no-git' | 'unsafe-config' }
  | { status: 'too-large'; bytes: number | null }
  | { status: 'error'; message: string };

export const MAX_DIFF_BYTES = 5 * 1024 * 1024;
export const MAX_LISTED_FILES = 2000;

/** Parte la salida de `git diff --raw --numstat -z`: todo va separado por NUL, sin comillas. */
export function parseRawNumstat(output: string): FileChange[] {
  const tokens = output.split('\0');
  const byPath = new Map<string, FileChange>();
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i++]!;
    if (!token) continue;
    if (token.startsWith(':')) {
      const letter = token.trim().split(/\s+/)[4]?.[0] ?? 'M';
      if (letter === 'R' || letter === 'C') {
        const oldPath = tokens[i++] ?? '';
        const path = tokens[i++] ?? '';
        byPath.set(path, letter === 'R' ? { path, oldPath, kind: 'renamed', added: 0, removed: 0, binary: false } : { path, kind: 'added', added: 0, removed: 0, binary: false });
      } else {
        const path = tokens[i++] ?? '';
        const kind: FileChangeKind = letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : letter === 'U' ? 'conflict' : 'modified';
        byPath.set(path, { path, kind, added: 0, removed: 0, binary: false });
      }
      continue;
    }
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(token);
    if (!match) continue;
    // Con un renombrado el campo de la ruta va vacío, y los dos nombres vienen después.
    let path = match[3]!;
    if (!path) {
      i++;
      path = tokens[i++] ?? '';
    }
    const entry = byPath.get(path);
    if (!entry) continue;
    const binary = match[1] === '-';
    entry.binary = binary;
    entry.added = binary ? null : Number(match[1]);
    entry.removed = binary ? null : Number(match[2]);
  }
  return [...byPath.values()];
}

export type DiffRowKind = 'ctx' | 'add' | 'del' | 'gap' | 'note';

export interface DiffRow {
  kind: DiffRowKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
  /** La línea del archivo actual a la que lleva: en una quitada, donde estaba. */
  jump: number | null;
  /** En una fila `gap`, cuántas líneas sin cambios se saltan. */
  hidden?: number;
}

export interface ParsedDiff {
  binary: boolean;
  rows: DiffRow[];
  added: number;
  removed: number;
  /** Fila donde empieza cada grupo de cambios. */
  changes: number[];
  /** La línea más larga, para el ancho del desplazamiento. */
  longest: number;
  /** El número de línea más alto, para el ancho de la columna. */
  maxLine: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_EOL_NOTE = 'Sin salto de línea al final del archivo';

function emptyDiff(): ParsedDiff {
  return { binary: false, rows: [], added: 0, removed: 0, changes: [], longest: 0, maxLine: 0 };
}

function pushRow(out: ParsedDiff, row: DiffRow): void {
  const changed = row.kind === 'add' || row.kind === 'del';
  // La nota de "sin salto de línea" no parte un grupo de cambios.
  let last = out.rows[out.rows.length - 1];
  if (last?.kind === 'note') last = out.rows[out.rows.length - 2];
  if (changed && !(last && (last.kind === 'add' || last.kind === 'del'))) out.changes.push(out.rows.length);
  if (row.kind === 'add') out.added++;
  if (row.kind === 'del') out.removed++;
  if (row.kind !== 'gap' && row.kind !== 'note' && row.text.length > out.longest) out.longest = row.text.length;
  out.maxLine = Math.max(out.maxLine, row.oldLine ?? 0, row.newLine ?? 0);
  out.rows.push(row);
}

const stripCr = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);

/**
 * Lee un diff unificado. Dentro de una zona manda la cuenta de su cabecera y no el aspecto de la línea:
 * una línea de código que empieza con `--- ` o `@@` sigue siendo código.
 */
export function parseUnifiedDiff(text: string): ParsedDiff {
  const out = emptyDiff();
  const lines = text.split('\n');
  let prevOldEnd = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) prevOldEnd = 0;
    if (/^Binary files .* differ$/.test(line) || line === 'GIT binary patch') {
      out.binary = true;
      i++;
      continue;
    }
    const hunk = HUNK.exec(line);
    i++;
    if (!hunk) continue;
    let oldLine = Number(hunk[1]);
    let newLine = Number(hunk[3]);
    let oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
    let newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
    // Con cero líneas, git nombra la línea anterior a la zona.
    if (oldLeft === 0) oldLine++;
    if (newLeft === 0) newLine++;
    const hidden = oldLine - prevOldEnd - 1;
    if (hidden > 0) pushRow(out, { kind: 'gap', oldLine: null, newLine: null, text: '', jump: null, hidden });
    const firstRow = out.rows.length;
    while ((oldLeft > 0 || newLeft > 0) && i < lines.length) {
      const body = lines[i]!;
      const mark = body[0];
      const content = stripCr(body.slice(1));
      if (mark === '+' && newLeft > 0) {
        pushRow(out, { kind: 'add', oldLine: null, newLine, text: content, jump: newLine });
        newLine++;
        newLeft--;
      } else if (mark === '-' && oldLeft > 0) {
        pushRow(out, { kind: 'del', oldLine, newLine: null, text: content, jump: null });
        oldLine++;
        oldLeft--;
      } else if (mark === '\\') {
        pushRow(out, { kind: 'note', oldLine: null, newLine: null, text: NO_EOL_NOTE, jump: null });
      } else if ((mark === ' ' || mark === undefined) && oldLeft > 0 && newLeft > 0) {
        pushRow(out, { kind: 'ctx', oldLine, newLine, text: content, jump: newLine });
        oldLine++;
        newLine++;
        oldLeft--;
        newLeft--;
      } else {
        break;
      }
      i++;
    }
    if (lines[i]?.startsWith('\\')) {
      pushRow(out, { kind: 'note', oldLine: null, newLine: null, text: NO_EOL_NOTE, jump: null });
      i++;
    }
    prevOldEnd = oldLine - 1;
    // Una quitada lleva a donde estaba: la línea que ahora ocupa ese sitio, o la última si no hay más.
    let next: number | null = newLine - 1 > 0 ? newLine - 1 : null;
    for (let r = out.rows.length - 1; r >= firstRow; r--) {
      const row = out.rows[r]!;
      if (row.newLine !== null) next = row.newLine;
      else if (row.kind === 'del') row.jump = next;
    }
  }
  return out;
}

/** Un archivo nuevo: todas sus líneas son agregadas. */
export function rowsFromNewFile(text: string): ParsedDiff {
  const out = emptyDiff();
  if (!text) return out;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  lines.forEach((line, i) => pushRow(out, { kind: 'add', oldLine: null, newLine: i + 1, text: stripCr(line), jump: i + 1 }));
  return out;
}
