/**
 * Uso del plan de Claude (sesión de 5 horas y semana), tal como Claude Code se lo da a su línea de
 * estado (D25). Lógica pura: el tiempo entra por parámetro.
 */
export interface UsageWindow {
  /** Porcentaje usado, de 0 a 100. */
  used: number;
  /** Cuándo se renueva, en milisegundos. */
  resetsAt: number;
}

export interface PlanUsage {
  /** Cuándo lo escribió Claude, en milisegundos. */
  at: number;
  session?: UsageWindow;
  week?: UsageWindow;
}

export type UsageLevel = "ok" | "mid" | "low";

function window(raw: unknown): UsageWindow | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { used, resets_at } = raw as { used?: unknown; resets_at?: unknown };
  if (
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    used < 0 ||
    used > 1000
  )
    return undefined;
  if (
    typeof resets_at !== "number" ||
    !Number.isFinite(resets_at) ||
    resets_at < 1e9 ||
    resets_at > 1e11
  )
    return undefined;
  return { used: Math.min(100, used), resetsAt: resets_at * 1000 };
}

/** El `usage.json` que escribe la línea de estado. null si no se entiende. */
export function parseUsage(text: string): PlanUsage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const session = window(r.five_hour);
  const week = window(r.seven_day);
  if (!session && !week) return null;
  const at =
    typeof r.at === "number" && Number.isFinite(r.at) ? r.at * 1000 : 0;
  const out: PlanUsage = { at };
  if (session) out.session = session;
  if (week) out.week = week;
  return out;
}

/** El color va por lo que queda: verde con más de la mitad, amarillo hasta el 20 %, rojo después. */
export function usageLevel(used: number): UsageLevel {
  if (used >= 80) return "low";
  if (used >= 50) return "mid";
  return "ok";
}

/** "3 d 4 h", "2 h 10 min", "5 min". */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}
