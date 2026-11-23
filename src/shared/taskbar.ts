import type { SessionStatus } from './types';

/**
 * Aviso en la barra de tareas: cuántas sesiones necesitan tu atención y el círculo con el número.
 * Pura y sin Electron: el main solo convierte los píxeles en un NativeImage.
 */

/** Más de esto se muestra como «9+»: el círculo es de 16 px. */
export const BADGE_MAX = 9;

/**
 * Cuántas sesiones necesitan tu atención: las que te esperan, las que terminaron sin que las vieras y las que fallaron
 * (decisión del dueño, #13). Una sesión deja de contar al verla, responderle o volver a lanzarla.
 */
export function attentionCount(statuses: Iterable<SessionStatus>): number {
  let n = 0;
  for (const s of statuses) if (s === 'waiting' || s === 'done' || s === 'error') n++;
  return n;
}

/** Texto del círculo: «1» a «9», «9+» y vacío si no hay ninguna. */
export function badgeLabel(count: number): string {
  if (!Number.isFinite(count) || count < 1) return '';
  const n = Math.floor(count);
  return n > BADGE_MAX ? `${BADGE_MAX}+` : String(n);
}

/** Lo que lee un lector de pantalla sobre el ícono de la barra de tareas. */
export function badgeDescription(count: number): string {
  if (!Number.isFinite(count)) return '';
  const n = Math.floor(count);
  if (n < 1) return '';
  return n === 1 ? '1 sesión necesita tu atención' : `${n} sesiones necesitan tu atención`;
}

/** Lado del dibujo en píxeles. Windows pide 16 px lógicos: se dibuja al doble para pantallas con escala. */
export const BADGE_SIZE = 32;
export const BADGE_SCALE_FACTOR = 2;

const FG = [0x1a, 0x1b, 0x1e] as const;
// El mismo ámbar que el estado «esperando» de la interfaz.
const BG = [0xe9, 0xc0, 0x5c] as const;

/** Tipografía de 3x5 píxeles: solo hacen falta los dígitos y el «+». */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

/**
 * Píxeles BGRA (premultiplicados) de un círculo ámbar con el texto encima, de BADGE_SIZE x BADGE_SIZE.
 * Con texto vacío o con caracteres que no están en la tipografía devuelve null.
 */
export function renderBadge(label: string): Uint8Array | null {
  if (!label || [...label].some((c) => !GLYPHS[c])) return null;
  const size = BADGE_SIZE;
  const px = new Uint8Array(size * size * 4);
  const mid = size / 2;
  // Un solo carácter más grande; «9+» más chico para que quepa.
  const scale = label.length === 1 ? 4 : 3;
  const gap = scale;
  const width = label.length * 3 * scale + (label.length - 1) * gap;
  const x0 = Math.round((size - width) / 2);
  const y0 = Math.round((size - 5 * scale) / 2);

  const text = new Set<number>();
  [...label].forEach((c, i) => {
    const ox = x0 + i * (3 * scale + gap);
    GLYPHS[c]!.forEach((row, gy) => {
      for (let gx = 0; gx < 3; gx++) {
        if (row[gx] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) text.add((y0 + gy * scale + dy) * size + ox + gx * scale + dx);
      }
    });
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Borde suave de un píxel: distancia del centro del píxel al borde del círculo.
      const d = Math.hypot(x + 0.5 - mid, y + 0.5 - mid);
      const alpha = Math.max(0, Math.min(1, mid - d));
      if (alpha === 0) continue;
      const [r, g, b] = text.has(y * size + x) ? FG : BG;
      const i = (y * size + x) * 4;
      px[i] = Math.round(b * alpha);
      px[i + 1] = Math.round(g * alpha);
      px[i + 2] = Math.round(r * alpha);
      px[i + 3] = Math.round(255 * alpha);
    }
  }
  return px;
}
