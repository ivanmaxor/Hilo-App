import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultState } from '../../src/shared/defaults';
import { parseRawNumstat, parseUnifiedDiff, rowsFromNewFile } from '../../src/shared/diff';
import { ideArgs, ideJumpsToLine, ideKind, ideName, isValidIdePath } from '../../src/shared/ide';
import { changesPaneId, changesProjectOf, sessionInPane } from '../../src/shared/paneContent';
import { reduce } from '../../src/shared/reducer';
import { checkRelativePath } from '../../src/shared/safePath';
import { shortcutProblem, SHORTCUTS } from '../../src/shared/shortcuts';
import type { Action, PersistedState } from '../../src/shared/types';
import { isValidAction, sanitizeSettings } from '../../src/shared/validate';
import { decodeText, findGit, isInside, resolveInside } from '../../src/main/git';
import { detectIdes } from '../../src/main/ide';
import { sanitize } from '../../src/main/store';

describe('parseUnifiedDiff', () => {
  const patch = [
    'diff --git a/x.txt b/x.txt',
    'index 111..222 100644',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -10,4 +10,5 @@ function algo()',
    ' igual',
    '-vieja',
    '+nueva uno',
    '+nueva dos',
    ' igual 2',
    ' igual 3',
    '@@ -30,2 +31 @@',
    ' contexto',
    '-última',
    '',
  ].join('\n');

  it('numera cada línea y deja las quitadas sin número nuevo', () => {
    const d = parseUnifiedDiff(patch);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(2);
    const rows = d.rows.filter((r) => r.kind !== 'gap');
    expect(rows.map((r) => [r.kind, r.oldLine, r.newLine])).toEqual([
      ['ctx', 10, 10],
      ['del', 11, null],
      ['add', null, 11],
      ['add', null, 12],
      ['ctx', 12, 13],
      ['ctx', 13, 14],
      ['ctx', 30, 31],
      ['del', 31, null],
    ]);
  });

  it('cuenta las líneas que no se muestran entre zonas', () => {
    const d = parseUnifiedDiff(patch);
    const gaps = d.rows.filter((r) => r.kind === 'gap');
    expect(gaps.map((g) => g.hidden)).toEqual([9, 16]);
  });

  it('una quitada lleva a la línea que ocupa su sitio ahora', () => {
    const d = parseUnifiedDiff(patch);
    const removed = d.rows.filter((r) => r.kind === 'del');
    expect(removed.map((r) => r.jump)).toEqual([11, 31]);
  });

  it('un archivo borrado entero no tiene adónde saltar', () => {
    const d = parseUnifiedDiff('@@ -1,2 +0,0 @@\n-a\n-b\n');
    expect(d.rows.map((r) => r.jump)).toEqual([null, null]);
  });

  it('agrupa los cambios contiguos', () => {
    const d = parseUnifiedDiff(patch);
    expect(d.changes.length).toBe(2);
    expect(d.rows[d.changes[0]!]!.kind).toBe('del');
  });

  it('una línea de código que parece cabecera sigue siendo código', () => {
    const d = parseUnifiedDiff('@@ -1,2 +1,3 @@\n--- no soy cabecera\n+++ yo tampoco\n+@@ -9,9 +9,9 @@\n contexto\n');
    expect(d.rows.map((r) => [r.kind, r.text])).toEqual([
      ['del', '-- no soy cabecera'],
      ['add', '++ yo tampoco'],
      ['add', '@@ -9,9 +9,9 @@'],
      ['ctx', 'contexto'],
    ]);
  });

  it('marca el final sin salto de línea, sin partir el grupo de cambios', () => {
    const d = parseUnifiedDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n');
    expect(d.rows.map((r) => r.kind)).toEqual(['del', 'note', 'add', 'note']);
    expect(d.changes).toEqual([0]);
  });

  it('quita el retorno de carro de Windows', () => {
    const d = parseUnifiedDiff('@@ -1 +1 @@\n-a\r\n+b\r\n');
    expect(d.rows.map((r) => r.text)).toEqual(['a', 'b']);
  });

  it('reconoce un binario', () => {
    expect(parseUnifiedDiff('diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n').binary).toBe(true);
    expect(parseUnifiedDiff('@@ -1 +1 @@\n-Binary files a and b differ\n+x\n').binary).toBe(false);
  });

  it('no lee más allá de lo que anuncia la cabecera', () => {
    const d = parseUnifiedDiff('@@ -1,1 +1,1 @@\n-a\n+b\nbasura final\n');
    expect(d.rows.length).toBe(2);
  });

  it('un archivo nuevo son todas líneas agregadas, numeradas desde 1', () => {
    const d = rowsFromNewFile('uno\ndos\n');
    expect(d.rows.map((r) => [r.kind, r.newLine, r.text])).toEqual([
      ['add', 1, 'uno'],
      ['add', 2, 'dos'],
    ]);
    expect(rowsFromNewFile('').rows).toEqual([]);
    expect(rowsFromNewFile('sin salto').rows.length).toBe(1);
  });

  it('un diff enorme se parte en tiempo razonable', () => {
    const body = Array.from({ length: 200_000 }, (_, i) => `+línea ${i}`).join('\n');
    const start = Date.now();
    const d = parseUnifiedDiff(`@@ -0,0 +1,200000 @@\n${body}\n`);
    expect(d.rows.length).toBe(200_000);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

describe('parseRawNumstat', () => {
  const out = (parts: string[]) => `${parts.join('\0')}\0`;

  it('une tipo y cuentas de cada archivo', () => {
    const files = parseRawNumstat(
      out([
        ':100644 100644 aaa bbb M',
        'a.txt',
        ':000000 100644 000 ccc A',
        'nuevo.txt',
        ':100644 000000 ddd 000 D',
        'viejo.txt',
        '3\t1\ta.txt',
        '2\t0\tnuevo.txt',
        '0\t5\tviejo.txt',
      ]),
    );
    expect(files).toEqual([
      { path: 'a.txt', kind: 'modified', added: 3, removed: 1, binary: false },
      { path: 'nuevo.txt', kind: 'added', added: 2, removed: 0, binary: false },
      { path: 'viejo.txt', kind: 'deleted', added: 0, removed: 5, binary: false },
    ]);
  });

  it('entiende un renombrado, con dos rutas tras el campo vacío', () => {
    const files = parseRawNumstat(out([':100644 100644 aaa bbb R087', 'viejo.txt', 'nuevo.txt', '1\t2\t', 'viejo.txt', 'nuevo.txt']));
    expect(files).toEqual([{ path: 'nuevo.txt', oldPath: 'viejo.txt', kind: 'renamed', added: 1, removed: 2, binary: false }]);
  });

  it('un binario no tiene cuentas', () => {
    const files = parseRawNumstat(out([':100644 100644 aaa bbb M', 'a.png', '-\t-\ta.png']));
    expect(files[0]).toMatchObject({ binary: true, added: null, removed: null });
  });

  it('marca un conflicto y conserva rutas con espacios y acentos', () => {
    const files = parseRawNumstat(out([':100644 100644 aaa bbb U', 'carpeta nueva/año.txt', '1\t1\tcarpeta nueva/año.txt']));
    expect(files[0]).toMatchObject({ kind: 'conflict', path: 'carpeta nueva/año.txt' });
  });

  it('una salida vacía no da archivos', () => {
    expect(parseRawNumstat('')).toEqual([]);
  });
});

describe('rutas relativas', () => {
  it.each([
    ['src/a.txt', 'src/a.txt'],
    ['src\\a.txt', 'src/a.txt'],
    ['carpeta con espacios/ñandú.java', 'carpeta con espacios/ñandú.java'],
    ['..algo/b.txt', '..algo/b.txt'],
    ['.github/ci.yml', '.github/ci.yml'],
  ])('acepta %s', (raw, want) => {
    expect(checkRelativePath(raw)).toBe(want);
  });

  it.each([
    ['..'],
    ['../x'],
    ['a/../../x'],
    ['a\\..\\..\\x'],
    ['.'],
    ['./a'],
    ['/etc/passwd'],
    ['\\\\servidor\\c$\\x'],
    ['C:\\Windows\\win.ini'],
    ['C:x'],
    ['a.txt:oculto'],
    ['a//b'],
    ['a/'],
    ['.. /x'],
    ['../ /x'],
    ['.../x'],
    ['x. /y'],
    ['.git/config'],
    ['.GIT/hooks/x'],
    ['sub/.git/config'],
    ['GIT~1/config'],
    ['CON'],
    ['nul.txt'],
    ['a/COM1'],
    ['a\0b'],
    ['a\nb'],
    [''],
    [42],
    [null],
    [undefined],
    [{ length: 3 }],
    ['x'.repeat(3000)],
  ])('rechaza %j', (raw) => {
    expect(checkRelativePath(raw)).toBeNull();
  });
});

describe('rutas reales', () => {
  let root: string;
  let outside: string;
  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), 'hilo-unit-'));
    root = join(base, 'proyecto');
    outside = join(base, 'afuera');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(root, 'src', 'a.txt'), 'hola');
    writeFileSync(join(outside, 'secreto.txt'), 'no');
    // Una unión de carpetas no pide permisos especiales.
    symlinkSync(outside, join(root, 'union'), 'junction');
    symlinkSync(root, join(root, 'src', 'vuelta'), 'junction');
  });
  afterAll(() => rmSync(join(root, '..'), { recursive: true, force: true }));

  it('acepta lo que está dentro', async () => {
    expect(await resolveInside(root, 'src/a.txt')).toBe(join(root, 'src', 'a.txt'));
    expect(await resolveInside(root, 'src\\a.txt')).toBe(join(root, 'src', 'a.txt'));
  });

  it('acepta lo que ya no existe, si su carpeta está dentro', async () => {
    expect(await resolveInside(root, 'src/borrado.txt')).toBe(join(root, 'src', 'borrado.txt'));
    expect(await resolveInside(root, 'nueva/carpeta/x.txt')).toBe(join(root, 'nueva', 'carpeta', 'x.txt'));
  });

  it('rechaza lo que sale por una unión, exista o no', async () => {
    expect(await resolveInside(root, 'union/secreto.txt')).toBeNull();
    expect(await resolveInside(root, 'union')).toBeNull();
    expect(await resolveInside(root, 'union/no-existe.txt')).toBeNull();
  });

  it('una unión que vuelve dentro del proyecto sigue dentro', async () => {
    expect(await resolveInside(root, 'src/vuelta/src/a.txt')).not.toBeNull();
  });

  it('rechaza una ruta que no pasa la comprobación', async () => {
    expect(await resolveInside(root, '../afuera/secreto.txt')).toBeNull();
    expect(await resolveInside(root, join(outside, 'secreto.txt'))).toBeNull();
  });

  it('isInside no confunde un nombre que empieza con puntos ni una carpeta vecina', () => {
    expect(isInside('C:\\p', 'C:\\p\\..algo\\x')).toBe(true);
    expect(isInside('C:\\p', 'C:\\p')).toBe(true);
    expect(isInside('C:\\p', 'C:\\p-otro\\x')).toBe(false);
    expect(isInside('C:\\p', 'C:\\')).toBe(false);
    expect(isInside('C:\\p', 'D:\\p')).toBe(false);
    expect(isInside('C:\\P', 'c:\\p\\x')).toBe(true);
  });
});

