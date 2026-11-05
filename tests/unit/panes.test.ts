import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultState } from '../../src/shared/defaults';
import { insertLeaf, isValidTree, moveDivider, paneDividers, paneInDirection, paneRects, presetTree, removeLeaf, resetDivider } from '../../src/shared/paneLayout';
import { findSession, reduce } from '../../src/shared/reducer';
import type { PersistedState } from '../../src/shared/types';
import { sanitizeSettings } from '../../src/shared/validate';
import { WheelThinner } from '../../src/shared/wheel';

function base(): PersistedState {
  const state = defaultState();
  const sessions = ['1', '2', '3', '4', '5'].map((id) => ({ id, claudeId: id, kind: 'claude' as const, name: id, color: null, cwd: 'C:\\a', createdAt: 1 }));
  state.projects = [{ id: 'a', name: 'a', path: 'C:\\a', color: null, collapsed: false, sessions }];
  return reduce(state, { type: 'ui/select', id: '1' });
}

describe('paneles', () => {
  it('dividir deja la activa y el resto por elegir: nada se abre solo', () => {
    for (const layout of [2, 3, 4] as const) {
      const s = reduce(base(), { type: 'ui/layout', layout });
      expect(s.ui.panes[0]).toBe('1');
      expect(s.ui.panes.slice(1).every((p) => p === null)).toBe(true);
      expect(s.ui.panes.length).toBe(layout);
      expect(s.ui.activeSessionId).toBe('1');
    }
  });

  it('elegir con un panel vacío lo llena, sin quitar la que ya se ve', () => {
    let s = reduce(base(), { type: 'ui/layout', layout: 2 });
    s = reduce(s, { type: 'ui/select', id: '2' });
    expect(s.ui.panes).toEqual(['1', '2']);
    expect(s.ui.activePane).toBe(1);
    s = reduce(s, { type: 'ui/select', id: '3' });
    expect(s.ui.panes).toEqual(['1', '3']);
  });

  it('al volver a 1 se queda la activa', () => {
    let s = reduce(base(), { type: 'ui/layout', layout: 2 });
    s = reduce(s, { type: 'ui/select', id: '2' });
    s = reduce(s, { type: 'ui/layout', layout: 1 });
    expect(s.ui.panes).toEqual(['2']);
    expect(s.ui.activeSessionId).toBe('2');
  });

  it('con el panel activo vacío, reducir no deja la vista sin sesión', () => {
    let s = reduce(base(), { type: 'ui/layout', layout: 2 });
    s = reduce(s, { type: 'ui/activePane', pane: 1 });
    s = reduce(s, { type: 'ui/layout', layout: 1 });
    expect(s.ui.panes).toEqual(['1']);
    expect(s.ui.activeSessionId).toBe('1');
  });

  it('soltar sobre un borde suma un panel de ese lado', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: '2' });
    expect(s.ui.panes).toEqual(['1', '2']);
    expect(s.ui.layout).toBe(2);
    expect(s.ui.activeSessionId).toBe('2');
    s = reduce(s, { type: 'ui/paneInsert', pane: 1, edge: 'bottom', sessionId: '3' });
    const r = paneRects(s.ui.tree!);
    expect(r[0]).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(r[1]).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(r[2]).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it('el límite son 4: un quinto no entra, y no cambia nada', () => {
    let s = base();
    for (const id of ['2', '3', '4']) s = reduce(s, { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: id });
    expect(s.ui.panes.length).toBe(4);
    const before = s.ui;
    s = reduce(s, { type: 'ui/paneInsert', pane: 0, edge: 'left', sessionId: '5' });
    expect(s.ui).toBe(before);
  });

  it('mover una que ya se ve a un borde no la duplica, también con 4', () => {
    let s = base();
    for (const id of ['2', '3', '4']) s = reduce(s, { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: id });
    s = reduce(s, { type: 'ui/paneInsert', pane: 0, edge: 'left', sessionId: '4' });
    expect(s.ui.panes.length).toBe(4);
    expect(new Set(s.ui.panes).size).toBe(4);
    const at = s.ui.panes.indexOf('4');
    expect(paneRects(s.ui.tree!)[at]!.x).toBe(0);
    expect(isValidTree(s.ui.tree, 4)).toBe(true);
  });

  it('no se suma contra sí misma ni junto a un panel vacío', () => {
    const s = reduce(base(), { type: 'ui/layout', layout: 2 });
    expect(reduce(s, { type: 'ui/paneInsert', pane: 0, edge: 'left', sessionId: '1' }).ui).toBe(s.ui);
    expect(reduce(s, { type: 'ui/paneInsert', pane: 1, edge: 'left', sessionId: '2' }).ui).toBe(s.ui);
  });

  it('quitar un panel: la sesión sigue existiendo y el espacio vuelve a repartirse', () => {
    let s = base();
    s = reduce(s, { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: '2' });
    s = reduce(s, { type: 'ui/paneInsert', pane: 1, edge: 'right', sessionId: '3' });
    s = reduce(s, { type: 'ui/paneRemove', pane: 1 });
    expect(s.ui.panes).toEqual(['1', '3']);
    expect(s.ui.activeSessionId).toBe('3');
    expect(findSession(s, '2')).toBeTruthy();
    expect(paneRects(s.ui.tree!).map((r) => r.w)).toEqual([0.5, 0.5]);
    s = reduce(s, { type: 'ui/paneRemove', pane: 1 });
    s = reduce(s, { type: 'ui/paneRemove', pane: 0 });
    expect(s.ui.panes).toEqual(['1']);
  });

  it('al cerrar, la vecina ocupa ese panel aunque otro esté esperando', () => {
    let s = reduce(base(), { type: 'ui/layout', layout: 2 });
    s = reduce(s, { type: 'ui/select', id: '2', inPlace: true });
    expect(s.ui.panes).toEqual(['2', null]);
    expect(s.ui.activePane).toBe(0);
  });

  it('cerrar una sesión de un panel que no es el activo deja el selector', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: '2' });
    s = reduce(s, { type: 'ui/activePane', pane: 0 });
    s = reduce(s, { type: 'session/remove', id: '2' });
    expect(s.ui.panes).toEqual(['1', null]);
  });
});

