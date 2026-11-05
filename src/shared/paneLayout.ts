/**
 * Cómo se reparten los paneles en la ventana. Un árbol: cada hoja es un índice de `ui.panes`,
 * y cada nodo reparte su espacio en fila o en columna: en partes iguales si no se movió ningún divisor.
 */
export type PaneNode = number | { dir: 'row' | 'col'; kids: PaneNode[]; sizes?: number[] };
export type PaneEdge = 'left' | 'right' | 'top' | 'bottom';
export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_PANES = 4;

/** El reparto de los botones de la barra: 2 y 3 lado a lado, 4 en cuadrícula. */
export function presetTree(count: number): PaneNode {
  if (count <= 1) return 0;
  if (count === 4) {
    return {
      dir: 'col',
      kids: [
        { dir: 'row', kids: [0, 1] },
        { dir: 'row', kids: [2, 3] },
      ],
    };
  }
  return { dir: 'row', kids: Array.from({ length: count }, (_, i) => i) };
}

export function leaves(node: PaneNode): number[] {
  return typeof node === 'number' ? [node] : node.kids.flatMap(leaves);
}

/** Lo que se lee del disco puede venir de cualquier parte: tiene que nombrar cada panel una sola vez. */
export function isValidTree(node: unknown, count: number): node is PaneNode {
  const seen: number[] = [];
  const walk = (n: unknown, depth: number): boolean => {
    if (typeof n === 'number') {
      seen.push(n);
      return Number.isInteger(n);
    }
    if (!n || typeof n !== 'object' || depth > MAX_PANES) return false;
    const { dir, kids, sizes } = n as { dir?: unknown; kids?: unknown; sizes?: unknown };
    if ((dir !== 'row' && dir !== 'col') || !Array.isArray(kids) || kids.length < 2) return false;
    if (sizes !== undefined && !(Array.isArray(sizes) && sizes.length === kids.length && sizes.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0))) return false;
    return kids.every((k) => walk(k, depth + 1));
  };
  if (!walk(node, 0) || seen.length !== count) return false;
  return seen.slice().sort((a, b) => a - b).every((v, i) => v === i);
}

/** Pone `added` junto a `target`, del lado indicado. Si ya hay un reparto en ese sentido, se suma a él. */
export function insertLeaf(node: PaneNode, target: number, edge: PaneEdge, added: number): PaneNode {
  const dir = edge === 'left' || edge === 'right' ? 'row' : 'col';
  const before = edge === 'left' || edge === 'top';
  const pair = (leaf: number): PaneNode[] => (before ? [added, leaf] : [leaf, added]);
  if (typeof node === 'number') return node === target ? { dir, kids: pair(node) } : node;
  const at = node.kids.indexOf(target);
  if (at >= 0 && node.dir === dir) {
    const kids = node.kids.slice();
    kids.splice(before ? at : at + 1, 0, added);
    return { dir: node.dir, kids };
  }
  return { ...node, kids: node.kids.map((k) => insertLeaf(k, target, edge, added)) };
}

/** Quita un panel: su espacio pasa a los de al lado, y los índices mayores bajan uno. */
export function removeLeaf(node: PaneNode, removed: number): PaneNode | null {
  if (typeof node === 'number') {
    if (node === removed) return null;
    return node > removed ? node - 1 : node;
  }
  const kids = node.kids.map((k) => removeLeaf(k, removed)).filter((k): k is PaneNode => k !== null);
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0]!;
  // Una fila que queda dentro de otra fila es una sola: así vuelven a ser partes iguales.
  const flat = kids.flatMap((k) => (typeof k !== 'number' && k.dir === node.dir ? k.kids : [k]));
  // Si este nodo no perdió a nadie, conserva lo que el dueño ajustó.
  return flat.length === node.kids.length && node.sizes ? { dir: node.dir, kids: flat, sizes: node.sizes } : { dir: node.dir, kids: flat };
}

/** La parte de cada hijo, que suman 1. */
function parts(n: Exclude<PaneNode, number>): number[] {
  if (!n.sizes) return n.kids.map(() => 1 / n.kids.length);
  const total = n.sizes.reduce((a, b) => a + b, 0);
  return n.sizes.map((v) => v / total);
}

/** Recorre cada nodo con su rectángulo y el camino que lleva a él. */
function eachNode(root: PaneNode, visit: (n: PaneNode, r: PaneRect, path: number[]) => void): void {
  const walk = (n: PaneNode, r: PaneRect, path: number[]): void => {
    visit(n, r, path);
    if (typeof n === 'number') return;
    let start = 0;
    parts(n).forEach((part, i) => {
      walk(
        n.kids[i]!,
        n.dir === 'row'
          ? { x: r.x + r.w * start, y: r.y, w: r.w * part, h: r.h }
          : { x: r.x, y: r.y + r.h * start, w: r.w, h: r.h * part },
        [...path, i],
      );
      start += part;
    });
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 }, []);
}