describe('buscar git', () => {
  it('nunca devuelve el nombre suelto, y no mira rutas relativas del PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hilo-git-'));
    try {
      writeFileSync(join(dir, 'git.exe'), '');
      expect(findGit({ PATH: dir })).toBe(join(dir, 'git.exe'));
      // Un punto en el PATH significa "la carpeta actual", que es la del repositorio.
      const found = findGit({ PATH: '.;relativa\\bin;' });
      expect(found).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('el test de sobreescritura solo vale en pruebas', () => {
    expect(findGit({ PATH: '', HILO_TEST_GIT: 'C:\\no\\existe.exe' })).toBeNull();
    expect(findGit({ PATH: '', HILO_E2E: '1', HILO_TEST_GIT: 'C:\\no\\existe.exe' })).toBeNull();
  });
});

describe('texto', () => {
  it('decodifica UTF-8, y si no lo es, Windows-1252', () => {
    expect(decodeText(Buffer.from('año', 'utf8'))).toBe('año');
    expect(decodeText(Buffer.from([0x61, 0xf1, 0x6f]))).toBe('año');
  });
});

describe('sintaxis de cada IDE', () => {
  const project = 'C:\\proy';
  const file = 'C:\\proy\\src\\Main.java';
  it.each([
    ['C:\\nb\\bin\\netbeans64.exe', 'netbeans', ['--open', `${file}:42`]],
    ['C:\\vs\\Code.exe', 'vscode', [project, '--goto', `${file}:42`]],
    ['C:\\c\\Cursor.exe', 'vscode', [project, '--goto', `${file}:42`]],
    ['C:\\i\\idea64.exe', 'jetbrains', ['--line', '42', file]],
    ['C:\\i\\pycharm64.exe', 'jetbrains', ['--line', '42', file]],
    ['C:\\v\\devenv.exe', 'devenv', ['/Edit', file]],
    ['C:\\e\\eclipse.exe', 'eclipse', ['--launcher.openFile', file]],
    ['C:\\s\\subl.exe', 'sublime', [`${file}:42`]],
    ['C:\\n\\notepad++.exe', 'notepadpp', ['-n42', file]],
    ['C:\\otro\\raro.exe', 'generic', [file]],
  ])('%s', (exe, kind, args) => {
    expect(ideKind(exe)).toBe(kind);
    expect(ideArgs(ideKind(exe), { project, file, line: 42 })).toEqual(args);
  });

  it('sin línea abre el archivo', () => {
    expect(ideArgs('netbeans', { project, file })).toEqual(['--open', file]);
    expect(ideArgs('jetbrains', { project, file })).toEqual([file]);
    expect(ideArgs('notepadpp', { project, file })).toEqual([file]);
    expect(ideArgs('sublime', { project, file })).toEqual([file]);
  });

  it('sin archivo abre el proyecto', () => {
    expect(ideArgs('netbeans', { project })).toEqual(['--open', project]);
    expect(ideArgs('vscode', { project })).toEqual([project]);
    expect(ideArgs('jetbrains', { project })).toEqual([project]);
    expect(ideArgs('devenv', { project })).toEqual([project]);
    expect(ideArgs('eclipse', { project })).toEqual([]);
    expect(ideArgs('notepadpp', { project })).toEqual(['-openFoldersAsWorkspace', project]);
  });

  it('dice si un IDE puede ir a la línea', () => {
    expect(ideJumpsToLine('netbeans')).toBe(true);
    expect(ideJumpsToLine('devenv')).toBe(false);
    expect(ideJumpsToLine('eclipse')).toBe(false);
    expect(ideJumpsToLine('generic')).toBe(false);
  });

  it('nombra lo elegido a mano', () => {
    expect(ideName('C:\\nb\\bin\\netbeans64.exe')).toBe('NetBeans');
    expect(ideName('C:\\x\\Code.exe')).toBe('Visual Studio Code');
    expect(ideName('C:\\x\\MiEditor.exe')).toBe('MiEditor');
  });

  it.each([
    ['C:\\Program Files\\NetBeans\\bin\\netbeans64.exe', true],
    ['D:/x/y.EXE', true],
    ['C:\\x\\code.cmd', false],
    ['C:\\x\\y.bat', false],
    ['\\\\servidor\\x\\y.exe', false],
    ['relativa\\y.exe', false],
    ['C:\\a\\..\\y.exe', false],
    ['C:\\a\\"y.exe', false],
    ['y.exe', false],
    [42, false],
    [null, false],
  ])('ruta de IDE %j: %s', (path, ok) => {
    expect(isValidIdePath(path)).toBe(ok);
  });
});

