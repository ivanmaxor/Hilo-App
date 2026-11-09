import { formatCopiedMessage, lastAssistantText } from '../../src/shared/lastMessage';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultState } from '../../src/shared/defaults';
import { fuzzyMatch } from '../../src/shared/fuzzy';
import { cleanCopy, joinHardWrapped, sanitizePaste } from '../../src/shared/paste';
import { allSessions, findSession, reduce } from '../../src/shared/reducer';
import { buildKeymap, CLAUDE_RESERVED, eventToKeys, shortcutProblem, SHORTCUTS } from '../../src/shared/shortcuts';
import type { Action, PersistedState, ProjectRecord, SessionRecord } from '../../src/shared/types';
import { buildClaudeArgs, buildCmdLine, buildEnv, quoteArg } from '../../src/main/claude';
import { isSafeId, isValidAction, isValidModel, sanitizeSettings } from '../../src/shared/validate';
import { buildHookSettings, parseEvents } from '../../src/main/hooks';
import { backgroundProcesses, descendants, parseSnapshot } from '../../src/main/processes';
import { sanitize, Store } from '../../src/main/store';
import { readFileSync as readFixture } from 'node:fs';
import { stripAnsi } from '../../src/main/sessions';

function session(id: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { id, claudeId: id, kind: 'claude', name: id, color: null, cwd: 'C:\\x', createdAt: 1, ...extra };
}
function project(id: string, sessions: SessionRecord[] = []): ProjectRecord {
  return { id, name: id, path: `C:\\${id}`, color: null, collapsed: false, sessions };
}
function stateWith(projects: ProjectRecord[]): PersistedState {
  return { ...defaultState(), projects };
}
const names = (p: ProjectRecord) => p.sessions.map((s) => s.id);