/** Rectángulo de cada panel, en fracciones de la ventana, indexado por panel. */
export function paneRects(node: PaneNode): PaneRect[] {
  const out: PaneRect[] = [];
  eachNode(node, (n, r) => {
    if (typeof n === 'number') out[n] = r;
  });
  return out;
}

export interface PaneDivider {
  path: number[];
  /** Entre este hijo y el siguiente. */
  index: number;
  dir: 'row' | 'col';
  x: number;
  y: number;
  length: number;
}

/** Las líneas que se pueden arrastrar para cambiar el tamaño de los paneles. */
export function paneDividers(root: PaneNode): PaneDivider[] {
  const out: PaneDivider[] = [];
  eachNode(root, (n, r, path) => {
    if (typeof n === 'number') return;
    let start = 0;
    parts(n).slice(0, -1).forEach((part, index) => {
      start += part;
      if (n.dir === 'row') out.push({ path, index, dir: 'row', x: r.x + r.w * start, y: r.y, length: r.h });
      else out.push({ path, index, dir: 'col', x: r.x, y: r.y + r.h * start, length: r.w });
    });
  });
  return out;
}

function mapAt(node: PaneNode, path: number[], fn: (n: Exclude<PaneNode, number>) => PaneNode): PaneNode {
  if (typeof node === 'number') return node;
  if (path.length === 0) return fn(node);
  const [head, ...rest] = path;
  return { ...node, kids: node.kids.map((k, i) => (i === head ? mapAt(k, rest, fn) : k)) };
}

/** Lo mínimo que ocupa un panel al arrastrar un divisor, en parte de su nodo. */
const MIN_PART = 0.12;

/** Mueve el divisor a `pos` (fracción de la ventana, en su eje). */
export function moveDivider(root: PaneNode, divider: Pick<PaneDivider, 'path' | 'index'>, pos: number): PaneNode {
  let box: PaneRect | null = null;
  eachNode(root, (_n, r, path) => {
    if (path.length === divider.path.length && path.every((v, i) => v === divider.path[i])) box = r;
  });
  const rect = box as PaneRect | null;
  if (!rect) return root;
  return mapAt(root, divider.path, (n) => {
    const s = parts(n);
    const i = divider.index;
    if (i < 0 || i + 1 >= s.length) return n;
    const inside = n.dir === 'row' ? (pos - rect.x) / rect.w : (pos - rect.y) / rect.h;
    const before = s.slice(0, i).reduce((a, b) => a + b, 0);
    const pair = s[i]! + s[i + 1]!;
    const min = Math.min(MIN_PART, pair / 2);
    const first = Math.max(min, Math.min(pair - min, inside - before));
    const sizes = s.slice();
    sizes[i] = first;
    sizes[i + 1] = pair - first;
    return { ...n, sizes };
  });
}

/** Vuelve a partes iguales los paneles de ese divisor. */
export function resetDivider(root: PaneNode, path: number[]): PaneNode {
  return mapAt(root, path, (n) => ({ dir: n.dir, kids: n.kids }));
}

const EPS = 1e-6;

/** El panel que queda en esa dirección. Si no hay ninguno, da la vuelta, como los atajos de siempre. */
export function paneInDirection(node: PaneNode, from: number, dx: number, dy: number): number {
  const rects = paneRects(node);
  const a = rects[from];
  if (!a) return from;
  const overlaps = (b: PaneRect) =>
    dx !== 0 ? b.y < a.y + a.h - EPS && a.y < b.y + b.h - EPS : b.x < a.x + a.w - EPS && a.x < b.x + b.w - EPS;
  const start = (r: PaneRect) => (dx !== 0 ? r.x : r.y);
  const size = (r: PaneRect) => (dx !== 0 ? r.w : r.h);
  const sign = dx + dy;
  const candidates = rects
    .map((rect, index) => ({ rect, index }))
    .filter(({ rect, index }) => index !== from && overlaps(rect));
  const ahead = candidates.filter(({ rect }) => (sign > 0 ? start(rect) >= start(a) + size(a) - EPS : start(rect) + size(rect) <= start(a) + EPS));
  const pool = ahead.length ? ahead : candidates;
  if (!pool.length) return from;
  // Hacia adelante el más cercano es el primero; al dar la vuelta, también: el del otro extremo.
  return pool.reduce((best, c) => ((sign > 0 ? start(c.rect) < start(best.rect) : start(c.rect) > start(best.rect)) ? c : best)).index;
}
