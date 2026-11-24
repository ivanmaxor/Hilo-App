import { describe, expect, it } from 'vitest';
import { paneRects, presetTree } from '../../src/shared/paneLayout';
import { startZoom, zoomedPane, zoomRects } from '../../src/shared/paneZoom';

const ui = (panes: (string | null)[], activePane = 0) => ({ panes, tree: presetTree(panes.length), activePane });

describe('agrandar un panel', () => {
  it('el agrandado ocupa toda la ventana y los demás no se ven', () => {
    const rects = paneRects(presetTree(4));
    const out = zoomRects(rects, 2);
    expect(out[2]).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(out.filter((r) => r === null)).toHaveLength(3);
    expect(out[0]).toBeNull();
  });

  it('sin agrandar nada, los rectángulos quedan como están', () => {
    const rects = paneRects(presetTree(3));
    expect(zoomRects(rects, null)).toBe(rects);
  });

  it('no cambia el árbol ni los rectángulos de origen', () => {
    const tree = presetTree(4);
    const before = JSON.stringify(tree);
    const rects = paneRects(tree);
    const copy = JSON.stringify(rects);
    zoomRects(rects, 1);
    expect(JSON.stringify(tree)).toBe(before);
    expect(JSON.stringify(rects)).toBe(copy);
  });

  it('con un solo panel o un panel vacío no hay nada que agrandar', () => {
    expect(startZoom(ui(['a']), 'p')).toBeNull();
    expect(startZoom(ui(['a', null], 1), 'p')).toBeNull();
  });

  it('se mantiene mientras nada cambie', () => {
    const u = ui(['a', 'b', 'c'], 1);
    const zoom = startZoom(u, 'p');
    expect(zoom).not.toBeNull();
    expect(zoomedPane(zoom, u, 'p')).toBe(1);
  });

  it('cerrar la sesión agrandada la devuelve a su lugar', () => {
    const zoom = startZoom(ui(['a', 'b', 'c'], 1), 'p');
    expect(zoomedPane(zoom, ui(['a', null, 'c'], 1), 'p')).toBeNull();
    expect(zoomedPane(zoom, ui(['a', 'c'], 1), 'p')).toBeNull();
  });

  it('cambiar el reparto la devuelve a su lugar', () => {
    const zoom = startZoom(ui(['a', 'b', 'c'], 1), 'p');
    const moved = { ...ui(['a', 'b', 'c'], 1), tree: { dir: 'col' as const, kids: [0, 1, 2] } };
    expect(zoomedPane(zoom, moved, 'p')).toBeNull();
    expect(zoomedPane(zoom, ui(['a', 'b', 'c', null], 1), 'p')).toBeNull();
  });

  it('pasar a otro panel o a otro proyecto la devuelve a su lugar', () => {
    const zoom = startZoom(ui(['a', 'b', 'c'], 1), 'p');
    expect(zoomedPane(zoom, ui(['a', 'b', 'c'], 0), 'p')).toBeNull();
    expect(zoomedPane(zoom, ui(['a', 'b', 'c'], 1), 'otro')).toBeNull();
  });

  it('un panel Cambios también se puede agrandar', () => {
    const u = ui(['a', 'changes:p'], 1);
    expect(zoomedPane(startZoom(u, 'p'), u, 'p')).toBe(1);
  });
});
