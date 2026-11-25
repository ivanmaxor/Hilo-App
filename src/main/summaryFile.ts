import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { localDateStamp } from '../shared/dailySummary';

/** Más que de sobra para el resumen de un día; evita que el renderer mande archivos enormes. */
export const MAX_SUMMARY_CHARS = 200_000;
const MAX_COPIES = 99;

export const isSummaryText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_SUMMARY_CHARS && !v.includes('\0');

export type SaveSummaryResult = { ok: true; path: string } | { ok: false; message: string };

/** `AAAA-MM-DD-resumen-hilo.md`, y con un número al final si ya hay uno: `...-resumen-hilo-2.md`. */
export function summaryFileName(date: Date, copy = 1): string {
  return `${localDateStamp(date)}-resumen-hilo${copy > 1 ? `-${copy}` : ''}.md`;
}

/**
 * Guarda el resumen dentro de `dir` (que sale del diálogo de carpeta, nunca del renderer) con un nombre fijo.
 * Escribe a un temporal con fsync y lo publica sin pisar nada: un corte deja el archivo entero o ninguno.
 */
export async function saveSummaryFile(dir: string, text: string, now: Date): Promise<SaveSummaryResult> {
  if (!isAbsolute(dir)) return { ok: false, message: 'Esa carpeta no es válida.' };
  try {
    if (!(await stat(dir)).isDirectory()) return { ok: false, message: 'Eso no es una carpeta.' };
  } catch {
    return { ok: false, message: 'No se pudo abrir esa carpeta.' };
  }
  const tmp = join(dir, `.resumen-hilo-${randomUUID()}.tmp`);
  try {
    const handle = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let copy = 1; copy <= MAX_COPIES; copy++) {
      const target = join(dir, summaryFileName(now, copy));
      try {
        // Un vínculo falla si el destino existe: nunca sobrescribe. Una carpeta sin vínculos (FAT, red) usa renombrar.
        await link(tmp, target);
        return { ok: true, path: target };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') continue;
        if (code === 'EPERM' || code === 'ENOSYS' || code === 'ENOTSUP' || code === 'EXDEV' || code === 'EINVAL') {
          if (await exists(target)) continue;
          await rename(tmp, target);
          return { ok: true, path: target };
        }
        throw err;
      }
    }
    return { ok: false, message: 'Ya hay demasiados resúmenes de hoy en esa carpeta.' };
  } catch (err) {
    console.error('[resumen] no se pudo guardar', err);
    return { ok: false, message: 'No se pudo guardar en esa carpeta. Elige otra.' };
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
