import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";
import type { HookName } from "../shared/statusMachine";
import { mergeUsage, parseUsage, type PlanUsage } from "../shared/usage";
import { USAGE_SCRIPT, usageCommand } from "./usageScript";
import { isSafeId } from "../shared/validate";

/**
 * Hooks solo para las sesiones que abre Hilo, por `claude --settings <archivo>`.
 * Nunca se toca ~/.claude/settings.json.
 *
 * El comando no lee stdin, así que el prompt y el contenido de las herramientas no
 * llegan nunca a la app. Solo agrega el nombre del evento a un archivo propio de la
 * sesión; la hora la pone la app al leer.
 */
const HOOK_EVENTS: { event: string; matcher?: string; name: HookName }[] = [
  { event: "UserPromptSubmit", name: "UserPromptSubmit" },
  { event: "SubagentStart", name: "SubagentStart" },
  { event: "SubagentStop", name: "SubagentStop" },
  { event: "Stop", name: "Stop" },
  { event: "StopFailure", name: "StopFailure" },
  { event: "PermissionRequest", name: "PermissionRequest" },
  // Con matcher: Claude no lanza ningún proceso para el resto de las herramientas.
  { event: "PreToolUse", matcher: "AskUserQuestion", name: "AskUserQuestion" },
  {
    event: "Notification",
    matcher: "permission_prompt|elicitation_dialog",
    name: "Notification",
  },
];

const VALID = new Set<string>(HOOK_EVENTS.map((h) => h.name));

/** Lo que escribe la línea de estado: `usage-<sesión>.json`, o `usage.json` de la 1.3.3. */
const USAGE_FILE = /^usage(-[0-9A-Za-z-]{1,64})?\.json$/;
/** Lo que vio una sesión de Claude hace más de una semana ya no sirve para ninguna ventana. */
const USAGE_MAX_AGE_MS = 8 * 24 * 3600_000;

/** Exportado para las pruebas. */
export function buildHookSettings(
  eventsFile: string,
  statusCommand: string | null = null,
): object {
  const path = eventsFile.replace(/\\/g, "/");
  // Comillas simples: literales en bash y en PowerShell, así $ o ` en la ruta no se interpretan.
  const target = path.includes("'") ? `"${path}"` : `'${path}'`;
  const hooks: Record<string, unknown[]> = {};
  for (const { event, matcher, name } of HOOK_EVENTS) {
    const entry: Record<string, unknown> = {
      hooks: [
        { type: "command", command: `echo ${name} >> ${target}`, timeout: 5 },
      ],
    };
    if (matcher) entry.matcher = matcher;
    (hooks[event] ??= []).push(entry);
  }
  // Reemplaza la línea de estado del usuario solo en las sesiones de Hilo, y se apaga en Ajustes (D25).
  return statusCommand
    ? {
        hooks,
        statusLine: { type: "command", command: statusCommand, padding: 0 },
      }
    : { hooks };
}

/** Exportado para las pruebas. PowerShell 5 escribe UTF-16 al redirigir con >>. */
export function parseEvents(raw: string): HookName[] {
  return (
    raw
      .replace(/\0/g, "")
      // PowerShell 5 abre el archivo con FF FE: como UTF-8 se lee U+FFFD y se perdería el primer evento.
      .replace(/\uFFFD/g, "")
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .map((l) => l.replace(/﻿/g, "").trim())
      .filter((l): l is HookName => VALID.has(l))
  );
}

export class HookChannel {
  private readonly offsets = new Map<string, number>();
  private watcher: FSWatcher | null = null;
  private usage: PlanUsage | null = null;
  private usageTimer: NodeJS.Timeout | null = null;
  private readonly statusCommand: string | null;