describe('detectar IDEs', () => {
  it('encuentra los instalados en rutas conocidas, y nada más', () => {
    const base = mkdtempSync(join(tmpdir(), 'hilo-ide-'));
    const put = (...parts: string[]) => {
      const file = join(base, ...parts);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, '');
    };
    try {
      put('pf', 'NetBeans-23', 'netbeans', 'bin', 'netbeans64.exe');
      put('pf', 'NetBeans 8.2', 'bin', 'netbeans64.exe');
      put('pf', 'JetBrains', 'IntelliJ IDEA 2026.1', 'bin', 'idea64.exe');
      put('pf', 'Microsoft Visual Studio', '2022', 'Community', 'Common7', 'IDE', 'devenv.exe');
      put('local', 'Programs', 'Microsoft VS Code', 'Code.exe');
      put('local', 'Programs', 'cursor', 'Cursor.exe');
      put('home', 'eclipse', 'java-2026', 'eclipse', 'eclipse.exe');
      // Una carpeta con nombre conocido pero sin el programa no cuenta.
      mkdirSync(join(base, 'pf', 'NetBeans-vacío'), { recursive: true });
      const found = detectIdes({ programFiles: [join(base, 'pf')], localAppData: [join(base, 'local')], userProfile: [join(base, 'home')] });
      expect(found.map((f) => f.name).sort()).toEqual(['Cursor', 'Eclipse (java-2026)', 'IntelliJ IDEA 2026.1', 'NetBeans 23', 'NetBeans 8.2', 'Visual Studio 2022 Community', 'Visual Studio Code']);
      expect(found.every((f) => /^ide-\d+$/.test(f.id))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('sin carpetas no encuentra nada ni falla', () => {
    expect(detectIdes({ programFiles: ['C:\\no\\existe'], localAppData: [], userProfile: [] })).toEqual([]);
  });
});

function base(): PersistedState {
  const state = defaultState();
  const sessions = ['1', '2', '3', '4', '5'].map((id) => ({ id, claudeId: id, kind: 'claude' as const, name: id, color: null, cwd: 'C:\\a', createdAt: 1 }));
  state.projects = [
    { id: 'a', name: 'a', path: 'C:\\a', color: null, collapsed: false, sessions },
    { id: 'b', name: 'b', path: 'C:\\b', color: null, collapsed: false, sessions: [] },
  ];
  return reduce(state, { type: 'ui/select', id: '1' });
}
const CH = changesPaneId('a');

describe('panel Cambios en el árbol', () => {
  it('el id no choca con ninguna sesión: una sesión no puede llevar dos puntos', () => {
    expect(changesProjectOf(CH)).toBe('a');
    expect(changesProjectOf('a')).toBeNull();
    expect(changesProjectOf(null)).toBeNull();
    expect(sessionInPane(CH)).toBeNull();
    expect(sessionInPane('1')).toBe('1');
    expect(isValidAction({ type: 'session/rename', id: CH, name: 'x' })).toBe(false);
  });

  it('se suma al lado de la activa, y la sesión activa deja de serlo', () => {
    const s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: CH });
    expect(s.ui.panes).toEqual(['1', CH]);
    expect(s.ui.layout).toBe(2);
    expect(s.ui.activePane).toBe(1);
    expect(s.ui.activeSessionId).toBeNull();
    expect(s.ui.emptyProjectId).toBe('a');
  });

  it('al activar la terminal de al lado vuelve la sesión activa', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: CH });
    s = reduce(s, { type: 'ui/activePane', pane: 0 });
    expect(s.ui.activeSessionId).toBe('1');
    s = reduce(s, { type: 'ui/activePane', pane: 1 });
    expect(s.ui.activeSessionId).toBeNull();
  });

  it('elegir una sesión con el panel activo la lleva a la terminal, no encima del panel', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: CH });
    s = reduce(s, { type: 'ui/select', id: '2' });
    expect(s.ui.panes).toEqual(['2', CH]);
    expect(s.ui.activePane).toBe(0);
    expect(s.ui.activeSessionId).toBe('2');
  });

  it('solo en la ventana, elegir una sesión lo reemplaza', () => {
    let s = reduce(base(), { type: 'ui/pane', pane: 0, sessionId: CH });
    expect(s.ui.panes).toEqual([CH]);
    expect(s.ui.activeSessionId).toBeNull();
    s = reduce(s, { type: 'ui/select', id: '2' });
    expect(s.ui.panes).toEqual(['2']);
    expect(s.ui.activeSessionId).toBe('2');
  });

  it('llena un panel que espera antes que nada', () => {
    let s = reduce(base(), { type: 'ui/layout', layout: 3 });
    s = reduce(s, { type: 'ui/pane', pane: 1, sessionId: CH });
    s = reduce(s, { type: 'ui/select', id: '2' });
    expect(s.ui.panes).toEqual(['1', CH, '2']);
  });

  it('quitarlo devuelve el espacio; solo en la ventana, queda el selector', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: CH });
    s = reduce(s, { type: 'ui/paneRemove', pane: 1 });
    expect(s.ui.panes).toEqual(['1']);
    expect(s.ui.activeSessionId).toBe('1');

    s = reduce(base(), { type: 'ui/pane', pane: 0, sessionId: CH });
    s = reduce(s, { type: 'ui/paneRemove', pane: 0 });
    expect(s.ui.panes).toEqual([null]);
    // Una sesión sola no se quita: eso no cambia.
    const one = base();
    expect(reduce(one, { type: 'ui/paneRemove', pane: 0 }).ui).toBe(one.ui);
  });

  it('se puede intercambiar y mover como una sesión', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: CH });
    s = reduce(s, { type: 'ui/pane', pane: 0, sessionId: CH });
    expect(s.ui.panes).toEqual([CH, '1']);
    s = reduce(s, { type: 'ui/paneInsert', pane: 1, edge: 'bottom', sessionId: CH });
    expect(s.ui.panes).toEqual(['1', CH]);
    expect((s.ui.tree as { dir: string }).dir).toBe('col');
  });

  it('cerrar una sesión no toca el panel activo', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: CH });
    s = reduce(s, { type: 'session/remove', id: '1' });
    expect(s.ui.panes).toEqual([null, CH]);
    expect(s.ui.activePane).toBe(1);
    expect(s.ui.activeSessionId).toBeNull();
  });

  it('reducir la vista lo mantiene si estaba activo', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: CH });
    s = reduce(s, { type: 'ui/layout', layout: 1 });
    expect(s.ui.panes).toEqual([CH]);
    expect(s.ui.activeSessionId).toBeNull();
  });

  it('quitar el proyecto descarta su panel', () => {
    let s = reduce(base(), { type: 'ui/paneInsert', pane: 0, edge: 'right', sessionId: changesPaneId('b') });
    s = reduce(s, { type: 'project/remove', id: 'b' });
    expect(s.ui.panes).toEqual(['1', null]);
  });

  it('no abre un panel de un proyecto que no existe', () => {
    const s = base();
    expect(reduce(s, { type: 'ui/pane', pane: 0, sessionId: changesPaneId('nadie') })).toBe(s);
    expect(reduce(s, { type: 'ui/paneInsert', pane: 0, edge: 'left', sessionId: changesPaneId('nadie') })).toBe(s);
  });

  it('validación: acepta el panel solo donde corresponde', () => {
    const ok: Action[] = [
      { type: 'ui/pane', pane: 0, sessionId: CH },
      { type: 'ui/paneInsert', pane: 0, edge: 'left', sessionId: CH },
    ];
    for (const a of ok) expect(isValidAction(a)).toBe(true);
    const bad: Action[] = [
      { type: 'ui/select', id: CH },
      { type: 'ui/tabClose', id: CH },
      { type: 'ui/pane', pane: 0, sessionId: 'changes:../..' },
      { type: 'ui/pane', pane: 0, sessionId: 'changes:' },
      { type: 'ui/paneInsert', pane: 0, edge: 'left', sessionId: 'otra:cosa' },
    ];
    for (const a of bad) expect(isValidAction(a)).toBe(false);
  });
});

