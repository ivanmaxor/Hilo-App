/**
 * Avisos de uso del plan (#8): cuándo avisar que una ventana (la sesión de 5 horas o la semana) cruzó un
 * umbral. Lógica pura: el uso, los ajustes, lo ya avisado y la hora entran por parámetro.
 */
import type { PlanUsage } from "./usage";

/** Los umbrales que se pueden elegir, en %. */
export const USAGE_THRESHOLDS = [50, 75, 80, 90, 95] as const;

export type UsageWindowName = "session" | "week";

export interface UsageAlertSettings {
  usageAlerts: boolean;
  usageAlertSession: number[];
  usageAlertWeek: number[];
}

export interface UsageAlert {
  window: UsageWindowName;
  /** El umbral más alto cruzado que todavía no se había avisado. */
  threshold: number;
  used: number;
  resetsAt: number;
  /** Lo que queda avisado con esto: también los umbrales menores ya cruzados. */
  keys: string[];
}

/** La ventana se identifica por cuándo se renueva, redondeado al minuto: Claude a veces lo mueve unos segundos. */
export function alertKey(
  window: UsageWindowName,
  resetsAt: number,
  threshold: number,
): string {
  return `${window}:${Math.round(resetsAt / 60_000)}:${threshold}`;
}

/** Lo que hay que avisar ahora. Un salto de 70 % a 96 % avisa una sola vez, con el umbral más alto. */
export function dueUsageAlerts(
  usage: PlanUsage | null,
  settings: UsageAlertSettings,
  fired: ReadonlySet<string>,
  now: number,
): UsageAlert[] {
  if (!usage || !settings.usageAlerts) return [];
  const out: UsageAlert[] = [];
  const windows: [UsageWindowName, number[]][] = [
    ["session", settings.usageAlertSession],
    ["week", settings.usageAlertWeek],
  ];
  for (const [name, thresholds] of windows) {
    const win = name === "session" ? usage.session : usage.week;
    if (!win || win.resetsAt <= now) continue;
    const crossed = [...thresholds]
      .filter((t) => win.used >= t)
      .sort((a, b) => a - b);
    const keys = crossed.map((t) => alertKey(name, win.resetsAt, t));
    const fresh = crossed.filter((_, i) => !fired.has(keys[i]!));
    if (!fresh.length) continue;
    // Con el 80 % ya avisado, activar el 50 % no avisa otra vez: ese aviso ya llegó con uno mayor.
    const highestFired = crossed.filter((_, i) => fired.has(keys[i]!)).pop();
    const top = fresh[fresh.length - 1]!;
    if (highestFired !== undefined && top < highestFired) continue;
    out.push({
      window: name,
      threshold: top,
      used: win.used,
      resetsAt: win.resetsAt,
      keys,
    });
  }
  return out;
}

/** Saca lo avisado de ventanas que ya se renovaron. */
export function pruneFired(fired: Iterable<string>, now: number): string[] {
  const minute = Math.round(now / 60_000);
  return [...fired].filter((key) => Number(key.split(":")[1]) >= minute);
}
