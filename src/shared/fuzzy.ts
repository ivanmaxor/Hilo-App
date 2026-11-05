/** Coincidencia difusa simple. Devuelve puntaje (mayor es mejor) y posiciones, o null. */
export function fuzzyMatch(query: string, text: string): { score: number; positions: number[] } | null {
  const q = normalize(query);
  if (!q) return { score: 0, positions: [] };
  const t = normalize(text);
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    positions.push(i);
    score += i === prev + 1 ? 5 : 1;
    if (i === 0 || /[\s\-_/.]/.test(t[i - 1] ?? '')) score += 3;
    prev = i;
    from = i + 1;
  }
  return { score: score - t.length * 0.01, positions };
}

/** Sin mayúsculas ni tildes. Conserva la longitud para poder resaltar posiciones. */
export function normalize(s: string): string {
  return Array.from(s.toLowerCase())
    .map((c) => c.normalize('NFD').charAt(0))
    .join('');
}
