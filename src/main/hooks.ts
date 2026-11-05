import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { HookName } from '../shared/statusMachine';
import { isSafeId } from '../shared/validate';

/**
 * Hooks solo para las sesiones que abre Hilo, por `claude --settings <archivo>`.
 * Nunca se toca ~/.claude/settings.json.
 *
 * El comando no lee stdin, así que el prompt y el contenido de las herramientas no
 * llegan nunca a la app. Solo agrega el nombre del evento a un archivo propio de la
 * sesión; la hora la pone la app al leer.
 */
const HOOK_EVENTS: { event: string; matcher?: string; name: HookName }[] = [
  { event: 'UserPromptSubmit', name: 'UserPromptSubmit' },
  { event: 'Stop', name: 'Stop' },
  { event: 'StopFailure', name: 'StopFailure' },
  { event: 'PermissionRequest', name: 'PermissionRequest' },
  // Con matcher: Claude no lanza ningún proceso para el resto de las herramientas.
  { event: 'PreToolUse', matcher: 'AskUserQuestion', name: 'AskUserQuestion' },
  { event: 'Notification', matcher: 'permission_prompt|elicitation_dialog', name: 'Notification' },
];

const VALID = new Set<string>(HOOK_EVENTS.map((h) => h.name));

/** Exportado para las pruebas. */
export function buildHookSettings(eventsFile: string): object {
  const path = eventsFile.replace(/\\/g, '/');
  // Comillas simples: literales en bash y en PowerShell, así $ o ` en la ruta no se interpretan.
  const target = path.includes("'") ? `"${path}"` : `'${path}'`;
  const hooks: Record<string, unknown[]> = {};
  for (const { event, matcher, name } of HOOK_EVENTS) {
    const entry: Record<string, unknown> = {
      hooks: [{ type: 'command', command: `echo ${name} >> ${target}`, timeout: 5 }],
    };
    if (matcher) entry.matcher = matcher;
    (hooks[event] ??= []).push(entry);
  }
  return { hooks };
}

/** Exportado para las pruebas. PowerShell 5 escribe UTF-16 al redirigir con >>. */
export function parseEvents(raw: string): HookName[] {
  return raw
    .replace(/\0/g, '')
    // PowerShell 5 abre el archivo con FF FE: como UTF-8 se lee U+FFFD y se perdería el primer evento.
    .replace(/\uFFFD/g, '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/﻿/g, '').trim())
    .filter((l): l is HookName => VALID.has(l));
}

export class HookChannel {
  private readonly offsets = new Map<string, number>();
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly dir: string,
    private readonly onEvent: (sessionId: string, name: HookName) => void,
  ) {
    mkdirSync(dir, { recursive: true });
    try {
      this.watcher = watch(dir, (_type, filename) => {
        if (typeof filename === 'string' && filename.endsWith('.events')) {
          const id = filename.slice(0, -'.events'.length);
          if (isSafeId(id)) this.drain(id);
        }
      });
      this.watcher.on('error', () => undefined);
    } catch (err) {
      // Sin vigilancia, el sondeo periódico de `drainAll` sigue funcionando.
      console.error('[hooks] no se pudo vigilar la carpeta', err);
    }
  }

  /** Prepara los archivos de la sesión y devuelve la ruta para `--settings`. */
  /** null: no se puede escribir el comando de forma segura, y la sesión sigue con las señales del título. */
  prepare(sessionId: string): string | null {
    if (!isSafeId(sessionId)) throw new Error('Identificador de sesión inválido');
    const eventsFile = join(this.dir, `${sessionId}.events`);
    // Una comilla simple obliga a las dobles, y dentro de ellas $ y ` se interpretarían.
    // PowerShell además trata las comillas tipográficas como comillas.
    if (/[\u2018\u2019\u201a\u201b\u201c\u201d\u201e]/.test(eventsFile) || (eventsFile.includes("'") && /[$`]/.test(eventsFile))) return null;
    writeFileSync(eventsFile, '');
    this.offsets.set(sessionId, 0);
    const settingsFile = join(this.dir, `${sessionId}.json`);
    writeFileSync(settingsFile, JSON.stringify(buildHookSettings(eventsFile), null, 1));
    return settingsFile;
  }

  stop(sessionId: string): void {
    this.drain(sessionId);
    this.offsets.delete(sessionId);
  }

  remove(sessionId: string): void {
    if (!isSafeId(sessionId)) return;
    this.offsets.delete(sessionId);
    for (const ext of ['events', 'json']) {
      rmSync(join(this.dir, `${sessionId}.${ext}`), { force: true });
    }
  }

  drainAll(): void {
    for (const id of this.offsets.keys()) this.drain(id);
  }

  private drain(sessionId: string): void {
    const offset = this.offsets.get(sessionId);
    if (offset === undefined) return;
    const file = join(this.dir, `${sessionId}.events`);
    try {
      const { size } = statSync(file);
      if (size <= offset) return;
      const length = Math.min(size - offset, 64 * 1024);
      const buffer = Buffer.alloc(length);
      const fd = openSync(file, 'r');
      try {
        readSync(fd, buffer, 0, length, offset);
      } finally {
        closeSync(fd);
      }
      this.offsets.set(sessionId, offset + length);
      for (const name of parseEvents(buffer.toString('utf8'))) this.onEvent(sessionId, name);
    } catch {
      // El archivo pudo haberse borrado.
    }
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
