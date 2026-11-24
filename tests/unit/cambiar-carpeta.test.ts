import { describe, expect, it } from 'vitest';
import { isInsideFolder, rebasePath, samePath, subfolderOf } from '../../src/shared/folderPaths';
import { findSession, reduce } from '../../src/shared/reducer';
import type { PersistedState } from '../../src/shared/types';
import { isValidAction } from '../../src/shared/validate';

/** #7: qué sesiones estaban dentro de la carpeta vieja, y el cambio atómico de carpeta de un proyecto. */
describe('isInsideFolder', () => {
  it('la misma carpeta y las de adentro, a cualquier profundidad', () => {
    expect(isInsideFolder('C:\\Proy', 'C:\\Proy')).toBe(true);
    expect(isInsideFolder('C:\\Proy\\src', 'C:\\Proy')).toBe(true);
    expect(isInsideFolder('C:\\Proy\\src\\a\\b', 'C:\\Proy')).toBe(true);
  });

  it('no distingue mayúsculas ni el tipo de barra', () => {
    expect(isInsideFolder('c:/proy/SRC', 'C:\\PROY')).toBe(true);
    expect(isInsideFolder('C:\\Proy\\src', 'c:/Proy/')).toBe(true);
    expect(isInsideFolder('C:\\Proy\\\\src', 'C:\\Proy')).toBe(true);
  });

  it('no confunde C:\\Proy con C:\\Proyecto', () => {
    expect(isInsideFolder('C:\\Proyecto', 'C:\\Proy')).toBe(false);
    expect(isInsideFolder('C:\\Proyecto\\src', 'C:\\Proy')).toBe(false);
    expect(isInsideFolder('C:\\Proy', 'C:\\Proyecto')).toBe(false);
  });

  it('una carpeta que contiene a la vieja, o hermana, no cuenta', () => {
    expect(isInsideFolder('C:\\Proy', 'C:\\Proy\\src')).toBe(false);
    expect(isInsideFolder('C:\\Otra', 'C:\\Proy')).toBe(false);
  });

  it('otra unidad no es la misma carpeta', () => {
    expect(isInsideFolder('D:\\Proy', 'C:\\Proy')).toBe(false);
  });

  it('la raíz de una unidad contiene todo lo de esa unidad', () => {
    expect(isInsideFolder('C:\\Proy', 'C:\\')).toBe(true);
    expect(isInsideFolder('c:\\', 'C:')).toBe(false); // «C:» sola es relativa: no se compara
    expect(isInsideFolder('C:\\', 'C:\\')).toBe(true);
    expect(isInsideFolder('D:\\Proy', 'C:\\')).toBe(false);
  });

  it('rutas de red (UNC): mismo servidor y recurso, sin distinguir mayúsculas', () => {
    expect(isInsideFolder('\\\\Srv\\Datos\\Proy\\src', '\\\\srv\\datos\\proy')).toBe(true);
    expect(isInsideFolder('//srv/datos/proy', '\\\\SRV\\DATOS')).toBe(true);
    expect(isInsideFolder('\\\\srv\\datos\\proyecto', '\\\\srv\\datos\\proy')).toBe(false);
    expect(isInsideFolder('\\\\srv\\otro\\proy', '\\\\srv\\datos\\proy')).toBe(false);
    expect(isInsideFolder('\\\\srv2\\datos\\proy', '\\\\srv\\datos\\proy')).toBe(false);
    // Un servidor sin recurso no es una carpeta.
    expect(isInsideFolder('\\\\srv', '\\\\srv')).toBe(false);
    expect(isInsideFolder('C:\\Proy', '\\\\srv\\datos')).toBe(false);
  });

  it('el prefijo de ruta larga no cambia nada', () => {
    expect(isInsideFolder('\\\\?\\C:\\Proy\\src', 'C:\\Proy')).toBe(true);
    expect(isInsideFolder('\\\\?\\UNC\\srv\\datos\\proy\\x', '\\\\srv\\datos\\proy')).toBe(true);
  });

  it('. y .. se resuelven, y no se escapa de la carpeta con ..', () => {
    expect(isInsideFolder('C:\\Proy\\src\\..\\lib', 'C:\\Proy')).toBe(true);
    expect(isInsideFolder('C:\\Proy\\..\\Otra', 'C:\\Proy')).toBe(false);
    expect(isInsideFolder('C:\\Proy\\.\\src', 'C:\\Proy')).toBe(true);
  });

  it('lo que no es una ruta absoluta no se compara con nada', () => {
    for (const bad of ['', 'proy', '.\\proy', '\\proy', 'C:proy', '\0']) {
      expect(isInsideFolder(bad, 'C:\\Proy')).toBe(false);
      expect(isInsideFolder('C:\\Proy', bad)).toBe(false);
      expect(samePath(bad, bad)).toBe(false);
    }
  });
});

