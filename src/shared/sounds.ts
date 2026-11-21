/**
 * Sonidos de aviso (D32). Se sintetizan en la app con Web Audio: sin archivos ni red. Lógica pura: qué
 * sonido toca para cada estado.
 */
import type { SessionStatus, Settings } from "./types";

export const SOUNDS = [
  { id: "gota", label: "Gota" },
  { id: "campana", label: "Campana" },
  { id: "dos-notas", label: "Dos notas" },
  { id: "acorde", label: "Acorde suave" },
  { id: "cristal", label: "Cristal" },
  { id: "pitido", label: "Doble pitido" },
  { id: "grave", label: "Grave" },
] as const;

export type SoundId = (typeof SOUNDS)[number]["id"];
export type SoundChoice = SoundId | "none";

/** Minutos entre repeticiones mientras nadie la atiende. 0 = una sola vez. */
export const SOUND_REPEATS = [0, 1, 2, 5, 10] as const;

export const isSoundChoice = (v: unknown): v is SoundChoice =>
  v === "none" || SOUNDS.some((s) => s.id === v);

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