  constructor(
    private readonly dir: string,
    private readonly onEvent: (sessionId: string, name: HookName) => void,
    private readonly onUsage: (usage: PlanUsage) => void = () => undefined,
  ) {
    mkdirSync(dir, { recursive: true });
    const script = join(dir, "usage.ps1");
    let command: string | null = null;
    try {
      writeFileSync(script, USAGE_SCRIPT);
      command = usageCommand(script);
    } catch (err) {
      console.error("[uso] no se pudo escribir el script", err);
    }
    this.statusCommand = command;
    this.cleanUsage();
    this.readUsage();
    try {
      this.watcher = watch(dir, (_type, filename) => {
        if (typeof filename === "string" && USAGE_FILE.test(filename)) {
          // Se escribe con un archivo temporal y un renombre: se espera a que termine.
          if (this.usageTimer) clearTimeout(this.usageTimer);
          this.usageTimer = setTimeout(() => this.readUsage(), 150);
          return;
        }
        if (typeof filename === "string" && filename.endsWith(".events")) {
          const id = filename.slice(0, -".events".length);
          if (isSafeId(id)) this.drain(id);
        }
      });
      this.watcher.on("error", () => undefined);
    } catch (err) {
      // Sin vigilancia, el sondeo periódico de `drainAll` sigue funcionando.
      console.error("[hooks] no se pudo vigilar la carpeta", err);
    }
  }

  lastUsage(): PlanUsage | null {
    return this.usage;
  }

  /** Junta lo que vio cada sesión de Claude: gana el dato que cambió más tarde (D25). */
  private readUsage(): void {
    const readings: PlanUsage[] = [];
    for (const name of this.usageFiles()) {
      try {
        const reading = parseUsage(readFileSync(join(this.dir, name), "utf8"));
        if (reading) readings.push(reading);
      } catch {
        // Se está reemplazando: llega otro aviso al terminar.
      }
    }
    const next = mergeUsage(readings, Date.now());
    if (!next || JSON.stringify(next) === JSON.stringify(this.usage)) return;
    this.usage = next;
    this.onUsage(next);
  }

  private usageFiles(): string[] {
    try {
      return readdirSync(this.dir).filter((name) => USAGE_FILE.test(name));
    } catch {
      return [];
    }
  }

  /** Los temporales de una línea de estado cortada a medias, y lo que ya tiene más de una semana. */
  private cleanUsage(): void {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    const now = Date.now();
    for (const name of names) {
      const temp = /^usage[\w.-]*\.tmp$/.test(name);
      if (!temp && !USAGE_FILE.test(name)) continue;
      try {
        const age = now - statSync(join(this.dir, name)).mtimeMs;
        if (age > (temp ? 60_000 : USAGE_MAX_AGE_MS))
          rmSync(join(this.dir, name), { force: true });
      } catch {
        // Otro proceso lo está usando: se intenta la próxima vez.
      }
    }
  }

  /** Prepara los archivos de la sesión y devuelve la ruta para `--settings`. */
  /** null: no se puede escribir el comando de forma segura, y la sesión sigue con las señales del título. */
  prepare(sessionId: string, withUsage = false): string | null {
    if (!isSafeId(sessionId))
      throw new Error("Identificador de sesión inválido");
    const eventsFile = join(this.dir, `${sessionId}.events`);
    // Una comilla simple obliga a las dobles, y dentro de ellas $ y ` se interpretarían.
    // PowerShell además trata las comillas tipográficas como comillas.
    if (
      /[\u2018\u2019\u201a\u201b\u201c\u201d\u201e]/.test(eventsFile) ||
      (eventsFile.includes("'") && /[$`]/.test(eventsFile))
    )
      return null;
    writeFileSync(eventsFile, "");
    this.offsets.set(sessionId, 0);
    const settingsFile = join(this.dir, `${sessionId}.json`);
    writeFileSync(
      settingsFile,
      JSON.stringify(
        buildHookSettings(eventsFile, withUsage ? this.statusCommand : null),
        null,
        1,
      ),
    );
    return settingsFile;
  }

  stop(sessionId: string): void {
    this.drain(sessionId);
    this.offsets.delete(sessionId);
  }

  remove(sessionId: string): void {
    if (!isSafeId(sessionId)) return;
    this.offsets.delete(sessionId);
    for (const ext of ["events", "json"]) {
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
      const fd = openSync(file, "r");
      try {
        readSync(fd, buffer, 0, length, offset);
      } finally {
        closeSync(fd);
      }
      this.offsets.set(sessionId, offset + length);
      for (const name of parseEvents(buffer.toString("utf8")))
        this.onEvent(sessionId, name);
    } catch {
      // El archivo pudo haberse borrado.
    }
  }

  dispose(): void {
    if (this.usageTimer) clearTimeout(this.usageTimer);
    this.watcher?.close();
    this.watcher = null;
  }
}