describe('samePath, subfolderOf y rebasePath', () => {
  it('samePath ignora mayúsculas, barras y la barra final', () => {
    expect(samePath('C:\\Proy', 'c:/proy/')).toBe(true);
    expect(samePath('C:\\Proy', 'C:\\Proy\\src')).toBe(false);
    expect(samePath('C:\\Proy', 'C:\\Proyecto')).toBe(false);
  });

  it('subfolderOf da lo que tiene de más, con su mayúscula original', () => {
    expect(subfolderOf('C:\\Proy', 'C:\\Proy')).toBe('');
    expect(subfolderOf('c:\\proy\\Src\\Lib', 'C:\\Proy')).toBe('Src\\Lib');
    expect(subfolderOf('C:\\Otra', 'C:\\Proy')).toBeNull();
  });

  it('rebasePath conserva la subcarpeta en la carpeta nueva', () => {
    expect(rebasePath('C:\\Viejo', 'C:\\Viejo', 'D:\\Nuevo')).toBe('D:\\Nuevo');
    expect(rebasePath('c:/viejo/src/lib', 'C:\\Viejo', 'D:\\Nuevo\\')).toBe('D:\\Nuevo\\src\\lib');
    expect(rebasePath('C:\\Viejo\\src', 'C:\\Viejo', '\\\\srv\\datos\\nuevo')).toBe('\\\\srv\\datos\\nuevo\\src');
    expect(rebasePath('C:\\Viejo\\src', 'C:\\Viejo', 'D:\\')).toBe('D:\\src');
    expect(rebasePath('C:\\Viejo', 'C:\\Viejo', 'D:\\')).toBe('D:\\');
  });

  it('rebasePath rechaza lo que no estaba dentro de la vieja', () => {
    expect(rebasePath('C:\\Viejoo\\src', 'C:\\Viejo', 'D:\\Nuevo')).toBeNull();
    expect(rebasePath('C:\\Viejo', 'C:\\Viejo', 'nuevo')).toBeNull();
  });
});

describe('project/relocate (reducer)', () => {
  const OLD = 'C:\\Codigo\\App';
  const claude = (id: string) => `3f2a9c1e-7b4d-4e8a-9a51-0c6d2b7e1f${id}`;
  const session = (id: string, cwd: string) => ({ id, claudeId: claude('44'), kind: 'claude', name: id, color: null, cwd, createdAt: 1 });
  const base = (): PersistedState =>
    ({
      projects: [
        {
          id: 'p1',
          name: 'App',
          path: OLD,
          color: null,
          collapsed: false,
          sessions: [session('raiz', OLD), session('sub', 'c:/codigo/app/src'), session('fuera', 'C:\\Codigo\\Otra'), session('parecida', 'C:\\Codigo\\AppExtra')],
        },
        { id: 'p2', name: 'Otro', path: 'C:\\Codigo\\Otro', color: null, collapsed: false, sessions: [session('ajena', 'C:\\Codigo\\Otro')] },
      ],
    }) as unknown as PersistedState;
  const cwdOf = (s: PersistedState, id: string) => findSession(s, id)!.session.cwd;

  it('cambia la carpeta del proyecto y la de las sesiones que traen la suya, todo junto', () => {
    const next = reduce(base(), {
      type: 'project/relocate',
      id: 'p1',
      path: 'D:\\Nuevo',
      sessions: [
        { id: 'raiz', cwd: 'D:\\Nuevo' },
        { id: 'sub', cwd: 'D:\\Nuevo\\src' },
      ],
    });
    expect(next.projects[0]!.path).toBe('D:\\Nuevo');
    expect(cwdOf(next, 'raiz')).toBe('D:\\Nuevo');
    expect(cwdOf(next, 'sub')).toBe('D:\\Nuevo\\src');
  });

  it('las sesiones de otra carpeta no se tocan, aunque el renderer las pida', () => {
    const next = reduce(base(), {
      type: 'project/relocate',
      id: 'p1',
      path: 'D:\\Nuevo',
      sessions: [
        { id: 'fuera', cwd: 'D:\\Nuevo' },
        { id: 'parecida', cwd: 'D:\\Nuevo' },
        { id: 'ajena', cwd: 'D:\\Nuevo' },
      ],
    });
    expect(next.projects[0]!.path).toBe('D:\\Nuevo');
    expect(cwdOf(next, 'fuera')).toBe('C:\\Codigo\\Otra');
    expect(cwdOf(next, 'parecida')).toBe('C:\\Codigo\\AppExtra');
    expect(cwdOf(next, 'ajena')).toBe('C:\\Codigo\\Otro');
  });

  it('una sesión que no se pide se queda donde estaba, y el id de la conversación no cambia', () => {
    const before = base();
    const next = reduce(before, { type: 'project/relocate', id: 'p1', path: 'D:\\Nuevo', sessions: [{ id: 'raiz', cwd: 'D:\\Nuevo' }] });
    expect(cwdOf(next, 'sub')).toBe('c:/codigo/app/src');
    expect(findSession(next, 'raiz')!.session.claudeId).toBe(claude('44'));
    // Lo demás es el mismo objeto: no se reescribe lo que no cambió.
    expect(next.projects[1]).toBe(before.projects[1]);
    expect(findSession(next, 'fuera')!.session).toBe(findSession(before, 'fuera')!.session);
  });

  it('si la carpeta nueva ya es de otro proyecto, no cambia nada', () => {
    const before = base();
    expect(reduce(before, { type: 'project/relocate', id: 'p1', path: 'c:/codigo/otro/', sessions: [{ id: 'raiz', cwd: 'C:\\Codigo\\Otro' }] })).toBe(before);
  });

  it('un proyecto que no existe, o nada que cambiar, deja el estado igual', () => {
    const before = base();
    expect(reduce(before, { type: 'project/relocate', id: 'zzz', path: 'D:\\Nuevo', sessions: [] })).toBe(before);
    expect(reduce(before, { type: 'project/relocate', id: 'p1', path: OLD, sessions: [] })).toBe(before);
  });

  it('solo la dispara el proceso principal: el renderer no puede pedirla', () => {
    expect(isValidAction({ type: 'project/relocate', id: 'p1', path: 'D:\\Nuevo', sessions: [] })).toBe(false);
    expect(isValidAction({ type: 'session/cwd', id: 'raiz', cwd: 'D:\\Nuevo' })).toBe(false);
  });
});