describe('persistencia', () => {
  it('conserva el panel de un proyecto que existe', () => {
    const raw = base();
    raw.ui = { ...raw.ui, layout: 2, panes: ['1', CH], activePane: 1, activeSessionId: null, tree: { dir: 'row', kids: [0, 1] } };
    const s = sanitize(JSON.parse(JSON.stringify(raw)));
    expect(s.ui.panes).toEqual(['1', CH]);
    expect(s.ui.activeSessionId).toBeNull();
    expect(s.ui.activePane).toBe(1);
  });

  it('descarta el panel de un proyecto que ya no está, sin romper nada', () => {
    const raw = base();
    raw.ui = { ...raw.ui, layout: 2, panes: ['1', changesPaneId('borrado')], activePane: 1, activeSessionId: null };
    const s = sanitize(JSON.parse(JSON.stringify(raw)));
    expect(s.ui.panes).toEqual(['1', null]);
  });

  it('un estado viejo, sin nada de esto, carga igual', () => {
    const raw = JSON.parse(JSON.stringify(base()));
    delete raw.settings.changesShowSigns;
    delete raw.settings.changesFullFile;
    const s = sanitize(raw);
    expect(s.settings.changesShowSigns).toBe(false);
    expect(s.settings.changesFullFile).toBe(false);
    expect(s.projects[0]!.ide).toBeUndefined();
    expect(s.ui.panes).toEqual(['1']);
  });

  it('guarda el IDE si es un .exe local, y olvida cualquier otra cosa', () => {
    const raw = JSON.parse(JSON.stringify(base()));
    raw.projects[0].ide = { path: 'C:\\nb\\netbeans64.exe', name: 'NetBeans' };
    raw.projects[1].ide = { path: 'C:\\x\\malo.cmd', name: 'x' };
    const s = sanitize(raw);
    expect(s.projects[0]!.ide).toEqual({ path: 'C:\\nb\\netbeans64.exe', name: 'NetBeans' });
    expect(s.projects[1]!.ide).toBeUndefined();
    raw.projects[0].ide = { path: '\\\\srv\\x.exe', name: 'x' };
    expect(sanitize(raw).projects[0]!.ide).toBeUndefined();
    raw.projects[0].ide = 'C:\\nb\\netbeans64.exe';
    expect(sanitize(raw).projects[0]!.ide).toBeUndefined();
  });

  it('el renderer no puede poner un IDE: ni con la acción ni dentro de un proyecto nuevo', () => {
    expect(isValidAction({ type: 'project/ide', id: 'a', ide: { path: 'C:\\x.exe', name: 'x' } })).toBe(false);
    const project = { id: 'n', name: 'n', path: 'C:\\n', color: null, collapsed: false, sessions: [] };
    expect(isValidAction({ type: 'project/add', project })).toBe(true);
    expect(isValidAction({ type: 'project/add', project: { ...project, ide: { path: 'C:\\x.exe', name: 'x' } } })).toBe(false);
  });

  it('project/ide cambia y quita', () => {
    let s = reduce(base(), { type: 'project/ide', id: 'a', ide: { path: 'C:\\x.exe', name: 'x' } });
    expect(s.projects[0]!.ide?.name).toBe('x');
    s = reduce(s, { type: 'project/ide', id: 'a', ide: null });
    expect('ide' in s.projects[0]!).toBe(false);
  });
});