describe('reducer', () => {
  it('mueve sesiones dentro de un proyecto', () => {
    const s = stateWith([project('a', [session('1'), session('2'), session('3')])]);
    const next = reduce(s, { type: 'session/move', id: '1', toProjectId: 'a', toIndex: 2 });
    expect(names(next.projects[0]!)).toEqual(['2', '3', '1']);
  });

  it('mueve sesiones entre proyectos sin cambiar su carpeta', () => {
    const s = stateWith([project('a', [session('1', { cwd: 'C:\\a' })]), project('b', [session('2')])]);
    const next = reduce(s, { type: 'session/move', id: '1', toProjectId: 'b', toIndex: 0 });
    expect(names(next.projects[0]!)).toEqual([]);
    expect(names(next.projects[1]!)).toEqual(['1', '2']);
    expect(findSession(next, '1')!.session.cwd).toBe('C:\\a');
  });

  it('reordena proyectos', () => {
    const s = stateWith([project('a'), project('b'), project('c')]);
    const next = reduce(s, { type: 'project/move', id: 'c', toIndex: 0 });
    expect(next.projects.map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('no acepta nombres vacíos', () => {
    const s = stateWith([project('a', [session('1')])]);
    const next = reduce(s, { type: 'session/rename', id: '1', name: '   ' });
    expect(findSession(next, '1')!.session.name).toBe('1');
  });

  it('seleccionar lo que está en otro panel enfoca ese panel', () => {
    let s = stateWith([project('a', [session('1'), session('2')])]);
    s = reduce(s, { type: 'ui/select', id: '1' });
    s = reduce(s, { type: 'ui/layout', layout: 2 });
    s = reduce(s, { type: 'ui/select', id: '2' });
    s = reduce(s, { type: 'ui/select', id: '1' });
    expect(s.ui.activePane).toBe(0);
    s = reduce(s, { type: 'ui/select', id: '2' });
    expect(s.ui.panes).toEqual(['1', '2']);
    expect(s.ui.activePane).toBe(1);
  });

  it('la vista de 4 no repite sesiones', () => {
    let s = stateWith([project('a', [session('1'), session('2'), session('3')])]);
    s = reduce(s, { type: 'ui/select', id: '2' });
    s = reduce(s, { type: 'ui/layout', layout: 4 });
    s = reduce(s, { type: 'ui/select', id: '1' });
    s = reduce(s, { type: 'ui/select', id: '3' });
    s = reduce(s, { type: 'ui/select', id: '2' });
    const shown = s.ui.panes.filter(Boolean);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.length).toBe(3);
  });

  it('quitar una sesión la saca de los paneles y elige otra', () => {
    let s = stateWith([project('a', [session('1'), session('2')])]);
    s = reduce(s, { type: 'ui/select', id: '1' });
    s = reduce(s, { type: 'session/remove', id: '1' });
    expect(s.ui.panes).toEqual(['2']);
    expect(s.ui.activeSessionId).toBe('2');
  });

  it('quitar un proyecto limpia la interfaz', () => {
    let s = stateWith([project('a', [session('1')])]);
    s = reduce(s, { type: 'ui/select', id: '1' });
    s = reduce(s, { type: 'project/remove', id: 'a' });
    expect(s.ui.panes).toEqual([null]);
    expect(s.ui.activeSessionId).toBeNull();
  });

  it('dos deshacer no duplican una sesión', () => {
    const s0 = session('2');
    let s = stateWith([project('a', [s0])]);
    s = reduce(s, { type: 'session/remove', id: '2' });
    s = reduce(s, { type: 'session/add', projectId: 'a', session: s0, index: 0 });
    s = reduce(s, { type: 'session/add', projectId: 'a', session: s0, index: 0 });
    expect(names(s.projects[0]!)).toEqual(['2']);
  });

  it('deshacer el cierre deja la sesión en su lugar', () => {
    const removed = session('2');
    let s = stateWith([project('a', [session('1'), removed, session('3')])]);
    s = reduce(s, { type: 'session/remove', id: '2' });
    s = reduce(s, { type: 'session/add', projectId: 'a', session: removed, index: 1 });
    expect(names(s.projects[0]!)).toEqual(['1', '2', '3']);
  });

  it('el orden global sigue el de la barra', () => {
    const s = stateWith([project('a', [session('1')]), project('b', [session('2')])]);
    expect(allSessions(s).map((x) => x.id)).toEqual(['1', '2']);
  });
});

describe('sesiones encendidas al cerrar', () => {
  const base = () => {
    const state = defaultState();
    const session = { id: 's1', claudeId: 's1', kind: 'shell' as const, name: 'n', color: null, cwd: 'C:\\x', createdAt: 1 };
    state.projects = [{ id: 'p', name: 'p', path: 'C:\\x', color: null, collapsed: false, sessions: [session] }];
    return state;
  };
  it('se recuerda y se olvida, sin duplicar', () => {
    let state = reduce(base(), { type: 'session/awake', id: 's1', awake: true });
    state = reduce(state, { type: 'session/awake', id: 's1', awake: true });
    expect(state.ui.awake).toEqual(['s1']);
    expect(reduce(state, { type: 'session/awake', id: 's1', awake: false }).ui.awake).toEqual([]);
  });
  it('cerrar una sesión la saca de la lista', () => {
    const state = reduce(base(), { type: 'session/awake', id: 's1', awake: true });
    expect(reduce(state, { type: 'session/remove', id: 's1' }).ui.awake).toEqual([]);
  });
  it('un archivo con ids que ya no existen no despierta nada raro', () => {
    const raw = { ...base(), ui: { ...base().ui, awake: ['s1', 'no-existe', 7] } };
    expect(sanitize(raw).ui.awake).toEqual(['s1']);
  });
  it('por defecto se abre con lo que quedó encendido', () => {
    expect(DEFAULT_SETTINGS.startup).toBe('restore');
  });
});

describe('permisos de Claude', () => {
  const session = { id: 's', claudeId: 'c', kind: 'claude', name: 'n', color: null, cwd: 'C:\\x', createdAt: 1 } as const;
  it('con el ajuste, retomar lleva --dangerously-skip-permissions', () => {
    const args = buildClaudeArgs({ session, resume: true, settingsFile: null, skipPermissions: true });
    expect(args.slice(0, 2)).toEqual(['--resume', 'c']);
    expect(args).toContain('--dangerously-skip-permissions');
  });
  it('sin el ajuste no se pasa', () => {
    expect(buildClaudeArgs({ session, resume: false, settingsFile: null, skipPermissions: false })).not.toContain('--dangerously-skip-permissions');
  });
  it('por defecto está apagado: se comparte con gente que no lo pidió', () => {
    expect(DEFAULT_SETTINGS.skipPermissions).toBe(false);
  });
});

describe('guardado', () => {
  it('sobrevive a un archivo corrupto usando la copia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hilo-store-'));
    const store = new Store(dir);
    const add: Action = { type: 'project/add', project: project('a') };
    store.dispatch(add);
    store.flush();
    store.dispatch({ type: 'project/add', project: project('b') });
    store.flush();
    writeFileSync(join(dir, 'state.json'), '{ esto no es json');
    const reloaded = new Store(dir);
    expect(reloaded.get().projects.map((p) => p.id)).toEqual(['a']);
    expect(reloaded.notice).toContain('recuperó');
    // El dañado se aparta, y el primer guardado no pisa la copia buena con él.
    reloaded.dispatch({ type: 'project/add', project: project('c') });
    reloaded.flush();
    expect(JSON.parse(readFileSync(join(dir, 'state.json.bak'), 'utf8')).projects.map((p: { id: string }) => p.id)).toEqual(['a']);
    expect(readdirSync(dir).some((f) => f.startsWith('state.json.corrupto-'))).toBe(true);
  });

  it('escribe de forma atómica sin dejar temporales a medias', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hilo-store-'));
    const store = new Store(dir);
    store.dispatch({ type: 'project/add', project: project('a') });
    store.flush();
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).projects[0].id).toBe('a');
  });

  it('si falla la escritura, el cambio sigue pendiente y no se lanza nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hilo-store-'));
    const store = new Store(dir);
    store.dispatch({ type: 'project/add', project: project('a') });
    // Una carpeta con el nombre del temporal hace fallar la escritura.
    mkdirSync(join(dir, 'state.json.tmp'));
    const errors: string[] = [];
    store.onSaveError = (m) => errors.push(m);
    expect(store.flushSafe()).toBe(false);
    // Un bloqueo de un instante no avisa: solo si el reintento tampoco puede.
    store.flushSafe();
    expect(errors.length).toBe(1);
    rmSync(join(dir, 'state.json.tmp'), { recursive: true });
    expect(store.flushSafe()).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).projects[0].id).toBe('a');
  });

  it('completa los campos que falten y descarta paneles huérfanos', () => {
    const state = sanitize({
      projects: [{ id: 'a', path: 'C:\\a', sessions: [{ id: '1', cwd: 'C:\\a' }, { nada: true }] }],
      ui: { layout: 2, panes: ['1', 'borrado'], activePane: 9 },
      settings: { fontSize: 20 },
    });
    expect(state.projects[0]!.sessions).toHaveLength(1);
    expect(state.projects[0]!.sessions[0]!.claudeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.ui.panes).toEqual(['1', null]);
    expect(state.ui.activePane).toBe(1);
    expect(state.settings.fontSize).toBe(20);
    expect(state.settings.scrollback).toBeGreaterThan(0);
  });

  it('no se cae con basura', () => {
    expect(sanitize(null).projects).toEqual([]);
    expect(sanitize({ projects: 'x', ui: 3 }).projects).toEqual([]);
  });
});

