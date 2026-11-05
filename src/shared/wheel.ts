/** Tras un evento de touchpad, los que siguen también lo son: la inercia a veces cae en múltiplos de 120. */
const STICKY_MS = 400;

/** `wheelDeltaY` existe en Chromium, aunque no esté en los tipos de TypeScript. */
export interface WheelLike {
  deltaMode: number;
  deltaY: number;
  wheelDeltaY: number;
}

/** Una rueda de ratón avanza a saltos de 120; un touchpad manda valores de cualquier tamaño. */
export function looksLikeTouchpad(e: WheelLike): boolean {
  return e.deltaMode === 0 && e.wheelDeltaY !== 0 && Math.abs(e.wheelDeltaY) % 120 !== 0;
}

/**
 * Un touchpad manda decenas de eventos por gesto, más la inercia al levantar los dedos, y cada
 * uno mueve la terminal como una muesca de rueda. Atender solo una parte calma el gesto entero,
 * también en los programas que reciben el ratón, a los que xterm les pasa cada evento tal cual.
 */
export class WheelThinner {
  private credit = 0;
  private touchpadUntil = 0;

  /** True si este evento se atiende. `percent` es la parte que se deja pasar del touchpad. */
  keep(e: WheelLike, now: number, percent: number): boolean {
    if (e.deltaY === 0) return true;
    if (looksLikeTouchpad(e)) this.touchpadUntil = now + STICKY_MS;
    else if (now >= this.touchpadUntil) {
      this.credit = 0;
      return true;
    }
    this.credit += percent / 100;
    if (this.credit < 1) return false;
    this.credit -= 1;
    return true;
  }
}