describe('ajustes y atajo', () => {
  it('sanea los ajustes de cambios', () => {
    expect(sanitizeSettings({ changesShowSigns: true, changesFullFile: true }).changesShowSigns).toBe(true);
    expect(sanitizeSettings({ changesShowSigns: 'sí', changesFullFile: 1 }).changesShowSigns).toBe(false);
    expect(sanitizeSettings({ changesShowSigns: 'sí', changesFullFile: 1 }).changesFullFile).toBe(false);
  });

  it('el atajo no choca con Claude Code ni con otro de Hilo', () => {
    const def = SHORTCUTS.find((s) => s.id === 'toggleChanges')!;
    expect(shortcutProblem(def.defaultKeys)).toBeNull();
    expect(SHORTCUTS.filter((s) => s.defaultKeys === def.defaultKeys).length).toBe(1);
  });
});

describe('git instalado en esta máquina', () => {
  it('se encuentra una ruta absoluta', () => {
    const path = findGit();
    // Si no hay git, las e2e tampoco corren: aquí solo se comprueba la forma.
    if (path) expect(/^[A-Za-z]:\\.*git\.exe$/i.test(path)).toBe(true);
    if (path) expect(execFileSync(path, ['--version'], { encoding: 'utf8' })).toContain('git version');
  });
});