describe('pegado y copiado', () => {
  it('quita caracteres de control salvo tab, LF y CR', () => {
    expect(sanitizePaste('a\x1b[201~b\tc\r\nd\x07e\x9bf\x7fg')).toBe('a[201~b\tc\r\ndefg');
  });

  it('un portapapeles malicioso no se sale del bracketed paste', () => {
    const out = sanitizePaste('hola\x1b[201~\rrm -rf /\r');
    expect(out).not.toContain('\x1b');
  });

  it('respeta tildes, ñ, emojis y CJK', () => {
    const text = 'ñandú áéíóú 😀 👨‍👩‍👧 🇪🇸 日本語 e\u0301';
    expect(sanitizePaste(text)).toBe(text);
  });

  it('quita espacios finales sin tocar la sangría', () => {
    expect(cleanCopy('  uno   \r\n\tdos\t\r\n  tres  ')).toBe('  uno\r\n\tdos\r\n  tres');
  });

  it('une líneas cortadas por Claude si la palabra siguiente no cabía, y quita el margen', () => {
    const long = `  ${'x'.repeat(74)}`;
    expect(joinHardWrapped(`${long}\r\n  sigue aquí\r\n  corta\r\n  otra`, 80)).toBe(`${'x'.repeat(74)} sigue aquí\r\ncorta\r\notra`);
  });

  it('no une una línea con sangría propia: es código', () => {
    const long = `  ${'x'.repeat(74)}`;
    expect(joinHardWrapped(`${long}\r\n      indentada`, 80)).toBe(`${'x'.repeat(74)}\r\n    indentada`);
  });

  it('cleanCopy no se traba con una tirada larga de espacios', () => {
    const text = `${' '.repeat(60_000)}x${' '.repeat(60_000)}`;
    const start = Date.now();
    expect(cleanCopy(text)).toBe(`${' '.repeat(60_000)}x`);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('atajos', () => {
  const ev = (over: Partial<KeyboardEvent>) => ({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: '', code: '', ...over }) as KeyboardEvent;

  it('funciona en teclado español: Ctrl+Shift+1 produce "!"', () => {
    expect(eventToKeys(ev({ ctrlKey: true, shiftKey: true, key: '!', code: 'Digit1' }))).toBe('Ctrl+Shift+1');
  });

  it('el + del teclado español es zoom', () => {
    expect(eventToKeys(ev({ ctrlKey: true, key: '+', code: 'BracketRight' }))).toBe('Ctrl+=');
  });

  it('ningún atajo por defecto choca con Claude Code', () => {
    for (const s of SHORTCUTS) expect(CLAUDE_RESERVED.has(s.defaultKeys), s.id).toBe(false);
  });

  it('no hay dos acciones con la misma combinación', () => {
    const all = SHORTCUTS.map((s) => s.defaultKeys);
    expect(new Set(all).size).toBe(all.length);
  });

  it('respeta lo que cambie el usuario', () => {
    const map = buildKeymap({ quickOpen: 'Ctrl+Shift+P', search: '' });
    expect(map.get('Ctrl+Shift+P')).toBe('quickOpen');
    expect(map.get('Ctrl+Shift+K')).toBeUndefined();
    expect(map.get('Ctrl+Shift+F')).toBeUndefined();
  });
});

describe('atajos que no se pueden asignar', () => {
  it('rechaza teclas de escribir y las de Claude Code', () => {
    expect(shortcutProblem('Enter')).not.toBeNull();
    expect(shortcutProblem('Tab')).not.toBeNull();
    expect(shortcutProblem('A')).not.toBeNull();
    expect(shortcutProblem('Shift+A')).not.toBeNull();
    expect(shortcutProblem('Ctrl+C')).not.toBeNull();
    expect(shortcutProblem('Ctrl+Shift+Y')).toBeNull();
    expect(shortcutProblem('Alt+1')).toBeNull();
    expect(shortcutProblem('F2')).toBeNull();
  });
});

describe('validación', () => {
  const session = { id: 'aaaaaaaa-0000-4000-8000-000000000001', claudeId: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'claude', name: 'x', color: null, cwd: 'C:\\x', createdAt: 1 };
  it('un id no puede salirse de la carpeta ni inyectar en el hook', () => {
    expect(isSafeId('..\\..\\x')).toBe(false);
    expect(isSafeId('$(echo x)')).toBe(false);
    expect(isSafeId('aaaaaaaa-0000-4000-8000-000000000001')).toBe(true);
    expect(isValidAction({ type: 'session/add', projectId: 'p', session: { ...session, id: '../x' } } as never)).toBe(false);
    expect(isValidAction({ type: 'session/add', projectId: 'p', session } as never)).toBe(true);
  });
  it('rechaza acciones malformadas', () => {
    expect(isValidAction({ type: 'project/add', project: { id: 'mal' } } as never)).toBe(false);
    expect(isValidAction({ type: 'session/color', id: 'a', color: 'url(x)' } as never)).toBe(false);
    expect(isValidAction({ type: 'ui/layout', layout: 5 } as never)).toBe(false);
    expect(isValidAction({ type: 'ui/paneInsert', pane: 0, edge: 'centro', sessionId: 'a' } as never)).toBe(false);
    expect(isValidAction({ type: 'desconocida' } as never)).toBe(false);
  });
  it('el modelo no puede traer argumentos', () => {
    expect(isValidModel('claude-opus-5-5[1m]')).toBe(true);
    expect(isValidModel('"a" --permission-mode x')).toBe(false);
  });
  it('un ajuste inválido no deja la app sin arrancar', () => {
    const s = sanitizeSettings({ shortcuts: null, scrollback: 1e12, theme: '__proto__', claudePath: 12, fontSize: 'x', fontFamily: 'a"b' });
    expect(s.scrollback).toBe(100_000);
    expect(s.theme).toBe('dark');
    expect(s.claudePath).toBe('');
    expect(s.fontSize).toBe(16);
    expect(s.fontFamily).toBe('Cascadia Mono');
    expect(buildKeymap(s.shortcuts).size).toBeGreaterThan(0);
  });
});

describe('línea de comandos', () => {
  it('cada argumento llega tal cual, también con comillas', () => {
    expect(quoteArg('simple')).toBe('simple');
    expect(quoteArg('con espacio')).toBe('"con espacio"');
    expect(quoteArg('"hola mundo"')).toBe('"\\"hola mundo\\""');
    expect(quoteArg('a\\')).toBe('a\\');
    expect(quoteArg('a b\\')).toBe('"a b\\\\"');
    expect(quoteArg('')).toBe('""');
  });
  it('con un .cmd no pasa nombres que cmd interpretaría', () => {
    const line = buildCmdLine('C:\\ruta con espacio\\claude.cmd', ['--session-id', 'abc', '--name', 'R&D', '--effort', 'low']);
    expect(line).not.toContain('R&D');
    expect(line).toBe('/d /s /c ""C:\\ruta con espacio\\claude.cmd" "--session-id" "abc" "--effort" "low""');
    expect(buildCmdLine('c.cmd', ['--name', 'Sesión 1'])).toContain('"Sesión 1"');
  });
});

describe('selector rápido', () => {
  it('sin distinguir mayúsculas ni tildes', () => {
    expect(fuzzyMatch('migr', 'Migración de pedidos')).not.toBeNull();
    expect(fuzzyMatch('migracion', 'Migración')).not.toBeNull();
    expect(fuzzyMatch('zzz', 'Migración')).toBeNull();
  });
  it('prefiere coincidencias seguidas', () => {
    expect(fuzzyMatch('pago', 'Pago con tarjeta')!.score).toBeGreaterThan(fuzzyMatch('pago', 'Para algo gordo')!.score);
  });
});

describe('claude', () => {
  it('sin flags de permisos ni nada que el usuario no eligió', () => {
    const args = buildClaudeArgs({ session: session('abc', { name: 'Mi sesión' }), resume: false, settingsFile: null });
    expect(args).toEqual(['--session-id', 'abc', '--name', 'Mi sesión']);
  });
  it('retoma con el mismo id y pasa modelo y esfuerzo', () => {
    const args = buildClaudeArgs({ session: session('abc', { model: 'haiku', effort: 'low' }), resume: true, settingsFile: 'C:\\h.json' });
    expect(args).toEqual(['--resume', 'abc', '--name', 'abc', '--model', 'haiku', '--effort', 'low', '--settings', 'C:\\h.json']);
  });
  it('no filtra variables de Electron ni de una sesión de Claude contenedora', () => {
    const env = buildEnv('id', { PATH: 'x', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', TERM_PROGRAM: 'ghostty', HILO_E2E: '1', NODE_OPTIONS: '--inspect' });
    expect(env.PATH).toBe('x');
    for (const k of ['ELECTRON_RUN_AS_NODE', 'CLAUDECODE', 'TERM_PROGRAM', 'HILO_E2E', 'NODE_OPTIONS']) expect(env[k]).toBeUndefined();
    expect(env.WT_SESSION).toBe('id');
  });
  it('abrir Hilo desde una sesión de Claude no apaga el guardado de la conversación', () => {
    const env = buildEnv('id', { CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: '1', CLAUDE_CODE_MESSAGING_TOKEN: 's', NO_COLOR: '1', PATH: 'x' });
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined();
    expect(env.NO_COLOR).toBeUndefined();
    expect(env.PATH).toBe('x');
  });
  it('conserva NO_COLOR y las opciones de Claude que puso el usuario', () => {
    const env = buildEnv('id', { NO_COLOR: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1000' });
    expect(env.NO_COLOR).toBe('1');
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('1000');
  });
});

describe('diálogo de confianza', () => {
  it('se reconoce en la grabación real', () => {
    const lines = readFixture(join(__dirname, '..', '..', 'docs', 'investigacion', 'fixtures', 'arranque.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { data?: string });
    const raw = lines.map((l) => l.data ?? '').join('');
    expect(stripAnsi(raw)).toContain('trust this folder');
  });
  it('un arranque normal no lo dispara', () => {
    const lines = readFixture(join(__dirname, '..', '..', 'docs', 'investigacion', 'fixtures', 'trabajando-y-listo-dll.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { data?: string });
    expect(stripAnsi(lines.map((l) => l.data ?? '').join(''))).not.toContain('trust this folder');
  });
});

describe('hooks', () => {
  it('el comando no lee stdin y solo escribe el nombre del evento', () => {
    const settings = buildHookSettings('C:\\datos\\x.events') as { hooks: Record<string, { hooks: { command: string }[]; matcher?: string }[]> };
    for (const list of Object.values(settings.hooks)) {
      for (const entry of list) {
        for (const hook of entry.hooks) {
          expect(hook.command).toMatch(/^echo \w+ >> 'C:\/datos\/x\.events'$/);
        }
      }
    }
  });
  it('PreToolUse solo con matcher, y sin PostToolUse', () => {
    const { hooks } = buildHookSettings('x') as { hooks: Record<string, { matcher?: string }[]> };
    expect(hooks.PreToolUse![0]!.matcher).toBe('AskUserQuestion');
    expect(hooks.PostToolUse).toBeUndefined();
  });
  it('lee lo que escriben bash, cmd y PowerShell', () => {
    expect(parseEvents('Stop\nUserPromptSubmit\n')).toEqual(['Stop', 'UserPromptSubmit']);
    expect(parseEvents('Stop \r\n')).toEqual(['Stop']);
    expect(parseEvents('\uFEFFS\0t\0o\0p\0\r\0\n\0')).toEqual(['Stop']);
    expect(parseEvents('otra cosa\nStop\n')).toEqual(['Stop']);
  });
});

describe('procesos', () => {
  const NOW = 1_800_000_000_000;
  const ft = (msAgo: number) => (NOW - msAgo + 11_644_473_600_000) * 10_000;
  const snap = parseSnapshot(
    [
      `100|1|claude.exe|${ft(100_000)}|claude --x`,
      // Herramienta Bash con npm run dev: bash, bash, conhost, bash, node.
      `200|100|bash.exe|${ft(50_000)}|bash -c "source ~/.claude/shell-snapshots/snapshot-bash.sh && npm run dev"`,
      `210|200|bash.exe|${ft(49_000)}|bash -c same`,
      `220|210|conhost.exe|${ft(49_000)}|conhost 0x4`,
      `300|210|node.exe|${ft(48_000)}|node server.js`,
      // Servidor MCP por cmd.
      `400|100|cmd.exe|${ft(90_000)}|cmd /c npx server-filesystem`,
      `500|400|node.exe|${ft(89_000)}|node mcp.js`,
      // Hook pasajero en bash, sin snapshot.
      `600|100|bash.exe|${ft(1_000)}|bash -c "echo Stop >> x"`,
      // Hook de PowerShell recién lanzado.
      `650|100|powershell.exe|${ft(2_000)}|powershell -File hook.ps1`,
      // PowerShell que lleva rato: herramienta de Claude.
      `660|100|powershell.exe|${ft(60_000)}|powershell -Command npm start`,
      `670|660|node.exe|${ft(59_000)}|node app.js`,
      `700|999|node.exe|${ft(1_000)}|otro proceso`,
      // PID reutilizado: mismo padre pero anterior al padre.
      `800|100|viejo.exe|${ft(200_000)}|viejo`,
    ].join(String.fromCharCode(10)),
  );

  it('recorre el árbol sin procesos ajenos ni PID reutilizados', () => {
    const ids = descendants(100, snap).map((p) => p.pid);
    expect(ids).toContain(300);
    expect(ids).toContain(500);
    expect(ids).not.toContain(700);
    expect(ids).not.toContain(800);
  });

  it('avisa de lo lanzado por las herramientas, no de MCP ni de hooks', () => {
    const bg = backgroundProcesses(100, snap, NOW);
    expect(bg.map((p) => p.pid).sort()).toEqual([300, 670]);
    expect(bg.map((p) => p.name)).toEqual(['node.exe', 'node.exe']);
  });

  it('sin nada en segundo plano no hay aviso', () => {
    const quiet = parseSnapshot(`100|1|claude.exe|${ft(100_000)}|claude
400|100|cmd.exe|${ft(90_000)}|cmd /c npx mcp`);
    expect(backgroundProcesses(100, quiet, NOW)).toEqual([]);
  });

  it('ignora líneas mal formadas', () => {
    expect(parseSnapshot('basura\n\n|||')).toEqual([]);
  });
});

describe('último mensaje de Claude', () => {
  const line = (o: object) => JSON.stringify(o);
  const assistant = (id: string, content: unknown, extra: object = {}) => line({ type: 'assistant', message: { id, role: 'assistant', content }, ...extra });

  it('junta los bloques de texto del último mensaje, sin herramientas ni subagentes', () => {
    const jsonl = [
      assistant('m1', [{ type: 'text', text: 'viejo' }]),
      line({ type: 'user', message: { role: 'user', content: 'hola' } }),
      assistant('m2', [{ type: 'text', text: 'Primero' }]),
      assistant('m2', [{ type: 'tool_use', name: 'Bash' }]),
      assistant('m2', [{ type: 'text', text: 'Resumen' }]),
      assistant('s1', [{ type: 'text', text: 'de un subagente' }], { isSidechain: true }),
      line({ type: 'last-prompt' }),
    ].join('\n');
    expect(lastAssistantText(jsonl)).toBe('Primero\n\nResumen');
  });

  it('salta un mensaje final sin texto y una línea cortada', () => {
    const jsonl = ['{"type":"assis', assistant('m1', [{ type: 'text', text: 'Listo' }]), assistant('m2', [{ type: 'tool_use' }])].join('\n');
    expect(lastAssistantText(jsonl)).toBe('Listo');
    expect(lastAssistantText('')).toBeNull();
  });

  it('el formato: nombre, dos puntos y una línea en blanco', () => {
    expect(formatCopiedMessage('CC', 'Hice X')).toBe('CC:\n\nHice X');
  });
});
