import type { SessionKind, SessionStatus } from './types';

/**
 * Máquina de estados de una sesión. Pura: el tiempo entra por parámetro.
 * Las reglas salen de las grabaciones reales, ver docs/investigacion/R2.
 */
export interface MachineState {
  kind: SessionKind;
  status: SessionStatus;
  /** Tras el hook Stop el título sigue en ◐ hasta que acaban los demás hooks Stop. */
  stopLatchUntil: number;
  /** "Esperando" por el diálogo de confianza del arranque: el primer ✳ ya es que pasó. */
  blockedAtStart?: boolean;
  exitCode?: number;
}

export type HookName =
  | 'UserPromptSubmit'
  | 'Stop'
  | 'StopFailure'
  | 'PermissionRequest'
  | 'AskUserQuestion'
  | 'Notification';

export type MachineEvent =
  | { t: 'spawn' }
  | { t: 'title'; kind: 'working' | 'ready' | 'other' }
  | { t: 'hook'; name: HookName }
  | { t: 'sessionFile'; status: 'busy' | 'idle' | 'waiting' }
  | { t: 'startTimeout' }
  | { t: 'viewed' }
  | { t: 'exit'; code: number; requested: boolean }
  | { t: 'sleep' };

/** Tiempo máximo que se ignora ◐ después de Stop. Un hook puede forzar a seguir trabajando. */
export const STOP_LATCH_MS = 20_000;

export function initialState(kind: SessionKind): MachineState {
  return { kind, status: 'asleep', stopLatchUntil: 0 };
}

export function transition(s: MachineState, ev: MachineEvent, now: number): MachineState {
  if (ev.t === 'spawn') {
    return { kind: s.kind, status: s.kind === 'shell' ? 'idle' : 'starting', stopLatchUntil: 0 };
  }
  if (ev.t === 'sleep') {
    return { kind: s.kind, status: 'asleep', stopLatchUntil: 0 };
  }
  if (ev.t === 'exit') {
    if (s.kind === 'shell') {
      return { kind: s.kind, status: ev.requested ? 'asleep' : 'exited', stopLatchUntil: 0, exitCode: ev.code };
    }
    // Claude salió limpio (/exit, Ctrl+C dos veces): se retoma con un clic.
    const clean = ev.requested || ev.code === 0;
    return { kind: s.kind, status: clean ? 'asleep' : 'error', stopLatchUntil: 0, exitCode: ev.code };
  }

  // Sin proceso vivo, los eventos tardíos no cambian nada.
  if (s.status === 'asleep' || s.status === 'error' || s.status === 'exited') return s;

  if (ev.t === 'viewed') {
    return s.status === 'done' ? { ...s, status: 'idle' } : s;
  }
  if (s.kind === 'shell') return s;

  switch (ev.t) {
    case 'title':
      if (ev.kind === 'working') {
        if (now < s.stopLatchUntil) return s;
        return { ...s, status: 'working', stopLatchUntil: 0 };
      }
      if (ev.kind === 'ready') {
        const cleared = { ...s, stopLatchUntil: 0 };
        if (s.status === 'waiting' && s.blockedAtStart) return { ...cleared, status: 'idle', blockedAtStart: false };
        // ✳ también aparece esperando: no saca de "esperando".
        if (s.status === 'working') return { ...cleared, status: 'done' };
        if (s.status === 'starting') return { ...cleared, status: 'idle' };
        return cleared;
      }
      return s;

    case 'hook':
      switch (ev.name) {
        case 'UserPromptSubmit':
          return { ...s, status: 'working', stopLatchUntil: 0 };
        case 'Stop':
        case 'StopFailure':
          if (s.status === 'working' || s.status === 'waiting') {
            return { ...s, status: 'done', stopLatchUntil: now + STOP_LATCH_MS };
          }
          return { ...s, stopLatchUntil: now + STOP_LATCH_MS };
        case 'PermissionRequest':
        case 'AskUserQuestion':
        case 'Notification':
          return { ...s, status: 'waiting', stopLatchUntil: 0, blockedAtStart: false };
      }
      return s;

    case 'sessionFile':
      if (ev.status === 'waiting') {
        return s.status === 'waiting' ? s : { ...s, status: 'waiting', stopLatchUntil: 0, blockedAtStart: false };
      }
      if (ev.status === 'idle') {
        // Esc en un permiso: no hay hook ni cambio de título, solo esta señal.
        if (s.status === 'waiting') return { ...s, status: 'idle', blockedAtStart: false };
        // El título puede quedar congelado sin foco; esta señal llega tras acabar los hooks.
        if (s.status === 'working') return { ...s, status: 'done', stopLatchUntil: 0 };
        if (s.status === 'starting') return { ...s, status: 'idle' };
        return s;
      }
      // busy
      if (now < s.stopLatchUntil) return s;
      if (s.status === 'waiting' || s.status === 'idle' || s.status === 'done' || s.status === 'starting') {
        return { ...s, status: 'working' };
      }
      return s;

    case 'startTimeout':
      // Sigue arrancando: casi seguro es el diálogo de confianza de la carpeta.
      return s.status === 'starting' ? { ...s, status: 'waiting', blockedAtStart: true } : s;
  }
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  asleep: 'Dormida',
  starting: 'Arrancando',
  working: 'Trabajando',
  idle: 'Lista',
  done: 'Terminó (sin leer)',
  waiting: 'Esperándote',
  error: 'Terminó con error',
  exited: 'Cerrada',
};

/** Prioridad de atención: menor número primero. */
export const STATUS_PRIORITY: Record<SessionStatus, number> = {
  waiting: 0,
  error: 1,
  done: 2,
  working: 3,
  starting: 4,
  idle: 5,
  exited: 6,
  asleep: 7,
};