describe('pestañas', () => {
  it('cerrar una pestaña no quita la sesión, y entra la vecina', () => {
    const s = reduce(base(), { type: 'ui/tabClose', id: '1' });
    expect(findSession(s, '1')).toBeTruthy();
    expect(s.ui.hiddenTabs).toEqual(['1']);
    expect(s.ui.panes).toEqual(['2']);
    expect(s.ui.activeSessionId).toBe('2');
  });

  it('seleccionarla, soltarla o sumarla la vuelve a abrir', () => {
    const closed = reduce(reduce(base(), { type: 'ui/select', id: '2' }), { type: 'ui/tabClose', id: '1' });
    expect(reduce(closed, { type: 'ui/select', id: '1' }).ui.hiddenTabs).toEqual([]);
    expect(reduce(closed, { type: 'ui/pane', pane: 0, sessionId: '1' }).ui.hiddenTabs).toEqual([]);
    expect(reduce(closed, { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: '1' }).ui.hiddenTabs).toEqual([]);
  });

  it('una vecina oculta o a la vista no entra; sin vecina el panel queda por elegir', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: '2' });
    for (const id of ['3', '4', '5']) s = reduce(s, { type: 'ui/tabClose', id });
    s = reduce(s, { type: 'ui/activePane', pane: 0 });
    s = reduce(s, { type: 'ui/tabClose', id: '1' });
    expect(s.ui.panes).toEqual([null, '2']);
    expect(s.ui.activeSessionId).toBe(null);
    expect(s.ui.emptyProjectId).toBe('a');
  });

  it('borrar la sesión limpia su pestaña oculta', () => {
    const s = reduce(reduce(base(), { type: 'ui/tabClose', id: '3' }), { type: 'session/remove', id: '3' });
    expect(s.ui.hiddenTabs).toEqual([]);
  });
});

describe('tamaño de los paneles', () => {
  it('mover un divisor cambia solo a sus dos vecinos', () => {
    const three = presetTree(3);
    const moved = moveDivider(three, { path: [], index: 0 }, 0.5);
    const r = paneRects(moved);
    expect(r[0]!.w).toBeCloseTo(0.5);
    expect(r[1]!.w).toBeCloseTo(1 / 6);
    expect(r[2]!.w).toBeCloseTo(1 / 3);
    expect(isValidTree(moved, 3)).toBe(true);
  });

  it('ningún panel desaparece al arrastrar hasta el borde', () => {
    const moved = moveDivider(presetTree(2), { path: [], index: 0 }, 0.001);
    expect(paneRects(moved)[0]!.w).toBeCloseTo(0.12);
    expect(paneRects(moveDivider(presetTree(2), { path: [], index: 0 }, 5))[1]!.w).toBeCloseTo(0.12);
  });

  it('un divisor anidado se mide dentro de su nodo', () => {
    const mixed = insertLeaf(presetTree(2), 1, 'bottom', 2);
    const d = paneDividers(mixed).find((x) => x.dir === 'col')!;
    expect(d.x).toBe(0.5);
    expect(d.y).toBe(0.5);
    expect(d.length).toBe(0.5);
    const r = paneRects(moveDivider(mixed, d, 0.25));
    expect(r[1]!.h).toBeCloseTo(0.25);
    expect(r[2]!.h).toBeCloseTo(0.75);
    expect(r[0]!.h).toBe(1);
  });

  it('doble clic vuelve a partes iguales, y un árbol con tamaños rotos se rechaza', () => {
    const moved = moveDivider(presetTree(2), { path: [], index: 0 }, 0.3);
    expect(paneRects(resetDivider(moved, []))[0]!.w).toBe(0.5);
    expect(isValidTree({ dir: 'row', kids: [0, 1], sizes: [1] }, 2)).toBe(false);
    expect(isValidTree({ dir: 'row', kids: [0, 1], sizes: [1, -1] }, 2)).toBe(false);
    expect(isValidTree({ dir: 'row', kids: [0, 1], sizes: [1, null] }, 2)).toBe(false);
    expect(reduce(base(), { type: 'ui/tree', tree: presetTree(2) }).ui.tree).not.toEqual(presetTree(2));
  });
});

