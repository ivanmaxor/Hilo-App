/** Colores a elección: conversión para el selector y la lista de recientes. Lógica pura. */
import { PALETTE } from "./defaults";
import { MAX_RECENT_COLORS } from "./validate";

export interface Hsv {
  /** 0 a 360. */
  h: number;
  /** 0 a 1. */
  s: number;
  /** 0 a 1. */
  v: number;
}

/** "#AbC", "abc123" o "#abc123" a "#aabbcc". null si no es un color. */
export function normalizeHex(text: string): string | null {
  const t = text.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t))
    return `#${[...t].map((c) => c + c).join("")}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t}`.toLowerCase();
  return null;
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function hexToHsv(hex: string): Hsv {
  const n = normalizeHex(hex) ?? "#000000";
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(n.slice(i, i + 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/** Lo elegido va primero. Los de la paleta no: siempre están a la vista. */
export function addRecentColor(recent: string[], color: string): string[] {
  const c = color.toLowerCase();
  if (PALETTE.some((p) => p.hex.toLowerCase() === c)) return recent;
  return [c, ...recent.filter((x) => x !== c)].slice(0, MAX_RECENT_COLORS);
}
