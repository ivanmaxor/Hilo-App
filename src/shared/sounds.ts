/**
 * Sonidos de aviso (D32). Se sintetizan en la app con Web Audio: sin archivos ni red. Lógica pura: qué
 * sonido toca para cada estado y cuánto dura.
 */
import type { SessionStatus, Settings } from "./types";

/** `seconds`: cuánto dura una pasada del sonido, para encadenarlo sin que se pise. */
export const SOUNDS = [
  { id: "gota", label: "Gota", seconds: 0.35 },
  { id: "campana", label: "Campana", seconds: 1.6 },
  { id: "dos-notas", label: "Dos notas", seconds: 0.7 },
  { id: "acorde", label: "Acorde suave", seconds: 1.25 },
  { id: "cristal", label: "Cristal", seconds: 0.8 },
  { id: "pitido", label: "Doble pitido", seconds: 0.35 },
  { id: "grave", label: "Grave", seconds: 0.9 },
  { id: "timbre", label: "Timbre (largo)", seconds: 1.8 },
  { id: "melodia", label: "Melodía (larga)", seconds: 2.3 },
  { id: "alarma", label: "Alarma suave (larga)", seconds: 2.4 },
  { id: "ola", label: "Ola (larga)", seconds: 2.8 },
] as const;

export type SoundId = (typeof SOUNDS)[number]["id"];
export type SoundChoice = SoundId | "none";

/** Minutos entre repeticiones mientras nadie la atiende. 0 = una sola vez. */
export const SOUND_REPEATS = [0, 1, 2, 5, 10] as const;

/** Segundos que suena cada aviso, repitiendo el sonido seguido. 0 = una pasada. */
export const SOUND_DURATIONS = [0, 3, 5, 10, 20, 30] as const;

/** Silencio entre una pasada y la siguiente, en segundos. */
export const SOUND_GAP = 0.35;

export const isSoundChoice = (v: unknown): v is SoundChoice =>
  v === "none" || SOUNDS.some((s) => s.id === v);

export function soundSeconds(id: SoundId): number {
  return SOUNDS.find((s) => s.id === id)?.seconds ?? 1;
}

/** Cuántas pasadas caben en la duración elegida: al menos una. */
export function soundPasses(id: SoundId, duration: number): number {
  if (duration <= 0) return 1;
  return Math.max(
    1,
    Math.floor((duration + SOUND_GAP) / (soundSeconds(id) + SOUND_GAP)),
  );
}

/** Los estados que avisan: terminó, te espera o falló. */
export type AlertStatus = "done" | "waiting" | "error";

export function soundFor(
  settings: Pick<Settings, "soundDone" | "soundWaiting" | "soundError">,
  status: SessionStatus,
): SoundChoice {
  if (status === "done") return settings.soundDone;
  if (status === "waiting") return settings.soundWaiting;
  if (status === "error") return settings.soundError;
  return "none";
}