describe('touchpad', () => {
  const pad = (y: number) => ({ deltaMode: 0, deltaY: y, wheelDeltaY: -Math.round(y * 1.2) });
  const mouse = (dir: number) => ({ deltaMode: 0, deltaY: 100 * dir, wheelDeltaY: -120 * dir });

  it('la rueda del ratón pasa entera', () => {
    const w = new WheelThinner();
    for (let i = 0; i < 10; i++) expect(w.keep(mouse(1), i * 1000, 35)).toBe(true);
  });

  it('del touchpad pasa la parte elegida, y la inercia en múltiplos de 120 cuenta como touchpad', () => {
    const w = new WheelThinner();
    let kept = 0;
    for (let i = 0; i < 100; i++) if (w.keep(i % 7 === 0 ? mouse(1) : pad(7), i * 16, 35)) kept++;
    expect(kept).toBeGreaterThanOrEqual(34);
    expect(kept).toBeLessThanOrEqual(36);
  });

  it('al 100 % no se pierde ninguno', () => {
    const w = new WheelThinner();
    for (let i = 0; i < 20; i++) expect(w.keep(pad(7), i * 16, 100)).toBe(true);
  });

  it('pasado el gesto, la rueda vuelve a ser rueda', () => {
    const w = new WheelThinner();
    w.keep(pad(7), 0, 10);
    expect(w.keep(mouse(1), 1000, 10)).toBe(true);
  });
});

describe('ajustes para otras personas', () => {
  it('sin el flag peligroso por defecto, pero se respeta el de quien lo encendió', () => {
    expect(DEFAULT_SETTINGS.skipPermissions).toBe(false);
    expect(sanitizeSettings({}).skipPermissions).toBe(false);
    expect(sanitizeSettings({ skipPermissions: true }).skipPermissions).toBe(true);
  });

  it('los ajustes nuevos se acotan', () => {
    const s = sanitizeSettings({ appZoom: 999, wheelSpeed: 1, touchpadSpeed: 500, scrollbarAlways: 'x' });
    expect(s.appZoom).toBe(150);
    expect(s.wheelSpeed).toBe(25);
    expect(s.touchpadSpeed).toBe(100);
    expect(s.scrollbarAlways).toBe(true);
  });
});

describe('reparto de paneles', () => {
  it('un archivo con el árbol roto se rechaza', () => {
    expect(isValidTree(presetTree(4), 4)).toBe(true);
    expect(isValidTree({ dir: 'row', kids: [0, 0] }, 2)).toBe(false);
    expect(isValidTree({ dir: 'row', kids: [0] }, 1)).toBe(false);
    expect(isValidTree({ dir: 'x', kids: [0, 1] }, 2)).toBe(false);
    expect(isValidTree({ dir: 'row', kids: [0, 2] }, 2)).toBe(false);
    expect(isValidTree('<img>', 1)).toBe(false);
  });

  it('las flechas van al panel de ese lado, y dan la vuelta', () => {
    const grid = presetTree(4);
    expect(paneInDirection(grid, 0, 1, 0)).toBe(1);
    expect(paneInDirection(grid, 0, 0, 1)).toBe(2);
    expect(paneInDirection(grid, 3, -1, 0)).toBe(2);
    expect(paneInDirection(grid, 3, 0, -1)).toBe(1);
    expect(paneInDirection(grid, 1, 1, 0)).toBe(0);
    expect(paneInDirection(grid, 2, 0, 1)).toBe(0);
    const three = presetTree(3);
    expect(paneInDirection(three, 0, 1, 0)).toBe(1);
    expect(paneInDirection(three, 1, 1, 0)).toBe(2);
    expect(paneInDirection(three, 2, 1, 0)).toBe(0);
    expect(paneInDirection(three, 0, -1, 0)).toBe(2);
    expect(paneInDirection(three, 0, 0, 1)).toBe(0);
    const mixed = insertLeaf(presetTree(2), 1, 'bottom', 2);
    expect(paneInDirection(mixed, 0, 1, 0)).toBe(1);
    expect(paneInDirection(mixed, 1, 0, 1)).toBe(2);
    expect(paneInDirection(mixed, 2, -1, 0)).toBe(0);
  });

  it('quitar el último de una fila anidada la deshace', () => {
    const mixed = insertLeaf(presetTree(2), 1, 'bottom', 2);
    expect(removeLeaf(mixed, 2)).toEqual({ dir: 'row', kids: [0, 1] });
    expect(removeLeaf(mixed, 0)).toEqual({ dir: 'col', kids: [0, 1] });
  });
});
